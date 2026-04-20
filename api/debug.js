/**
 * GET /api/debug — 调试 OKX API 连接状态
 */
const crypto = require('crypto');
const https = require('https');

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers, timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data.slice(0, 500) }); }
      });
    });
    req.on('error', (e) => reject(e));
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const results = {};

  // 1. 检查环境变量
  results.envCheck = {
    OKX_API_KEY: process.env.OKX_API_KEY ? `${process.env.OKX_API_KEY.slice(0, 8)}...` : 'NOT SET',
    OKX_SECRET_KEY: process.env.OKX_SECRET_KEY ? 'SET' : 'NOT SET',
    OKX_PASSPHRASE: process.env.OKX_PASSPHRASE ? 'SET' : 'NOT SET',
  };

  // 2. 测试公开 API (不需要认证)
  try {
    const r = await httpGet('https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT');
    results.publicAPI = { ok: r.body?.code === '0', status: r.status, code: r.body?.code };
  } catch (e) {
    results.publicAPI = { ok: false, error: e.message };
  }

  // 3. 测试 orbit 新闻 API (需要认证)
  try {
    const apiKey = process.env.OKX_API_KEY;
    const secret = process.env.OKX_SECRET_KEY;
    const passphrase = process.env.OKX_PASSPHRASE;
    const path = '/api/v5/orbit/news-search?sortBy=latest&limit=3&detailLvl=brief';
    const ts = new Date().toISOString();
    const sign = crypto.createHmac('sha256', secret).update(ts + 'GET' + path).digest('base64');
    const headers = {
      'OK-ACCESS-KEY': apiKey,
      'OK-ACCESS-SIGN': sign,
      'OK-ACCESS-TIMESTAMP': ts,
      'OK-ACCESS-PASSPHRASE': passphrase,
    };
    const r = await httpGet(`https://www.okx.com${path}`, headers);
    results.newsAPI = {
      ok: r.body?.code === '0',
      status: r.status,
      code: r.body?.code,
      msg: r.body?.msg,
      detailsCount: r.body?.data?.details?.length || 0,
      rawDataType: typeof r.body?.data,
      rawDataPreview: JSON.stringify(r.body?.data).slice(0, 300),
    };
  } catch (e) {
    results.newsAPI = { ok: false, error: e.message };
  }

  // 4. 测试情绪排名 API
  try {
    const apiKey = process.env.OKX_API_KEY;
    const secret = process.env.OKX_SECRET_KEY;
    const passphrase = process.env.OKX_PASSPHRASE;
    const path = '/api/v5/orbit/currency-sentiment-ranking?period=24h';
    const ts = new Date().toISOString();
    const sign = crypto.createHmac('sha256', secret).update(ts + 'GET' + path).digest('base64');
    const headers = {
      'OK-ACCESS-KEY': apiKey,
      'OK-ACCESS-SIGN': sign,
      'OK-ACCESS-TIMESTAMP': ts,
      'OK-ACCESS-PASSPHRASE': passphrase,
    };
    const r = await httpGet(`https://www.okx.com${path}`, headers);
    results.sentimentAPI = {
      ok: r.body?.code === '0',
      status: r.status,
      code: r.body?.code,
      msg: r.body?.msg,
      dataLength: Array.isArray(r.body?.data) ? r.body.data.length : 'not array',
      rawDataPreview: JSON.stringify(r.body?.data).slice(0, 300),
    };
  } catch (e) {
    results.sentimentAPI = { ok: false, error: e.message };
  }

  res.json(results);
};
