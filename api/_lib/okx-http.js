/**
 * OKX HTTP API 数据获取 (Vercel serverless 兼容)
 * 公开 Market API 无需认证
 * 新闻/情绪 API 使用 /api/v5/orbit/ 端点, 需要 GET + 签名
 */
const https = require('https');
const crypto = require('crypto');

const OKX_BASE = 'https://www.okx.com';

// ===== HTTP 工具 =====

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers, timeout: 15000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// ===== OKX 签名 (GET 请求: timestamp + GET + path?query) =====

function signOkx(timestamp, method, requestPath) {
  const secretKey = process.env.OKX_SECRET_KEY;
  if (!secretKey) return null;
  const prehash = timestamp + method + requestPath;
  return crypto.createHmac('sha256', secretKey).update(prehash).digest('base64');
}

function authGet(path, query = {}) {
  const apiKey = process.env.OKX_API_KEY;
  const passphrase = process.env.OKX_PASSPHRASE;
  if (!apiKey) return Promise.resolve(null);

  // 构造 query string
  const qs = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  const fullPath = qs ? `${path}?${qs}` : path;

  const ts = new Date().toISOString();
  const sign = signOkx(ts, 'GET', fullPath);
  const headers = {
    'OK-ACCESS-KEY': apiKey,
    'OK-ACCESS-SIGN': sign,
    'OK-ACCESS-TIMESTAMP': ts,
    'OK-ACCESS-PASSPHRASE': passphrase,
  };
  return httpGet(`${OKX_BASE}${fullPath}`, headers);
}

// ===== 公开 Market API (无需认证) =====

async function getSpotTickers() {
  try {
    const res = await httpGet(`${OKX_BASE}/api/v5/market/tickers?instType=SPOT`);
    return res?.data || null;
  } catch { return null; }
}

async function getSwapTickers() {
  try {
    const res = await httpGet(`${OKX_BASE}/api/v5/market/tickers?instType=SWAP`);
    return res?.data || null;
  } catch { return null; }
}

async function getOpenInterest() {
  try {
    const res = await httpGet(`${OKX_BASE}/api/v5/public/open-interest?instType=SWAP`);
    return res?.data || null;
  } catch { return null; }
}

async function getFundingRates() {
  try {
    const res = await httpGet(`${OKX_BASE}/api/v5/public/funding-rate?instId=BTC-USDT-SWAP`);
    return res?.data || null;
  } catch { return null; }
}

// ===== 新闻 API (GET /api/v5/orbit/ + 签名) =====

async function getNews(limit = 30) {
  try {
    const res = await authGet('/api/v5/orbit/news-search', {
      sortBy: 'latest',
      limit,
      detailLvl: 'summary',
    });
    if (!res) return null;
    // 返回格式: { code: "0", data: [{ details: [...] }] }
    const raw = res?.data;
    if (Array.isArray(raw) && raw[0]?.details) return raw[0].details;
    if (raw?.details) return raw.details;
    return raw;
  } catch (e) { console.error('[OKX-HTTP] getNews error:', e.message); return null; }
}

async function getImportantNews(limit = 20) {
  try {
    const res = await authGet('/api/v5/orbit/news-search', {
      sortBy: 'latest',
      importance: 'high',
      limit,
      detailLvl: 'summary',
    });
    if (!res) return null;
    const raw = res?.data;
    if (Array.isArray(raw) && raw[0]?.details) return raw[0].details;
    if (raw?.details) return raw.details;
    return raw;
  } catch (e) { console.error('[OKX-HTTP] getImportantNews error:', e.message); return null; }
}

async function getSentimentRank() {
  try {
    const res = await authGet('/api/v5/orbit/currency-sentiment-ranking', {
      period: '24h',
    });
    if (!res) return null;
    // 返回格式: { code: "0", data: [{ details: [...] }] }
    const raw = res?.data;
    if (Array.isArray(raw) && raw[0]?.details) return raw[0].details;
    if (raw?.details) return raw.details;
    if (Array.isArray(raw)) return raw;
    return raw;
  } catch (e) { console.error('[OKX-HTTP] getSentimentRank error:', e.message); return null; }
}

