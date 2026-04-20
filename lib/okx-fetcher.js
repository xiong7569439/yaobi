/**
 * OKX CLI 数据获取封装
 * 通过 child_process 调用 okx CLI 获取市场数据和新闻
 */
const { execSync } = require('child_process');

const CLI_TIMEOUT = 30000; // 30s

function runOkxCmd(args) {
  try {
    const cmd = `okx ${args} --json`;
    const output = execSync(cmd, {
      timeout: CLI_TIMEOUT,
      encoding: 'utf-8',
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });
    const raw = JSON.parse(output.trim());
    // OKX news 端点返回 { details: [...] } 格式
    if (raw && raw.details) return raw.details;
    return raw;
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString() : '';
    console.error(`[OKX] 命令失败: okx ${args}`, stderr.slice(0, 200));
    return null;
  }
}

/**
 * 获取所有 SPOT ticker 数据
 */
function getSpotTickers() {
  return runOkxCmd('market tickers SPOT');
}

/**
 * 获取所有 SWAP ticker 数据
 */
function getSwapTickers() {
  return runOkxCmd('market tickers SWAP');
}

/**
 * 市场筛选 — 按涨幅/成交量/OI 等多维度筛选
 */
function filterMarket(instType = 'SPOT', opts = {}) {
  let args = `market filter --instType ${instType}`;
  if (opts.sortBy) args += ` --sortBy ${opts.sortBy}`;
  if (opts.sortOrder) args += ` --sortOrder ${opts.sortOrder}`;
  if (opts.limit) args += ` --limit ${opts.limit}`;
  if (opts.minChg24hPct) args += ` --minChg24hPct ${opts.minChg24hPct}`;
  if (opts.minVolUsd24h) args += ` --minVolUsd24h ${opts.minVolUsd24h}`;
  return runOkxCmd(args);
}

/**
 * 获取 OI 变化异常的合约 (资金异动)
 */
function getOiChanges(opts = {}) {
  let args = 'market oi-change --instType SWAP';
  if (opts.bar) args += ` --bar ${opts.bar}`;
  if (opts.sortBy) args += ` --sortBy ${opts.sortBy}`;
  if (opts.sortOrder) args += ` --sortOrder ${opts.sortOrder}`;
  if (opts.limit) args += ` --limit ${opts.limit}`;
  return runOkxCmd(args);
}

/**
 * 获取合约资金费率
 */
function getFundingRate(instId) {
  return runOkxCmd(`market funding-rate ${instId}`);
}

/**
 * 获取合约持仓量
 */
function getOpenInterest(instType = 'SWAP') {
  return runOkxCmd(`market open-interest --instType ${instType}`);
}

/**
 * 获取最新加密货币新闻 (需要 API Key)
 */
function getLatestNews(opts = {}) {
  let args = 'news latest';
  if (opts.coins) args += ` --coins ${opts.coins}`;
  if (opts.limit) args += ` --limit ${opts.limit}`;
  if (opts.lang) args += ` --lang ${opts.lang}`;
  return runOkxCmd(args);
}

/**
 * 获取重要新闻 (需要 API Key)
 */
function getImportantNews(opts = {}) {
  let args = 'news important';
  if (opts.limit) args += ` --limit ${opts.limit}`;
  if (opts.lang) args += ` --lang ${opts.lang}`;
  return runOkxCmd(args);
}

/**
 * 币种情绪分析 (需要 API Key)
 */
function getCoinSentiment(coins, period = '24h') {
  return runOkxCmd(`news coin-sentiment --coins ${coins} --period ${period}`);
}

/**
 * 情绪排名 (需要 API Key)
 */
function getSentimentRank(opts = {}) {
  let args = 'news sentiment-rank';
  if (opts.period) args += ` --period ${opts.period}`;
  if (opts.limit) args += ` --limit ${opts.limit}`;
  return runOkxCmd(args);
}

/**
 * 新闻搜索 (需要 API Key)
 */
function searchNews(keyword, opts = {}) {
  let args = `news search --keyword ${keyword}`;
  if (opts.coins) args += ` --coins ${opts.coins}`;
  if (opts.sentiment) args += ` --sentiment ${opts.sentiment}`;
  return runOkxCmd(args);
}

/**
 * 综合扫描 — 获取市场异动代币列表
 * 返回: { topGainers, topVolume, oiChanges, news, sentiment }
 */
async function fullScan() {
  console.log('[OKX] 开始全量扫描...');
  const results = {};

  // 1. SPOT 涨幅榜
  const spotTickers = getSpotTickers();
  if (spotTickers && Array.isArray(spotTickers)) {
    // 计算24h涨幅并排序
    const withChange = spotTickers
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

    // 涨幅前20
    results.topGainers = withChange
      .sort((a, b) => b.change24hPct - a.change24hPct)
      .slice(0, 20);

    // 成交量前20 (USDT交易对)
    results.topVolume = withChange
      .filter(t => t.instId.endsWith('-USDT'))
      .sort((a, b) => b.vol24h - a.vol24h)
      .slice(0, 20);
  }

  // 2. SWAP OI变化
  results.oiChanges = getOiChanges({
    bar: '1H',
    sortBy: 'oiDeltaPct',
    sortOrder: 'desc',
    limit: 20,
  });

  // 3. 新闻 (需要API Key, 可能失败)
  results.news = getLatestNews({ limit: 30, lang: 'zh-CN' });

  // 4. 情绪排名 (需要API Key)
  results.sentimentRank = getSentimentRank({ period: '24h', limit: 20 });

  // 5. 重要新闻
  results.importantNews = getImportantNews({ limit: 20, lang: 'zh-CN' });

  console.log('[OKX] 扫描完成', {
    topGainers: results.topGainers?.length || 0,
    topVolume: results.topVolume?.length || 0,
    oiChanges: Array.isArray(results.oiChanges) ? results.oiChanges.length : 0,
    news: Array.isArray(results.news) ? results.news.length : 0,
  });

  return results;
}

module.exports = {
  runOkxCmd,
  getSpotTickers,
  getSwapTickers,
  filterMarket,
  getOiChanges,
  getFundingRate,
  getOpenInterest,
  getLatestNews,
  getImportantNews,
  getCoinSentiment,
  getSentimentRank,
  searchNews,
  fullScan,
};
