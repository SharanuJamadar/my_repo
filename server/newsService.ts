import type {
  GroundingSource,
  LiveMarketNewsResponse,
  MarketNewsCategory,
  MarketNewsItem,
} from '../src/types/trading.ts';

interface RawFeedArticle {
  headline: string;
  summary: string;
  sourceName: string;
  sourceUrl?: string;
  publishedMs: number;
  defaultScope: 'INDIAN' | 'MCX' | 'INTERNATIONAL';
  relatedTickers?: string[];
}

const REQUEST_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'application/rss+xml, application/xml, application/json, text/xml;q=0.9, */*;q=0.8',
};

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;|&#x27;/gi, "'")
    .replace(/&rsquo;|&lsquo;/gi, "'")
    .replace(/&rdquo;|&ldquo;/gi, '"')
    .replace(/&ndash;/gi, '-')
    .replace(/&mdash;/gi, '—')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_m, dec) => {
      const code = Number(dec);
      return Number.isFinite(code) ? String.fromCharCode(code) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCharCode(code) : '';
    });
}

function stripTagsAndClean(raw: string): string {
  const decoded = decodeHtmlEntities(raw);
  return decodeHtmlEntities(decoded.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function extractXmlTag(block: string, tagName: string): string {
  const re = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = block.match(re);
  return match ? match[1].trim() : '';
}

function formatRelativeTime(publishedMs: number): string {
  if (!Number.isFinite(publishedMs) || publishedMs <= 0) return 'Latest';
  const diffSec = Math.max(0, Math.floor((Date.now() - publishedMs) / 1000));
  if (diffSec < 90) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 86400 * 5) return `${Math.floor(diffSec / 86400)}d ago`;
  return new Date(publishedMs).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
  });
}

function parseRssXml(
  xml: string,
  fallbackSourceName: string,
  defaultScope: 'INDIAN' | 'MCX' | 'INTERNATIONAL',
  isGoogleNews = false
): RawFeedArticle[] {
  const items: RawFeedArticle[] = [];
  const itemMatches = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];

  for (const block of itemMatches) {
    const rawTitle = extractXmlTag(block, 'title');
    let headline = stripTagsAndClean(rawTitle);
    if (!headline) continue;

    const rawLink = extractXmlTag(block, 'link');
    const sourceUrl = stripTagsAndClean(rawLink);
    const rawSource = extractXmlTag(block, 'source');
    let sourceName = stripTagsAndClean(rawSource) || fallbackSourceName;

    if (isGoogleNews && headline.includes(' - ')) {
      const lastDash = headline.lastIndexOf(' - ');
      const tail = headline.slice(lastDash + 3).trim();
      if (tail && tail.length <= 45) {
        if (!rawSource) sourceName = tail;
        headline = headline.slice(0, lastDash).trim();
      }
    }

    const rawDesc = extractXmlTag(block, 'description');
    let summary = stripTagsAndClean(rawDesc).replace(/^(Investing\.com|Reuters|Bloomberg)\s*--\s*/i, '');

    // Strip redundant Google News link-echo descriptions or wire prefixes
    const normHead = headline.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 32);
    const normSum = summary.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 32);
    if (!summary || (normHead && normSum.startsWith(normHead))) {
      summary = '';
    }
    if (summary.length > 260) {
      summary = `${summary.slice(0, 257).trim()}...`;
    }

    const pubDateStr = stripTagsAndClean(extractXmlTag(block, 'pubDate'));
    const parsedMs = pubDateStr ? Date.parse(pubDateStr) : Date.now();
    const publishedMs = Number.isFinite(parsedMs) ? parsedMs : Date.now();

    items.push({
      headline,
      summary,
      sourceName,
      sourceUrl: /^https?:\/\//i.test(sourceUrl) ? sourceUrl : undefined,
      publishedMs,
      defaultScope,
    });
  }

  return items;
}