// ===== OI + 合约数据 (公开端点, 无需认证) =====

const fs = require('fs');
const path = require('path');
const OI_CACHE_FILE = '/tmp/oi-prev.json';

function loadPrevOi() {
  try {
    if (fs.existsSync(OI_CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(OI_CACHE_FILE, 'utf-8'));
    }
  } catch {}
  return {};
}

function saveCurrOi(oiMap) {
  try {
    fs.writeFileSync(OI_CACHE_FILE, JSON.stringify(oiMap));
  } catch {}
}

async function getOiChanges() {
  try {
    const res = await httpGet(`${OKX_BASE}/api/v5/public/open-interest?instType=SWAP`);
    return res?.data || null;
  } catch { return null; }
}

/**
 * 构建合约变化数据 — 合并 OI快照 + SWAP Tickers + 上次OI快照计算变化率
 * 返回格式与本地 CLI 的 market oi-change 对齐:
 * [{ instId, oiDeltaPct, fundingRate, pxChgPct, last, volUsd24h }]
 */
async function buildContractData() {
  // 并行获取 OI 快照 + SWAP 行情
  const [oiRes, swapRes] = await Promise.allSettled([
    getOiChanges(),
    getSwapTickers(),
  ]);

  const oiList = oiRes.status === 'fulfilled' ? oiRes.value : null;
  const swapTickers = swapRes.status === 'fulfilled' ? swapRes.value : null;

  if (!oiList && !swapTickers) return null;

  // 加载上次 OI 快照用于计算变化
  const prevOi = loadPrevOi();
  const currOiMap = {};

  // 构建 OI map: instId -> oi value
  const oiMap = {};
  if (Array.isArray(oiList)) {
    for (const item of oiList) {
      const instId = item.instId;
      const oi = parseFloat(item.oi || 0);
      oiMap[instId] = oi;
      currOiMap[instId] = oi;
    }
  }

  // 构建 SWAP ticker map: instId -> ticker data
  const swapMap = {};
  if (Array.isArray(swapTickers)) {
    for (const t of swapTickers) {
      swapMap[t.instId] = t;
    }
  }

  // 合并构建 oiChanges 数组
  const allInstIds = new Set([...Object.keys(oiMap), ...Object.keys(swapMap)]);
  const combined = [];

  for (const instId of allInstIds) {
    // 只处理 USDT 永续
    if (!instId.endsWith('-USDT-SWAP')) continue;

    const oi = oiMap[instId] || 0;
    const swap = swapMap[instId];
    const prevOiVal = prevOi[instId];

    // 计算 OI 变化百分比
    let oiDeltaPct = 0;
    if (prevOiVal && prevOiVal > 0 && oi > 0) {
      oiDeltaPct = ((oi - prevOiVal) / prevOiVal) * 100;
    }

    // 从 SWAP ticker 获取价格变化和成交量
    let pxChgPct = 0;
    let last = 0;
    let volUsd24h = 0;
    if (swap) {
      last = parseFloat(swap.last || 0);
      const open24h = parseFloat(swap.open24h || 0);
      if (open24h > 0) {
        pxChgPct = ((last - open24h) / open24h) * 100;
      }
      volUsd24h = parseFloat(swap.volCcy24h || swap.vol24h || 0);
    }

    // 只保留有意义的数据（有OI变化或有交易活跃度）
    if (Math.abs(oiDeltaPct) > 0.5 || volUsd24h > 100000) {
      combined.push({
        instId,
        oiDeltaPct: Math.round(oiDeltaPct * 100) / 100,
        fundingRate: 0, // 无法批量获取，暂不填充
        pxChgPct: Math.round(pxChgPct * 100) / 100,
        last,
        volUsd24h,
      });
    }
  }

  // 保存当前 OI 快照供下次使用
  saveCurrOi(currOiMap);

  // 按 OI 变化绝对值排序，取 Top 20
  combined.sort((a, b) => Math.abs(b.oiDeltaPct) - Math.abs(a.oiDeltaPct));
  return combined.slice(0, 20);
}

