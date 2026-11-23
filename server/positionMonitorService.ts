import type {
  MonitoredPositionEvent,
  MonitoredPositionSyncItem,
} from '../src/types/trading.ts';
import { fetchLiveMarketQuote } from './marketData.ts';

interface TrackedPosition extends MonitoredPositionSyncItem {
  ownerKey: string;
  registeredAtMs: number;
  lastCheckedAtMs: number;
  closed: boolean;
}

const MAX_MONITORED_POSITIONS = 200;
const POSITION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MONITOR_INTERVAL_MS = 6_000;

const trackedPositions = new Map<string, TrackedPosition>(); // key: `${ownerKey}:${tradeId}`
const pendingEventsByOwner = new Map<string, MonitoredPositionEvent[]>();
let workerTimer: NodeJS.Timeout | null = null;
let workerRunning = false;

function makePositionKey(ownerKey: string, tradeId: string): string {
  return `${ownerKey}:${tradeId}`;
}

function pushOwnerEvent(ownerKey: string, event: MonitoredPositionEvent): void {
  const existing = pendingEventsByOwner.get(ownerKey) ?? [];
  existing.push(event);
  // Keep bounded per owner
  if (existing.length > 60) {
    existing.splice(0, existing.length - 60);
  }
  pendingEventsByOwner.set(ownerKey, existing);
}

function pruneStaleEntries(now = Date.now()): void {
  for (const [key, pos] of trackedPositions.entries()) {
    if (pos.closed || now - pos.registeredAtMs > POSITION_TTL_MS) {
      trackedPositions.delete(key);
    }
  }
}

