export type TpLadderZone =
  | 'DRAWDOWN'
  | 'AT_ENTRY'
  | 'ENTRY_TO_TP1'
  | 'TP1_TO_TP2'
  | 'TP2_TO_TP3'
  | 'BEYOND_TP3';

export interface TpLadderMetrics {
  /** Signed favorable price movement from entry (+ in profit, - in drawdown). */
  favorableMove: number;
  /** True initial 1R risk distance (preserved even after SL trails to BE / TP1 lock). */
  initialRisk: number;
  /** Accurate live R-multiple based on true initial risk. */
  liveRMultiple: number | null;
  /** Current position zone along the SL <-> Entry -> TP1 -> TP2 -> TP3 axis. */
  zone: TpLadderZone;
  /**
   * Piecewise progress along the 3-TP ladder [0..100]:
   * - Entry or worse (drawdown) = 0%
   * - Entry -> TP1 = 0% .. 33.33%
   * - TP1   -> TP2 = 33.33% .. 66.67%
   * - TP2   -> TP3 = 66.67% .. 100%
   */
  tpProgressPct: number;
  /**
   * Drawdown progress toward Stop Loss [0..100] when favorableMove < 0 (0 when in profit).
   */
  slDrawdownPct: number;
  /** Compact human-readable status label for the progress bar. */
  statusLabel: string;
}

