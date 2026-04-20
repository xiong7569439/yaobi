/**
 * OKX HTTP API 数据获取 (Vercel serverless 兼容)
 * 使用 OKX 公开 REST API，无需认证
 * 新闻 API 需要签名: 通过 AIGC MCP 端点
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

function httpPost(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const postData = JSON.stringify(body);
    const opts = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      timeout: 15000,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        ...headers,
      },
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(postData);
    req.end();
  });
}

// ===== OKX 签名 (用于新闻 API) =====

function signOkx(timestamp, method, path, body = '') {
  const secretKey = process.env.OKX_SECRET_KEY;
  if (!secretKey) return null;
  const prehash = timestamp + method + path + body;
  return crypto.createHmac('sha256', secretKey).update(prehash).digest('base64');
}

function getOkxAuthHeaders(method, path, body = '') {
  const apiKey = process.env.OKX_API_KEY;
  const passphrase = process.env.OKX_PASSPHRASE;
  if (!apiKey) return {};
  const ts = new Date().toISOString();
  const sign = signOkx(ts, method, path, body);
  return {
    'OK-ACCESS-KEY': apiKey,
    'OK-ACCESS-SIGN': sign,
    'OK-ACCESS-TIMESTAMP': ts,
    'OK-ACCESS-PASSPHRASE': passphrase,
  };
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

// ===== 新闻 API (需要签名) =====

async function getNews(limit = 30) {
  try {
    const path = '/api/v5/aigc/mcp/news-latest';
    const body = JSON.stringify({ limit, lang: 'zh-CN' });
    const headers = getOkxAuthHeaders('POST', path, body);
    if (!headers['OK-ACCESS-KEY']) return null;
    const res = await httpPost(`${OKX_BASE}${path}`, { limit, lang: 'zh-CN' }, headers);
    return res?.data?.details || res?.data || null;
  } catch { return null; }
}

async function getImportantNews(limit = 20) {
  try {
    const path = '/api/v5/aigc/mcp/news-important';
    const body = JSON.stringify({ limit, lang: 'zh-CN' });
    const headers = getOkxAuthHeaders('POST', path, body);
    if (!headers['OK-ACCESS-KEY']) return null;
    const res = await httpPost(`${OKX_BASE}${path}`, { limit, lang: 'zh-CN' }, headers);
    return res?.data?.details || res?.data || null;
  } catch { return null; }
}

async function getSentimentRank() {
  try {
    const path = '/api/v5/aigc/mcp/news-sentiment-rank';
    const body = JSON.stringify({ period: '24h', limit: 20 });
    const headers = getOkxAuthHeaders('POST', path, body);
    if (!headers['OK-ACCESS-KEY']) return null;
    const res = await httpPost(`${OKX_BASE}${path}`, { period: '24h', limit: 20 }, headers);
    return res?.data || null;
  } catch { return null; }
}

// ===== OI 变化 (通过 AIGC MCP) =====

async function getOiChanges() {
  try {
    const path = '/api/v5/aigc/mcp/market-oi-change';
    const body = JSON.stringify({ instType: 'SWAP', bar: '1H', sortBy: 'oiDeltaPct', sortOrder: 'desc', limit: 20 });
    const headers = getOkxAuthHeaders('POST', path, body);
    if (!headers['OK-ACCESS-KEY']) return null;
    const res = await httpPost(`${OKX_BASE}${path}`, JSON.parse(body), headers);
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
  });
  return results;
}

module.exports = { fullScan, getSpotTickers, getSwapTickers, getOpenInterest, getNews, getOiChanges };