async function fetchRssFeed(
  url: string,
  fallbackSourceName: string,
  defaultScope: 'INDIAN' | 'MCX' | 'INTERNATIONAL',
  isGoogleNews = false
): Promise<RawFeedArticle[]> {
  try {
    const res = await fetch(url, {
      headers: REQUEST_HEADERS,
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    if (!xml || !xml.includes('<item')) return [];
    return parseRssXml(xml, fallbackSourceName, defaultScope, isGoogleNews);
  } catch {
    return [];
  }
}

async function fetchYahooSearchNews(
  searchQuery: string,
  defaultScope: 'INDIAN' | 'MCX' | 'INTERNATIONAL'
): Promise<RawFeedArticle[]> {
  try {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(
      searchQuery
    )}&quotesCount=0&newsCount=10`;
    const res = await fetch(url, {
      headers: REQUEST_HEADERS,
      signal: AbortSignal.timeout(6500),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as any;
    const rows = Array.isArray(data?.news) ? data.news : [];
    return rows
      .filter((r: any) => r && typeof r.title === 'string' && r.title.trim())
      .map((r: any): RawFeedArticle => {
        const tsSec = Number(r.providerPublishTime);
        const publishedMs = Number.isFinite(tsSec) && tsSec > 0 ? tsSec * 1000 : Date.now();
        const rawUrl = typeof r.link === 'string' ? r.link.trim() : '';
        return {
          headline: decodeHtmlEntities(String(r.title)).trim(),
          summary: '',
          sourceName: String(r.publisher || 'Yahoo Finance').trim(),
          sourceUrl: /^https?:\/\//i.test(rawUrl) ? rawUrl : undefined,
          publishedMs,
          defaultScope,
          relatedTickers: Array.isArray(r.relatedTickers)
            ? r.relatedTickers.map((t: unknown) => String(t))
            : undefined,
        };
      });
  } catch {
    return [];
  }
}

function inferMarketScope(
  text: string,
  fallback: 'INDIAN' | 'MCX' | 'INTERNATIONAL'
): 'INDIAN' | 'MCX' | 'INTERNATIONAL' {
  const low = text.toLowerCase();
  if (
    /\b(nifty|sensex|banknifty|bank nifty|rbi|sebi|nse|bse|rupee|inr|india|mumbai|fii|dii|reliance|hdfc|icici|infosys|tcs|sbi|adani|tata|gift nifty)\b/.test(
      low
    )
  ) {
    return 'INDIAN';
  }
  if (
    /\b(gold|silver|crude|oil|brent|wti|opec|mcx|natural gas|copper|bullion|comex|xau|xag|nymex)\b/.test(
      low
    )
  ) {
    return 'MCX';
  }
  if (
    /\b(fed|federal reserve|fomc|powell|nasdaq|s&p|dow|wall street|treasury|bitcoin|btc|ethereum|eth|crypto|solana|xrp|eur\/usd|usd\/jpy|ecb|boe|boj)\b/.test(
      low
    )
  ) {
    return 'INTERNATIONAL';
  }
  return fallback;
}

function inferAffectedAssets(text: string, relatedTickers?: string[]): string[] {
  const assets = new Set<string>();
  const low = text.toLowerCase();

  if (/\bbank\s*nifty\b/.test(low)) assets.add('BANKNIFTY');
  if (/\bnifty\b/.test(low)) assets.add('NIFTY50');
  if (/\bsensex\b/.test(low)) assets.add('SENSEX');
  if (/\breliance\b/.test(low)) assets.add('RELIANCE');
  if (/\bhdfc\b/.test(low)) assets.add('HDFCBANK');
  if (/\bicici\b/.test(low)) assets.add('ICICIBANK');
  if (/\binfosys|\binfy\b/.test(low)) assets.add('INFY');
  if (/\btcs\b/.test(low)) assets.add('TCS');
  if (/\bgold|bullion|xau\b/.test(low)) assets.add('XAUUSD');
  if (/\bsilver|xag\b/.test(low)) assets.add('XAGUSD');
  if (/\bcrude|oil|brent|wti|opec\b/.test(low)) assets.add('CRUDEOIL');
  if (/\bnatural gas|natgas\b/.test(low)) assets.add('MCX_NATURALGAS');
  if (/\bcopper\b/.test(low)) assets.add('MCX_COPPER');
  if (/\bnasdaq|tech stocks|nvidia|apple\b/.test(low)) assets.add('NAS100');
  if (/\bs&p\s*500|wall street|fed|fomc|treasury\b/.test(low)) assets.add('SPX500');
  if (/\bdow\b/.test(low)) assets.add('US30');
  if (/\beur\/?usd|eurozone|ecb\b/.test(low)) assets.add('EURUSD');
  if (/\bgbp\/?usd|pound|sterling\b/.test(low)) assets.add('GBPUSD');
  if (/\busd\/?jpy|yen|boj\b/.test(low)) assets.add('USDJPY');
  if (/\bbitcoin|btc\b/.test(low)) assets.add('BTCUSDT');
  if (/\bethereum|eth\b/.test(low)) assets.add('ETHUSDT');
  if (/\bsolana|sol\b/.test(low)) assets.add('SOLUSDT');
  if (/\bxrp|ripple\b/.test(low)) assets.add('XRPUSDT');

  if (Array.isArray(relatedTickers)) {
    for (const raw of relatedTickers) {
      const t = raw.toUpperCase();
      if (t === '^NSEI') assets.add('NIFTY50');
      else if (t === '^NSEBANK') assets.add('BANKNIFTY');
      else if (t === '^BSESN') assets.add('SENSEX');
      else if (t === 'GC=F') assets.add('XAUUSD');
      else if (t === 'SI=F') assets.add('XAGUSD');
      else if (t === 'CL=F') assets.add('CRUDEOIL');
      else if (t === 'NG=F') assets.add('MCX_NATURALGAS');
      else if (t === 'HG=F') assets.add('MCX_COPPER');
      else if (t === 'BTC-USD') assets.add('BTCUSDT');
      else if (t === 'ETH-USD') assets.add('ETHUSDT');
      else if (t === '^IXIC' || t === 'NQ=F') assets.add('NAS100');
      else if (t === '^GSPC' || t === 'ES=F') assets.add('SPX500');
    }
  }

  return Array.from(assets).slice(0, 5);
}

function inferImpact(text: string): {
  impactDirection: MarketNewsItem['impactDirection'];
  impactLevel: MarketNewsItem['impactLevel'];
} {
  const low = text.toLowerCase();

  const bullishHits = (
    low.match(
      /\b(surge|rally|jump|rise|rises|climb|gain|gains|soar|rebound|record high|bullish|rate cut|cuts rate|dovish|inflow|inflows|beat|beats|upbeat|breakout|boom|stronger)\b/g
    ) ?? []
  ).length;

  const bearishHits = (
    low.match(
      /\b(fall|falls|drop|drops|plunge|slump|crash|sink|tumble|selloff|sell-off|bearish|rate hike|hikes rate|hawkish|outflow|outflows|inflation surge|recession|warning|risks breaking|decline|declines|slips|losses)\b/g
    ) ?? []
  ).length;

  const volatileHits = (
    low.match(
      /\b(volatile|volatility|swing|swings|awaits|ahead of|brace|uncertain|uncertainty|tariff|tariffs|opec|fed decision|rbi policy|cpi|jobs data|mixed)\b/g
    ) ?? []
  ).length;

  let impactDirection: MarketNewsItem['impactDirection'] = 'NEUTRAL';
  if (bullishHits > bearishHits && bullishHits >= 1) {
    impactDirection = 'BULLISH';
  } else if (bearishHits > bullishHits && bearishHits >= 1) {
    impactDirection = 'BEARISH';
  } else if (volatileHits >= 1 || (bullishHits > 0 && bearishHits > 0)) {
    impactDirection = 'VOLATILE';
  }

  const isHighImpact =
    /\b(fed|federal reserve|fomc|rbi|inflation|cpi|gdp|interest rate|rate hike|rate cut|opec|nifty|sensex|gold|crude|oil|bitcoin|tariff|fii|treasury yield|jobs|payroll)\b/.test(
      low
    );
  const isMediumImpact =
    /\b(bank|earnings|quarter|stock|shares|etf|silver|copper|forex|dollar|rupee|ethereum|crypto|rally|drop)\b/.test(
      low
    );

  const impactLevel: MarketNewsItem['impactLevel'] = isHighImpact
    ? 'HIGH'
    : isMediumImpact
      ? 'MEDIUM'
      : 'LOW';

  return { impactDirection, impactLevel };
}

export async function fetchFreeLiveMarketNews(params: {
  category: MarketNewsCategory;
  query?: string;
}): Promise<LiveMarketNewsResponse> {
  const category = params.category || 'ALL';
  const customQuery = (params.query || '').trim().slice(0, 120);
  const nowIso = new Date().toISOString();

  const tasks: Promise<RawFeedArticle[]>[] = [];
  const activeSources: GroundingSource[] = [];

  const yahooIndiaUrl =
    'https://feeds.finance.yahoo.com/rss/2.0/headline?s=%5ENSEI,%5EBSESN,%5ENSEBANK,RELIANCE.NS,HDFCBANK.NS,INFY.NS&region=IN&lang=en-IN';
  const yahooMcxUrl =
    'https://feeds.finance.yahoo.com/rss/2.0/headline?s=GC=F,SI=F,CL=F,NG=F,HG=F&region=US&lang=en-US';
  const yahooGlobalUrl =
    'https://feeds.finance.yahoo.com/rss/2.0/headline?s=%5EGSPC,%5EIXIC,EURUSD=X,USDJPY=X,BTC-USD,ETH-USD&region=US&lang=en-US';
  const etMarketsUrl = 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms';
  const cnbcMarketsUrl = 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=15839069';
  const coinDeskUrl = 'https://www.coindesk.com/arc/outboundfeeds/rss/';

  if (customQuery) {
    const scopeHint: 'INDIAN' | 'MCX' | 'INTERNATIONAL' =
      category === 'INDIAN' ? 'INDIAN' : category === 'MCX' ? 'MCX' : 'INTERNATIONAL';
    tasks.push(fetchYahooSearchNews(customQuery, scopeHint));
    tasks.push(
      fetchRssFeed(
        `https://news.google.com/rss/search?q=${encodeURIComponent(
          `${customQuery} market OR stock OR price`
        )}&hl=en-IN&gl=IN&ceid=IN:en`,
        'Google News',
        scopeHint,
        true
      )
    );
    activeSources.push(
      { title: 'Yahoo Finance Search', uri: `https://finance.yahoo.com/lookup?s=${encodeURIComponent(customQuery)}` },
      { title: 'Google News Markets', uri: `https://news.google.com/search?q=${encodeURIComponent(customQuery)}` }
    );
  }

  if (category === 'ALL' || category === 'INDIAN') {
    tasks.push(fetchRssFeed(yahooIndiaUrl, 'Yahoo Finance India', 'INDIAN'));
    tasks.push(fetchRssFeed(etMarketsUrl, 'Economic Times Markets', 'INDIAN'));
    tasks.push(
      fetchRssFeed(
        'https://news.google.com/rss/search?q=Nifty+OR+Sensex+OR+RBI+OR+Indian+stock+market&hl=en-IN&gl=IN&ceid=IN:en',
        'Google News India',
        'INDIAN',
        true
      )
    );
    activeSources.push(
      { title: 'Yahoo Finance India', uri: 'https://finance.yahoo.com/markets/' },
      { title: 'Economic Times Markets', uri: 'https://economictimes.indiatimes.com/markets' },
      { title: 'Google News India', uri: 'https://news.google.com/' }
    );
  }

  if (category === 'ALL' || category === 'MCX') {
    tasks.push(fetchRssFeed(yahooMcxUrl, 'Yahoo Finance Commodities', 'MCX'));
    tasks.push(fetchYahooSearchNews('gold crude oil silver', 'MCX'));
    tasks.push(
      fetchRssFeed(
        'https://news.google.com/rss/search?q=Gold+OR+Silver+OR+Crude+Oil+OR+MCX+commodity&hl=en-IN&gl=IN&ceid=IN:en',
        'Google News Commodities',
        'MCX',
        true
      )
    );
    activeSources.push(
      { title: 'Yahoo Commodities', uri: 'https://finance.yahoo.com/commodities' }
    );
  }

  if (category === 'ALL' || category === 'INTERNATIONAL') {
    tasks.push(fetchRssFeed(yahooGlobalUrl, 'Yahoo Finance Global', 'INTERNATIONAL'));
    tasks.push(fetchRssFeed(cnbcMarketsUrl, 'CNBC Markets', 'INTERNATIONAL'));
    tasks.push(fetchRssFeed(coinDeskUrl, 'CoinDesk', 'INTERNATIONAL'));
    tasks.push(
      fetchRssFeed(
        'https://news.google.com/rss/search?q=Federal+Reserve+OR+NASDAQ+OR+Bitcoin+OR+Forex+market&hl=en-US&gl=US&ceid=US:en',
        'Google News Global',
        'INTERNATIONAL',
        true
      )
    );
    activeSources.push(
      { title: 'Yahoo Finance Global', uri: 'https://finance.yahoo.com/' },
      { title: 'CNBC Markets', uri: 'https://www.cnbc.com/markets/' },
      { title: 'CoinDesk', uri: 'https://www.coindesk.com/' }
    );
  }

  const settled = await Promise.all(tasks);
  const combined = settled.flat();

  // Sort newest first
  combined.sort((a, b) => b.publishedMs - a.publishedMs);

  const queryTokens = customQuery
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);

  const seenKeys = new Set<string>();
  const collected: MarketNewsItem[] = [];

  for (const raw of combined) {
    const key = raw.headline
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 56);
    if (!key || seenKeys.has(key)) continue;

    const fullText = `${raw.headline} ${raw.summary}`;
    const marketScope = inferMarketScope(fullText, raw.defaultScope);
    if (category !== 'ALL' && marketScope !== category) {
      if (!customQuery) continue;
    }

    const affectedAssets = inferAffectedAssets(fullText, raw.relatedTickers);

    if (queryTokens.length > 0) {
      const searchable = `${fullText} ${raw.sourceName} ${affectedAssets.join(' ')}`.toLowerCase();
      const matchesAllOrAny =
        queryTokens.length === 1
          ? searchable.includes(queryTokens[0])
          : queryTokens.some((tok) => searchable.includes(tok));
      if (!matchesAllOrAny) continue;
    }

    seenKeys.add(key);

    const { impactDirection, impactLevel } = inferImpact(fullText);

    collected.push({
      headline: raw.headline,
      summary:
        raw.summary ||
        `${raw.sourceName} live market update${
          affectedAssets.length > 0 ? ` · Watching ${affectedAssets.join(', ')}` : ''
        }.`,
      impactDirection,
      impactLevel,
      marketScope,
      affectedAssets,
      publishedTime: formatRelativeTime(raw.publishedMs),
      sourceName: raw.sourceName,
      sourceUrl: raw.sourceUrl,
    });
  }

  let items: MarketNewsItem[] = [];
  if (category === 'ALL' && !customQuery) {
    const buckets: Record<'INDIAN' | 'MCX' | 'INTERNATIONAL', MarketNewsItem[]> = {
      INDIAN: collected.filter((i) => i.marketScope === 'INDIAN').slice(0, 6),
      MCX: collected.filter((i) => i.marketScope === 'MCX').slice(0, 6),
      INTERNATIONAL: collected.filter((i) => i.marketScope === 'INTERNATIONAL').slice(0, 6),
    };
    for (let idx = 0; idx < 6; idx++) {
      for (const scope of ['INDIAN', 'MCX', 'INTERNATIONAL'] as const) {
        if (buckets[scope][idx] && items.length < 16) {
          items.push(buckets[scope][idx]);
        }
      }
    }
  } else {
    items = collected.slice(0, 16);
  }

  // Deduplicate active source links
  const uniqueSources: GroundingSource[] = [];
  const seenSrcTitles = new Set<string>();
  for (const s of activeSources) {
    if (seenSrcTitles.has(s.title)) continue;
    seenSrcTitles.add(s.title);
    uniqueSources.push(s);
  }

  const bullCount = items.filter((i) => i.impactDirection === 'BULLISH').length;
  const bearCount = items.filter((i) => i.impactDirection === 'BEARISH').length;
  const skew =
    bullCount > bearCount + 1
      ? 'net bullish'
      : bearCount > bullCount + 1
        ? 'cautious / bearish'
        : 'mixed / two-way';

  const scopeLabel =
    category === 'INDIAN'
      ? 'Indian Equities (NSE / BSE / RBI)'
      : category === 'MCX'
        ? 'Commodities & MCX (Gold, Silver, Crude Oil)'
        : category === 'INTERNATIONAL'
          ? 'Global Macro, US Indices, Forex & Crypto'
          : 'All Global, Commodity & Indian Markets';

  const marketBrief =
    items.length > 0
      ? `Streaming ${items.length} live headlines across ${scopeLabel} from Yahoo Finance, Google News, Economic Times, CNBC & CoinDesk with ${skew} headline sentiment.`
      : `No live headlines matched "${customQuery || category}" across the free Yahoo Finance and market RSS feeds right now.`;

  return {
    category,
    query: customQuery,
    fetchedAt: nowIso,
    marketBrief,
    items,
    groundingSources: uniqueSources,
  };
}
