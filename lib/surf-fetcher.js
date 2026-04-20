/**
 * Surf 数据获取封装
 * 使用 Surf CLI (crypto data platform) 获取社交/链上/市场数据
 */
const { execSync } = require('child_process');

const CLI_TIMEOUT = 30000;
const SURF_BIN = 'C:\\Users\\admin\\.surf\\bin\\surf.exe';

/**
 * 通过 surf CLI 执行命令 (返回 JSON)
 */
function runSurfCmd(args) {
  try {
    const cmd = `"${SURF_BIN}" ${args} --json`;
    const output = execSync(cmd, {
      timeout: CLI_TIMEOUT,
      encoding: 'utf-8',
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, http_proxy: '', https_proxy: '', HTTP_PROXY: '', HTTPS_PROXY: '' },
    });
    const parsed = JSON.parse(output.trim());
    return parsed.data || parsed;
  } catch (err) {
    const stdout = err.stdout ? err.stdout.toString().slice(0, 300) : '';
    console.error(`[Surf] 命令失败: surf ${args}`, stdout.includes('error') ? stdout.slice(0, 150) : '');
    // 尝试从 stdout 解析错误 JSON
    try {
      const errJson = JSON.parse(stdout);
      if (errJson.data) return errJson.data;
    } catch {}
    return null;
  }
}

/**
 * 社交 Mindshare 排名 — 热门项目
 */
function getSocialRanking(opts = {}) {
  let args = 'social-ranking';
  if (opts.limit) args += ` --limit ${opts.limit}`;
  if (opts.timeRange) args += ` --time-range ${opts.timeRange}`;
  return runSurfCmd(args);
}

/**
 * 项目社交情绪
 */
function getSocialSentiment(symbol) {
  return runSurfCmd(`social-sentiment --q ${symbol}`);
}

/**
 * 社交详情 (聚合分析)
 */
function getSocialDetail(symbol, timeRange = '24h') {
  return runSurfCmd(`social-detail --q ${symbol} --time-range ${timeRange}`);
}

/**
 * 代币 DEX 交易数据
 */
function getTokenDexTrades(address, chain = 'ethereum') {
  return runSurfCmd(`token-dex-trades --address ${address} --chain ${chain} --limit 20`);
}

/**
 * 市场价格
 */
function getMarketPrice(symbol) {
  return runSurfCmd(`market-price --symbol ${symbol}`);
}

/**
 * 新闻动态
 */
function getNewsFeed(opts = {}) {
  let args = 'news-feed';
  if (opts.limit) args += ` --limit ${opts.limit}`;
  if (opts.source) args += ` --source ${opts.source}`;
  return runSurfCmd(args);
}

/**
 * 新闻搜索
 */
function searchNews(keyword) {
  return runSurfCmd(`search-news --q "${keyword}" --limit 10`);
}

/**
 * 代币持有者
 */
function getTokenHolders(address, chain = 'ethereum') {
  return runSurfCmd(`token-holders --address ${address} --chain ${chain} --limit 20`);
}

/**
 * 市场排名
 */
function getMarketRanking(opts = {}) {
  let args = 'market-ranking';
  if (opts.sortBy) args += ` --sort-by ${opts.sortBy}`;
  if (opts.limit) args += ` --limit ${opts.limit}`;
  return runSurfCmd(args);
}

/**
 * 恐惧贪婪指数
 */
function getFearGreedIndex() {
  return runSurfCmd('market-fear-greed');
}

/**
 * 项目 Pulse (最新动态)
 */
function getProjectPulse(symbol) {
  return runSurfCmd(`project-pulse --q ${symbol} --limit 5`);
}

/**
 * Exchange Listing 事件 (新上所)
 */
function getListingEvents(opts = {}) {
  let args = 'listing';
  if (opts.limit) args += ` --limit ${opts.limit}`;
  if (opts.exchange) args += ` --exchange ${opts.exchange}`;
  return runSurfCmd(args);
}

/**
 * 综合 Surf 扫描
 */
async function fullScan() {
  console.log('[Surf] 开始社交和链上数据扫描...');
  const results = {};

  try {
    // 1. 社交热度排名 (24h)
    results.socialRanking = getSocialRanking({ limit: 30, timeRange: '24h' });

    // 2. 新闻动态
    results.newsFeed = getNewsFeed({ limit: 30 });

    // 3. 恐惧贪婪指数
    results.fearGreed = getFearGreedIndex();

    // 4. 新上所事件
    results.listings = getListingEvents({ limit: 20 });

    console.log('[Surf] 扫描完成', {
      socialRanking: results.socialRanking ? `${Array.isArray(results.socialRanking) ? results.socialRanking.length : 'obj'}` : 'FAIL',
      newsFeed: results.newsFeed ? 'OK' : 'FAIL',
      fearGreed: results.fearGreed ? 'OK' : 'FAIL',
      listings: results.listings ? 'OK' : 'FAIL',
    });
  } catch (err) {
    console.error('[Surf] 扫描异常:', err.message);
  }

  return results;
}

/**
 * 为特定代币获取详细的 Surf 数据
 */
function getTokenDetail(symbol) {
  const results = {};
  results.price = getMarketPrice(symbol);
  results.sentiment = getSocialSentiment(symbol);
  results.social = getSocialDetail(symbol);
  return results;
}

module.exports = {
  runSurfCmd,
  getSocialRanking,
  getSocialSentiment,
  getSocialDetail,
  getTokenDexTrades,
  getMarketPrice,
  getNewsFeed,
  searchNews,
  getTokenHolders,
  getMarketRanking,
  getFearGreedIndex,
  getProjectPulse,
  getListingEvents,
  getTokenDetail,
  fullScan,
};
