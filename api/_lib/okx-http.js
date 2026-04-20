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

// ===== OI 数据 (公开端点, 无需认证) =====

async function getOiChanges() {
  try {
    const res = await httpGet(`${OKX_BASE}/api/v5/public/open-interest?instType=SWAP`);
    return res?.data || null;
  } catch { return null; }
}

// ===== 综合扫描 =====

async function fullScan() {
  console.log('[OKX-HTTP] 开始扫描...');
  const results = {};

  const [spotTickers, oiChanges, news, importantNews, sentimentRank] = await Promise.allSettled([
    getSpotTickers(),
    getOiChanges(),
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

  results.oiChanges = oiChanges.status === 'fulfilled' ? oiChanges.value : null;
  results.news = news.status === 'fulfilled' ? news.value : null;
  results.importantNews = importantNews.status === 'fulfilled' ? importantNews.value : null;
  results.sentimentRank = sentimentRank.status === 'fulfilled' ? sentimentRank.value : null;

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

module.exports = { fullScan, getSpotTickers, getSwapTickers, getOpenInterest, getNews, getOiChanges };