// ===== 综合扫描 =====

async function fullScan() {
  console.log('[OKX-HTTP] 开始扫描...');
  const results = {};

  const [spotTickers, contractData, news, importantNews, sentimentRank] = await Promise.allSettled([
    getSpotTickers(),
    buildContractData(),
    getNews(30),
    getImportantNews(20),
    getSentimentRank(),
  ]);

  // 处理 Spot Tickers
  const tickers = spotTickers.status === 'fulfilled' ? spotTickers.value : null;
  if (tickers && Array.isArray(tickers)) {
    const withChange = tickers
      .filter(t => t.open24h && parseFloat(t.open24h) > 0)
      .map(t => ({
        instId: t.instId,
        symbol: t.instId.replace('-USDT', '').replace('-USDC', ''),
        last: parseFloat(t.last),
        open24h: parseFloat(t.open24h),
        high24h: parseFloat(t.high24h),
        low24h: parseFloat(t.low24h),
        vol24h: parseFloat(t.volCcy24h || t.vol24h || 0),
        change24hPct: ((parseFloat(t.last) - parseFloat(t.open24h)) / parseFloat(t.open24h)) * 100,
      }));
    results.topGainers = withChange.sort((a, b) => b.change24hPct - a.change24hPct).slice(0, 20);
    results.topVolume = withChange.filter(t => t.instId.endsWith('-USDT')).sort((a, b) => b.vol24h - a.vol24h).slice(0, 20);
  }

  results.oiChanges = contractData.status === 'fulfilled' ? contractData.value : null;
  results.news = news.status === 'fulfilled' ? news.value : null;
  results.importantNews = importantNews.status === 'fulfilled' ? importantNews.value : null;
  results.sentimentRank = sentimentRank.status === 'fulfilled' ? sentimentRank.value : null;

  // 大盘背景 — BTC/ETH 行情
  results.marketContext = extractMarketContext(tickers);

  console.log('[OKX-HTTP] 扫描完成', {
    topGainers: results.topGainers?.length || 0,
    topVolume: results.topVolume?.length || 0,
    oiChanges: Array.isArray(results.oiChanges) ? results.oiChanges.length : 0,
    news: Array.isArray(results.news) ? results.news.length : 0,
    importantNews: Array.isArray(results.importantNews) ? results.importantNews.length : 0,
    sentimentRank: Array.isArray(results.sentimentRank) ? results.sentimentRank.length : 0,
  });
  return results;
}

function extractMarketContext(spotTickers) {
  const ctx = { btc: null, eth: null, timestamp: Date.now() };
  if (!spotTickers || !Array.isArray(spotTickers)) return ctx;
  for (const t of spotTickers) {
    const id = t.instId;
    if (id === 'BTC-USDT' || id === 'ETH-USDT') {
      const last = parseFloat(t.last);
      const open = parseFloat(t.open24h);
      const high = parseFloat(t.high24h);
      const low = parseFloat(t.low24h);
      const vol = parseFloat(t.volCcy24h || t.vol24h || 0);
      const change = open > 0 ? ((last - open) / open) * 100 : 0;
      const entry = { price: last, change24hPct: Math.round(change * 100) / 100, high24h: high, low24h: low, vol24h: vol };
      if (id === 'BTC-USDT') ctx.btc = entry;
      else ctx.eth = entry;
    }
  }
  return ctx;
}

module.exports = { fullScan, getSpotTickers, getSwapTickers, getOpenInterest, getNews, getOiChanges };
