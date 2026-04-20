/**
 * Surf HTTP API 数据获取 (Vercel serverless 兼容)
 * 直接请求 Surf REST API
 */
const https = require('https');

const SURF_BASE = 'https://api.asksurf.ai/gateway/v1';

function surfGet(path, params = {}) {
  return new Promise((resolve) => {
    const qs = new URLSearchParams(params).toString();
    const url = `${SURF_BASE}${path}${qs ? '?' + qs : ''}`;
    const headers = {};
    if (process.env.SURF_API_KEY) {
      headers['Authorization'] = `Bearer ${process.env.SURF_API_KEY}`;
    }
    const req = https.get(url, { headers, timeout: 15000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.data || parsed);
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

async function getSocialRanking(limit = 30, timeRange = '24h') {
  return surfGet('/social/ranking', { limit, 'time-range': timeRange });
}

async function getNewsFeed(limit = 30) {
  return surfGet('/news/feed', { limit });
}

async function getFearGreed() {
  return surfGet('/market/fear-greed');
}

async function getMarketRanking(limit = 30) {
  return surfGet('/market/ranking', { limit, 'sort-by': 'volume_24h', order: 'desc' });
}

async function fullScan() {
  console.log('[Surf-HTTP] 开始扫描...');
  const results = {};

  const [socialRanking, newsFeed, fearGreed] = await Promise.allSettled([
    getSocialRanking(30, '24h'),
    getNewsFeed(30),
    getFearGreed(),
  ]);

  results.socialRanking = socialRanking.status === 'fulfilled' ? socialRanking.value : null;
  results.newsFeed = newsFeed.status === 'fulfilled' ? newsFeed.value : null;
  results.fearGreed = fearGreed.status === 'fulfilled' ? fearGreed.value : null;

  console.log('[Surf-HTTP] 扫描完成', {
    socialRanking: Array.isArray(results.socialRanking) ? results.socialRanking.length : (results.socialRanking ? 'obj' : 'FAIL'),
    newsFeed: results.newsFeed ? 'OK' : 'FAIL',
    fearGreed: results.fearGreed ? 'OK' : 'FAIL',
  });

  return results;
}

module.exports = { fullScan, getSocialRanking, getNewsFeed, getFearGreed, getMarketRanking };