function parsePlannedRiskReward(riskReward?: string): number | null {
  if (!riskReward) return null;
  const m = riskReward.match(/1\s*:\s*(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const val = Number(m[1]);
  return Number.isFinite(val) && val > 0 ? val : null;
}

/**
 * Resolves the trade's true initial 1R risk distance, avoiding distortion when
 * `currentSl` has already been ratcheted to Breakeven (BE Lock) or TP1 Lock.
 */
export function resolveInitialRisk(params: {
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  currentSl: number;
  initialSl?: number;
  target1: number;
  target2?: number;
  target3?: number;
  tpStage?: 0 | 1 | 2;
  riskReward?: string;
}): number {
  const {
    direction,
    entryPrice,
    currentSl,
    initialSl,
    target1,
    target2,
    target3,
    tpStage = 0,
    riskReward,
  } = params;
  const isBuy = direction === 'BUY';

  // 1. If we explicitly captured initialSl and it sits on the loss side of entry, trust it.
  if (
    typeof initialSl === 'number' &&
    Number.isFinite(initialSl) &&
    initialSl > 0 &&
    (isBuy ? initialSl < entryPrice : initialSl > entryPrice)
  ) {
    return Math.abs(entryPrice - initialSl);
  }

  // 2. If SL has not yet trailed onto/past entry, currentSl IS the initial SL.
  const slOnLossSide =
    Number.isFinite(currentSl) &&
    currentSl > 0 &&
    (isBuy ? currentSl < entryPrice : currentSl > entryPrice);
  if (slOnLossSide && tpStage === 0) {
    return Math.abs(entryPrice - currentSl);
  }

  // 3. Reconstruct initial risk cleanly when SL is already trailed to BE/TP1 Lock.
  const tp1Dist = Math.max(0, isBuy ? target1 - entryPrice : entryPrice - target1);
  const tp2Dist =
    typeof target2 === 'number' && target2 > 0
      ? Math.max(0, isBuy ? target2 - entryPrice : entryPrice - target2)
      : 0;
  const tp3Dist =
    typeof target3 === 'number' && target3 > 0
      ? Math.max(0, isBuy ? target3 - entryPrice : entryPrice - target3)
      : 0;
  const planRR = parsePlannedRiskReward(riskReward);

  if (planRR && planRR > 0) {
    // Legacy signals calculated planRR from target2 (where tp1Dist / (tp2Dist / planRR) ≈ 1.5).
    if (tp2Dist > 0 && tp1Dist > 0) {
      const candidateFromT2 = tp2Dist / planRR;
      const impliedTp1R = tp1Dist / candidateFromT2;
      if (impliedTp1R >= 1.15 && impliedTp1R <= 1.85) {
        return candidateFromT2;
      }
    }
    // Modern signals calculate planRR from target3 (long runner) or furthest target.
    const anchorDist = tp3Dist > 0 ? tp3Dist : tp2Dist > 0 ? tp2Dist : tp1Dist;
    if (anchorDist > 0) {
      return anchorDist / planRR;
    }
  }

  // 4. Fallback: infer from TP1 distance (~0.75R) if SL is already locked in profit.
  if (tp1Dist > 0) {
    return tp1Dist / 0.75;
  }

  return Math.abs(entryPrice - currentSl);
}

/**
 * Computes mathematically exact 3-TP ladder progress and live R-multiple for an active trade.
 */
export function computeTpLadderMetrics(params: {
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  currentSl: number;
  initialSl?: number;
  livePrice: number;
  target1: number;
  target2?: number;
  target3?: number;
  tpStage?: 0 | 1 | 2;
  riskReward?: string;
}): TpLadderMetrics {
  const {
    direction,
    entryPrice,
    currentSl,
    initialSl,
    livePrice,
    target1,
    target2,
    target3,
    tpStage = 0,
    riskReward,
  } = params;
  const isBuy = direction === 'BUY';

  const favorableMove = isBuy ? livePrice - entryPrice : entryPrice - livePrice;
  const initialRisk = resolveInitialRisk({
    direction,
    entryPrice,
    currentSl,
    initialSl,
    target1,
    target2,
    target3,
    tpStage,
    riskReward,
  });

  const liveRMultiple =
    initialRisk > 0 ? Number((favorableMove / initialRisk).toFixed(2)) : null;

  // Strictly ascending favorable target distances from entry
  const rawTp1 = Math.max(0, isBuy ? target1 - entryPrice : entryPrice - target1);
  const tp1Dist = rawTp1 > 0 ? rawTp1 : initialRisk * 0.75;

  const rawTp2 =
    typeof target2 === 'number' && target2 > 0
      ? isBuy
        ? target2 - entryPrice
        : entryPrice - target2
      : 0;
  const tp2Dist = rawTp2 > tp1Dist ? rawTp2 : tp1Dist * 1.85;

  const rawTp3 =
    typeof target3 === 'number' && target3 > 0
      ? isBuy
        ? target3 - entryPrice
        : entryPrice - target3
      : 0;
  const tp3Dist = rawTp3 > tp2Dist ? rawTp3 : tp2Dist * 2.4;

  // Case 1: Trade is in drawdown (moving against entry toward SL)
  if (favorableMove < 0) {
    const activeSlDist =
      (isBuy ? currentSl < entryPrice : currentSl > entryPrice)
        ? Math.abs(entryPrice - currentSl)
        : initialRisk;
    const denom = activeSlDist > 0 ? activeSlDist : initialRisk;
    const slDrawdownPct =
      denom > 0 ? Math.max(0, Math.min(100, (Math.abs(favorableMove) / denom) * 100)) : 0;

    return {
      favorableMove,
      initialRisk,
      liveRMultiple,
      zone: 'DRAWDOWN',
      tpProgressPct: 0,
      slDrawdownPct: Number(slDrawdownPct.toFixed(1)),
      statusLabel: `${Math.round(slDrawdownPct)}% to SL`,
    };
  }

  // Case 2: At exact entry
  if (favorableMove === 0) {
    return {
      favorableMove: 0,
      initialRisk,
      liveRMultiple,
      zone: 'AT_ENTRY',
      tpProgressPct: 0,
      slDrawdownPct: 0,
      statusLabel: 'At Entry · 0%',
    };
  }

  // Case 3: Between Entry and TP1 -> [0% .. 33.33%]
  if (favorableMove < tp1Dist) {
    const legRatio = tp1Dist > 0 ? favorableMove / tp1Dist : 0;
    const tpProgressPct = Math.max(0, Math.min(33.33, legRatio * 33.33));
    return {
      favorableMove,
      initialRisk,
      liveRMultiple,
      zone: 'ENTRY_TO_TP1',
      tpProgressPct: Number(tpProgressPct.toFixed(1)),
      slDrawdownPct: 0,
      statusLabel: `${Math.round(legRatio * 100)}% to TP1`,
    };
  }

  // Case 4: Between TP1 and TP2 -> [33.33% .. 66.67%]
  if (favorableMove < tp2Dist) {
    const legSpan = tp2Dist - tp1Dist;
    const legRatio = legSpan > 0 ? (favorableMove - tp1Dist) / legSpan : 1;
    const tpProgressPct = 33.33 + Math.max(0, Math.min(1, legRatio)) * 33.34;
    return {
      favorableMove,
      initialRisk,
      liveRMultiple,
      zone: 'TP1_TO_TP2',
      tpProgressPct: Number(tpProgressPct.toFixed(1)),
      slDrawdownPct: 0,
      statusLabel: `TP1 ✓ · ${Math.round(legRatio * 100)}% to TP2`,
    };
  }

  // Case 5: Between TP2 and TP3 -> [66.67% .. 100%]
  if (favorableMove < tp3Dist) {
    const legSpan = tp3Dist - tp2Dist;
    const legRatio = legSpan > 0 ? (favorableMove - tp2Dist) / legSpan : 1;
    const tpProgressPct = 66.67 + Math.max(0, Math.min(1, legRatio)) * 33.33;
    return {
      favorableMove,
      initialRisk,
      liveRMultiple,
      zone: 'TP2_TO_TP3',
      tpProgressPct: Number(tpProgressPct.toFixed(1)),
      slDrawdownPct: 0,
      statusLabel: `TP2 ✓ · ${Math.round(legRatio * 100)}% to TP3`,
    };
  }

  // Case 6: At or beyond TP3
  return {
    favorableMove,
    initialRisk,
    liveRMultiple,
    zone: 'BEYOND_TP3',
    tpProgressPct: 100,
    slDrawdownPct: 0,
    statusLabel: 'TP3 Reached · 100%',
  };
}