async function forwardExnessTrailSl(params: {
  brokerOrderId: string;
  instrument: string;
  newStopLoss: number;
  tpStage: 1 | 2;
}): Promise<boolean> {
  const rawUrl = process.env.EXNESS_BRIDGE_URL?.trim();
  const token = process.env.EXNESS_API_TOKEN?.trim();
  if (!rawUrl || !token) return false;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    const base = parsed.toString().replace(/\/+$/, '');
    const res = await fetch(`${base}/orders/modify-sl`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        orderId: params.brokerOrderId,
        symbol: params.instrument,
        stopLoss: params.newStopLoss,
        tpStage: params.tpStage,
      }),
      signal: AbortSignal.timeout(6000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function syncMonitoredPositions(
  ownerKey: string,
  items: MonitoredPositionSyncItem[]
): { activeCount: number; pendingEvents: MonitoredPositionEvent[] } {
  const now = Date.now();
  pruneStaleEntries(now);

  const incomingIds = new Set<string>();
  for (const item of items.slice(0, 30)) {
    if (!item?.tradeId || !item?.instrumentId || !(item.entryPrice > 0) || !(item.quantity > 0)) {
      continue;
    }
    incomingIds.add(item.tradeId);
    const key = makePositionKey(ownerKey, item.tradeId);
    const existing = trackedPositions.get(key);

    if (existing) {
      // Never downgrade tpStage if server already advanced while browser was closed
      if (item.tpStage >= existing.tpStage) {
        existing.stopLoss = item.stopLoss;
        existing.tpStage = item.tpStage;
        existing.remainingQuantity = item.remainingQuantity;
        existing.partialRealizedPnl = item.partialRealizedPnl;
      }
      existing.enablePartialProfitBooking = item.enablePartialProfitBooking;
      existing.lastCheckedAtMs = now;
    } else if (trackedPositions.size < MAX_MONITORED_POSITIONS) {
      trackedPositions.set(key, {
        ...item,
        ownerKey,
        registeredAtMs: now,
        lastCheckedAtMs: now,
        closed: false,
      });
    }
  }

  // Remove trades for this owner that the client has already closed
  for (const [key, pos] of trackedPositions.entries()) {
    if (pos.ownerKey === ownerKey && !incomingIds.has(pos.tradeId)) {
      trackedPositions.delete(key);
    }
  }

  const pendingEvents = pendingEventsByOwner.get(ownerKey) ?? [];
  pendingEventsByOwner.delete(ownerKey);

  let activeCount = 0;
  for (const pos of trackedPositions.values()) {
    if (pos.ownerKey === ownerKey && !pos.closed) activeCount++;
  }

  return { activeCount, pendingEvents };
}

export function getMonitoredStatusForOwner(ownerKey: string): {
  activeCount: number;
  positions: Array<{
    tradeId: string;
    symbol: string;
    direction: 'BUY' | 'SELL';
    tpStage: 0 | 1 | 2;
    stopLoss: number;
    remainingQuantity: number;
    partialRealizedPnl: number;
  }>;
  pendingEvents: MonitoredPositionEvent[];
} {
  const positions: Array<{
    tradeId: string;
    symbol: string;
    direction: 'BUY' | 'SELL';
    tpStage: 0 | 1 | 2;
    stopLoss: number;
    remainingQuantity: number;
    partialRealizedPnl: number;
  }> = [];

  for (const pos of trackedPositions.values()) {
    if (pos.ownerKey === ownerKey && !pos.closed) {
      positions.push({
        tradeId: pos.tradeId,
        symbol: pos.symbol,
        direction: pos.direction,
        tpStage: pos.tpStage,
        stopLoss: pos.stopLoss,
        remainingQuantity: pos.remainingQuantity,
        partialRealizedPnl: pos.partialRealizedPnl,
      });
    }
  }

  const pendingEvents = pendingEventsByOwner.get(ownerKey) ?? [];
  pendingEventsByOwner.delete(ownerKey);

  return {
    activeCount: positions.length,
    positions,
    pendingEvents,
  };
}

export function removeMonitoredPosition(ownerKey: string, tradeId: string): boolean {
  return trackedPositions.delete(makePositionKey(ownerKey, tradeId));
}

async function runMonitorTick(): Promise<void> {
  if (workerRunning || trackedPositions.size === 0) return;
  workerRunning = true;
  try {
    pruneStaleEntries();
    const active = Array.from(trackedPositions.values()).filter((p) => !p.closed);
    if (active.length === 0) return;

    // Fetch each unique instrument quote once per tick
    const uniqueInstruments = Array.from(new Set(active.map((p) => p.instrumentId)));
    const priceMap = new Map<string, { price: number; bid: number; ask: number }>();

    await Promise.allSettled(
      uniqueInstruments.map(async (instId) => {
        const q = await fetchLiveMarketQuote(instId, '5m', undefined, true);
        if (q.available && typeof q.price === 'number' && q.price > 0) {
          priceMap.set(instId, {
            price: q.price,
            bid: q.bid ?? q.price,
            ask: q.ask ?? q.price,
          });
        }
      })
    );

    const nowIso = new Date().toISOString();

    for (const pos of active) {
      const px = priceMap.get(pos.instrumentId);
      if (!px) continue;

      // Realistic exit valuation: BUY exits at Bid, SELL exits at Ask
      const markPrice = pos.direction === 'BUY' ? px.bid : px.ask;
      const isBuy = pos.direction === 'BUY';
      const decimals = pos.entryPrice > 500 ? 2 : 4;
      const roundPx = (v: number) => Number(v.toFixed(decimals));

      const slHit = isBuy ? markPrice <= pos.stopLoss : markPrice >= pos.stopLoss;
      const tp3Hit = isBuy ? markPrice >= pos.target3 : markPrice <= pos.target3;
      const tp2Hit = isBuy ? markPrice >= pos.target2 : markPrice <= pos.target2;
      const tp1Hit = isBuy ? markPrice >= pos.target1 : markPrice <= pos.target1;

      // 1. Stop Loss Hit (Full or Trailing Exit)
      if (slHit) {
        const diff = isBuy ? pos.stopLoss - pos.entryPrice : pos.entryPrice - pos.stopLoss;
        const runnerPnl = diff * pos.remainingQuantity;
        const totalPnl = Number((pos.partialRealizedPnl + runnerPnl).toFixed(2));
        const result: 'WIN' | 'LOSS' | 'BREAKEVEN' =
          totalPnl > 0 ? 'WIN' : totalPnl < 0 ? 'LOSS' : 'BREAKEVEN';

        pos.closed = true;
        pos.remainingQuantity = 0;

        pushOwnerEvent(pos.ownerKey, {
          tradeId: pos.tradeId,
          type: 'CLOSE_SL',
          timestamp: nowIso,
          price: roundPx(pos.stopLoss),
          newStopLoss: pos.stopLoss,
          tpStage: pos.tpStage,
          partialRealizedPnl: pos.partialRealizedPnl,
          remainingQuantity: 0,
          finalPnl: totalPnl,
          result,
          detail:
            pos.tpStage === 2
              ? `24/7 Server Monitor closed runner at Trailed SL (TP1 Lock) @ ${roundPx(pos.stopLoss)}`
              : pos.tpStage === 1
                ? `24/7 Server Monitor closed runner at Breakeven SL @ ${roundPx(pos.stopLoss)}`
                : `24/7 Server Monitor triggered Stop Loss @ ${roundPx(pos.stopLoss)}`,
        });
        continue;
      }

      // 2. TP3 Full Target Hit
      if (tp3Hit) {
        const diff = isBuy ? pos.target3 - pos.entryPrice : pos.entryPrice - pos.target3;
        const runnerPnl = diff * pos.remainingQuantity;
        const totalPnl = Number((pos.partialRealizedPnl + runnerPnl).toFixed(2));

        pos.closed = true;
        pos.remainingQuantity = 0;

        pushOwnerEvent(pos.ownerKey, {
          tradeId: pos.tradeId,
          type: 'CLOSE_TP3',
          timestamp: nowIso,
          price: roundPx(pos.target3),
          newStopLoss: pos.target2,
          tpStage: 2,
          partialRealizedPnl: pos.partialRealizedPnl,
          remainingQuantity: 0,
          finalPnl: totalPnl,
          result: totalPnl >= 0 ? 'WIN' : 'LOSS',
          detail: `24/7 Server Monitor booked final runner at TP3 (${roundPx(pos.target3)})`,
        });
        continue;
      }

      // 3. TP2 Hit -> Ratchet SL to TP1 + optional 30% partial booking
      if (tp2Hit && pos.tpStage < 2) {
        let bookedPnl = 0;
        let nextRemQty = pos.remainingQuantity;
        if (pos.enablePartialProfitBooking && pos.remainingQuantity > 0) {
          // If skipped TP1 in a fast candle, book 70% (40% + 30%); else book 30% of original qty
          const portion = pos.tpStage === 0 ? 0.7 : 0.3;
          const closeQty = Math.min(pos.remainingQuantity, Number((pos.quantity * portion).toFixed(4)));
          const diff = isBuy ? pos.target2 - pos.entryPrice : pos.entryPrice - pos.target2;
          bookedPnl = Number((diff * closeQty).toFixed(2));
          nextRemQty = Math.max(0, Number((pos.remainingQuantity - closeQty).toFixed(4)));
        }

        const newSl = roundPx(pos.target1);
        pos.tpStage = 2;
        pos.stopLoss = newSl;
        pos.partialRealizedPnl = Number((pos.partialRealizedPnl + bookedPnl).toFixed(2));
        pos.remainingQuantity = nextRemQty;

        if (pos.executionMode === 'LIVE' && pos.brokerOrderId) {
          void forwardExnessTrailSl({
            brokerOrderId: pos.brokerOrderId,
            instrument: pos.symbol,
            newStopLoss: newSl,
            tpStage: 2,
          });
        }

        pushOwnerEvent(pos.ownerKey, {
          tradeId: pos.tradeId,
          type: 'TRAIL_TP2',
          timestamp: nowIso,
          price: roundPx(markPrice),
          newStopLoss: newSl,
          tpStage: 2,
          partialRealizedPnl: pos.partialRealizedPnl,
          remainingQuantity: pos.remainingQuantity,
          detail: `TP2 hit @ ${roundPx(markPrice)} -> SL trailed to TP1 (${newSl})${bookedPnl !== 0 ? ` · Booked partial ${bookedPnl >= 0 ? '+' : ''}${bookedPnl}` : ''}`,
        });
        continue;
      }

      // 4. TP1 Hit -> Ratchet SL to Breakeven + buffer + optional 40% partial booking
      if (tp1Hit && pos.tpStage < 1) {
        const riskDist = Math.abs(pos.entryPrice - pos.stopLoss);
        const beBuffer = Math.max(riskDist * 0.04, pos.entryPrice * 0.0002);
        const newSl = roundPx(isBuy ? pos.entryPrice + beBuffer : pos.entryPrice - beBuffer);

        let bookedPnl = 0;
        let nextRemQty = pos.remainingQuantity;
        if (pos.enablePartialProfitBooking && pos.remainingQuantity > 0) {
          const closeQty = Math.min(pos.remainingQuantity, Number((pos.quantity * 0.4).toFixed(4)));
          const diff = isBuy ? pos.target1 - pos.entryPrice : pos.entryPrice - pos.target1;
          bookedPnl = Number((diff * closeQty).toFixed(2));
          nextRemQty = Math.max(0, Number((pos.remainingQuantity - closeQty).toFixed(4)));
        }

        pos.tpStage = 1;
        pos.stopLoss = newSl;
        pos.partialRealizedPnl = Number((pos.partialRealizedPnl + bookedPnl).toFixed(2));
        pos.remainingQuantity = nextRemQty;

        if (pos.executionMode === 'LIVE' && pos.brokerOrderId) {
          void forwardExnessTrailSl({
            brokerOrderId: pos.brokerOrderId,
            instrument: pos.symbol,
            newStopLoss: newSl,
            tpStage: 1,
          });
        }

        pushOwnerEvent(pos.ownerKey, {
          tradeId: pos.tradeId,
          type: 'TRAIL_TP1',
          timestamp: nowIso,
          price: roundPx(markPrice),
          newStopLoss: newSl,
          tpStage: 1,
          partialRealizedPnl: pos.partialRealizedPnl,
          remainingQuantity: pos.remainingQuantity,
          detail: `TP1 hit @ ${roundPx(markPrice)} -> SL moved to Breakeven (${newSl})${bookedPnl !== 0 ? ` · Booked 40% partial ${bookedPnl >= 0 ? '+' : ''}${bookedPnl}` : ''}`,
        });
      }
    }
  } finally {
    workerRunning = false;
  }
}

export function startPositionMonitorWorker(): void {
  if (workerTimer) return;
  workerTimer = setInterval(() => {
    void runMonitorTick();
  }, MONITOR_INTERVAL_MS);
  workerTimer.unref?.();
}

export function getGlobalMonitorStats(): { totalTracked: number; intervalMs: number } {
  let active = 0;
  for (const pos of trackedPositions.values()) {
    if (!pos.closed) active++;
  }
  return { totalTracked: active, intervalMs: MONITOR_INTERVAL_MS };
}
