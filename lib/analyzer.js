/**
 * 妖币特征匹配引擎
 * 
 * 妖币共同特征评分体系:
 * - 新闻热度 (15%)  — 短时间内出现多条相关新闻
 * - 社交热度 (20%)  — Twitter 提及量激增、趋势排名上升
 * - 价格异动 (15%)  — 短期涨幅超过阈值
 * - 成交量异动 (15%) — 24h 成交量相对暴增
 * - 合约数据 (15%)  — OI 快速增长、资金费率偏高
 * - 链上活跃 (10%)  — DEX 交易活跃度突增
 * - 情绪指标 (10%)  — 新闻/社交情绪偏正面
 * 
 * 总分 >= 40 触发告警, >= 65 高优先级
 * 
 * 方向判断:
 * - 做多: 价格上涨 + OI增长 + 正费率 + 正面情绪
 * - 做空: 价格暴涨后高费率(过热) / 价格暴跌 + OI增长(空头主导)
 */

const learner = require('./learner');

const WEIGHTS = {
  newsHeat:     0.15,
  socialHeat:   0.20,
  priceAction:  0.15,
  volumeSpike:  0.15,
  contractData: 0.15,
  onChain:      0.10,
  sentiment:    0.10,
};

// 主流币过滤 (这些币永远不会是“妖币”)
const MAINSTREAM_COINS = new Set([
  'BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'DOGE', 'AVAX', 'DOT', 'MATIC',
  'LINK', 'SHIB', 'TRX', 'UNI', 'ATOM', 'LTC', 'FIL', 'NEAR', 'APT', 'ARB',
  'OP', 'AAVE', 'MKR', 'CRV', 'COMP', 'SNX', 'RUNE', 'INJ', 'SUI', 'SEI',
  'USDT', 'USDC', 'BUSD', 'DAI', 'FDUSD', 'TUSD', 'USDJ', 'EURT',
  'STETH', 'WBTC', 'OKB', 'BGB', 'LEO', 'CRO', 'GT', 'HT', 'KCS',
]);

// 阈值配置
const THRESHOLDS = {
  // 价格
  priceChange24h_high: 50,    // 24h涨幅 > 50% 满分
  priceChange24h_mid: 20,     // 24h涨幅 > 20% 高分
  priceChange24h_low: 8,      // 24h涨幅 > 8% 有分
  // 成交量
  volumeMultiplier_high: 5,   // 成交量是均值5倍以上 满分
  volumeMultiplier_mid: 3,    // 3倍 高分
  volumeMultiplier_low: 1.5,  // 1.5倍 有分
  // 合约
  oiChangePct_high: 30,       // OI变化 > 30% 满分
  oiChangePct_mid: 15,        // OI变化 > 15% 高分
  fundingRate_high: 0.0005,   // 资金费率 > 0.05% 满分 (OKX原始值: 0.0005 = 0.05%)
  fundingRate_mid: 0.0002,    // > 0.02% 高分 (OKX原始值: 0.0002 = 0.02%)
  // 新闻
  newsCount_high: 5,          // 5条以上新闻 满分
  newsCount_mid: 3,           // 3条 高分
  // 告警
  alertThreshold: 40,         // 总分 >= 40 触发告警
  highPriorityThreshold: 65,  // >= 65 高优先级
};

/**
 * 计算单项得分 (0-100)
 */
function calcScore(value, low, mid, high) {
  if (value >= high) return 100;
  if (value >= mid) return 60 + (value - mid) / (high - mid) * 40;
  if (value >= low) return 20 + (value - low) / (mid - low) * 40;
  if (value > 0) return Math.min(20, value / low * 20);
  return 0;
}

/**
 * 分析单个代币的妖币特征
 * @param {Object} tokenData - 代币的各维度数据
 * @returns {Object} 评分结果
 */
function analyzeToken(tokenData) {
  const { symbol, instId } = tokenData;
  const scores = {};
  const reasons = [];

  // 1. 价格异动
  const change24h = Math.abs(tokenData.change24hPct || 0);
  scores.priceAction = calcScore(
    change24h,
    THRESHOLDS.priceChange24h_low,
    THRESHOLDS.priceChange24h_mid,
    THRESHOLDS.priceChange24h_high
  );
  if (change24h >= THRESHOLDS.priceChange24h_low) {
    const dir = (tokenData.change24hPct || 0) > 0 ? '↑' : '↓';
    reasons.push(`价格${dir}${change24h.toFixed(1)}%`);
  }

  // 2. 成交量异动
  const volMultiplier = tokenData.volumeMultiplier || 1;
  scores.volumeSpike = calcScore(
    volMultiplier,
    THRESHOLDS.volumeMultiplier_low,
    THRESHOLDS.volumeMultiplier_mid,
    THRESHOLDS.volumeMultiplier_high
  );
  if (volMultiplier >= THRESHOLDS.volumeMultiplier_low) {
    reasons.push(`成交量${volMultiplier.toFixed(1)}x`);
  }

  // 3. 合约数据 (OI变化 + 资金费率)
  const oiChangePct = Math.abs(tokenData.oiChangePct || 0);
  const fundingRate = Math.abs(tokenData.fundingRate || 0);
  const oiScore = calcScore(oiChangePct, 3, THRESHOLDS.oiChangePct_mid, THRESHOLDS.oiChangePct_high);
  const frScore = calcScore(fundingRate, THRESHOLDS.fundingRate_mid * 0.25, THRESHOLDS.fundingRate_mid, THRESHOLDS.fundingRate_high);
  scores.contractData = Math.max(oiScore, frScore);
  if (oiChangePct >= 5) reasons.push(`OI变化${oiChangePct.toFixed(1)}%`);
  if (fundingRate >= 0.0001) reasons.push(`费率${(fundingRate * 100).toFixed(3)}%`);

  // 4. 新闻热度
  const newsCount = tokenData.newsCount || 0;
  scores.newsHeat = calcScore(newsCount, 1, THRESHOLDS.newsCount_mid, THRESHOLDS.newsCount_high);
  if (newsCount >= 2) reasons.push(`${newsCount}条新闻`);

  // 5. 社交热度
  const socialScore = tokenData.socialScore || 0;
  scores.socialHeat = Math.min(100, socialScore);
  if (socialScore >= 30) reasons.push(`社交热度${socialScore.toFixed(0)}`);

  // 6. 链上活跃
  const onchainScore = tokenData.onchainScore || 0;
  scores.onChain = Math.min(100, onchainScore);
  if (onchainScore >= 30) reasons.push('链上活跃');

  // 7. 情绪指标
  const sentimentScore = tokenData.sentimentScore || 0;
  scores.sentiment = Math.min(100, sentimentScore);
  if (sentimentScore >= 50) reasons.push('情绪正面');

  // 计算加权总分 (使用学习调整后的权重)
  const adjustedWeights = learner.getAdjustedWeights();
  let totalScore = 0;
  for (const [key, weight] of Object.entries(adjustedWeights)) {
    totalScore += (scores[key] || 0) * weight;
  }
  totalScore = Math.round(totalScore * 100) / 100;

  // ===== 方向判断 (做多 / 做空 / 观望) =====
  const rawChange = tokenData.change24hPct || 0;
  const rawFundingRate = tokenData.fundingRate || 0;
  const rawOiChange = tokenData.oiChangePct || 0;
  const sentiment = sentimentScore;

  let direction = 'neutral';   // neutral=观望, long=做多, short=做空
  let directionScore = 0;      // 方向置信度 0-100
  const dirReasons = [];

  // --- 做多信号 ---
  let longPoints = 0;
  if (rawChange > 5) { longPoints += 25; dirReasons.push('价格上涨'); }
  if (rawChange > 20) { longPoints += 15; }
  if (rawOiChange > 5) { longPoints += 20; dirReasons.push('OI增长'); }
  if (rawFundingRate > 0 && rawFundingRate < 0.0003) { longPoints += 10; dirReasons.push('费率健康'); }
  if (sentiment > 50) { longPoints += 15; dirReasons.push('情绪正面'); }
  if ((tokenData.socialScore || 0) > 40) { longPoints += 15; dirReasons.push('社交关注'); }

  // --- 回调入场做多 (pullback buy) ---
  // 价格小幅回调 + 情绪/新闻正面 + 费率不高 + OI未崩 = 跌着等你上车
  if (rawChange >= -10 && rawChange <= -1) {
    let pullbackPoints = 0;
    const pullbackReasons = [];
    if (sentiment >= 60) { pullbackPoints += 15; pullbackReasons.push('情绪正面回调'); }
    if ((tokenData.newsCount || 0) >= 3) { pullbackPoints += 10; pullbackReasons.push('新闻驱动'); }
    if (Math.abs(rawFundingRate) < 0.0002) { pullbackPoints += 10; pullbackReasons.push('费率低位'); }
    if (rawOiChange > 0 && rawOiChange < 10) { pullbackPoints += 10; pullbackReasons.push('OI稳定'); }
    if ((tokenData.socialScore || 0) > 30) { pullbackPoints += 10; pullbackReasons.push('社交关注'); }
    if (pullbackPoints >= 25) {
      longPoints += pullbackPoints;
      dirReasons.push('回调入场');
      dirReasons.push(...pullbackReasons);
    }
  }

  // --- 做空信号 ---
  let shortPoints = 0;
  const shortReasons = [];
  // 场景1: 暴涨后过热 (高费率 + 价格已大涨 = 多头拥挤)
  const overheat = learner.getOverheatPatterns();
  const ohConfidence = overheat.confidence || 0;
  if (rawChange > 30 && rawFundingRate > 0.0003) { shortPoints += 35; shortReasons.push('多头过热'); }
  if (rawFundingRate > 0.0005) { shortPoints += 20; shortReasons.push('费率极高'); }
  // 学习到的过热模式 (置信度加权)
  if (ohConfidence > 0.3 && rawChange > (overheat.minChange24h || 60) &&
      rawFundingRate > (overheat.minFundingRate || 0.0004)) {
    const ohBonus = Math.round(25 * ohConfidence);
    shortPoints += ohBonus;
    shortReasons.push(`学习过热(+${ohBonus})`);
  }
  // 场景2: 价格暴跌 + OI增长 = 空头主导
  if (rawChange < -15) { shortPoints += 25; shortReasons.push('价格暴跌'); }
  if (rawChange < -15 && rawOiChange > 5) { shortPoints += 20; shortReasons.push('空头加仓'); }
  // 场景3: 情绪极端负面
  if (sentiment > 0 && sentiment < 25) { shortPoints += 10; shortReasons.push('情绪恐慌'); }
  // 场景4: 价格已翻倍，获利盘压力
  if (rawChange > 80) { shortPoints += 15; shortReasons.push('获利盘压力'); }

  if (longPoints > shortPoints && longPoints >= 25) {
    direction = 'long';
    directionScore = Math.min(100, longPoints);
  } else if (shortPoints > longPoints && shortPoints >= 25) {
    direction = 'short';
    directionScore = Math.min(100, shortPoints);
    dirReasons.length = 0;
    dirReasons.push(...shortReasons);
  } else {
    direction = 'neutral';
    directionScore = Math.max(longPoints, shortPoints);
    dirReasons.length = 0;
    dirReasons.push('信号不明确');
  }

  // 应用僵尸衰减因子
  const decayFactor = learner.getDecayFactor(symbol, tokenData._alertCount || 0);
  if (decayFactor !== 1.0) {
    totalScore = Math.round(totalScore * decayFactor * 100) / 100;
    if (decayFactor < 1.0) reasons.push(`衰减${decayFactor}x`);
    else if (decayFactor > 1.0) reasons.push('首次发现');
  }

  // 确定告警级别
  let level = 'none';
  if (totalScore >= THRESHOLDS.highPriorityThreshold) level = 'high';
  else if (totalScore >= THRESHOLDS.alertThreshold) level = 'medium';
  else if (totalScore >= 25) level = 'low';

  return {
    symbol,
    instId,
    totalScore,
    level,
    direction,           // 'long' | 'short' | 'neutral'
    directionScore,      // 方向置信度 0-100
    directionReasons: dirReasons,
    scores,
    reasons,
    last: tokenData.last,
    change24hPct: tokenData.change24hPct,
    vol24h: tokenData.vol24h,
    fundingRate: tokenData.fundingRate,
    oiChangePct: tokenData.oiChangePct,
    timestamp: Date.now(),
  };
}

/**
 * 从 instId 提取基础币种符号
 * RAVE-USDT → RAVE, CORE-USD → CORE, RAVE-USDT-SWAP → RAVE
 */
function extractSymbol(instId) {
  return (instId || '').split('-')[0];
}

/**
 * 批量分析 — 汇聚 OKX 数据，生成候选代币列表
 */
function analyze(okxData) {
  console.log('[Analyzer] 开始分析...');

  // 提取大盘背景
  const marketContext = okxData.marketContext || { btc: null, eth: null, timestamp: Date.now() };
  const tokenMap = new Map();

  // Step 1: 从 OKX 涨幅榜提取候选
  if (okxData.topGainers) {
    for (const t of okxData.topGainers) {
      const sym = extractSymbol(t.instId);
      if (!sym) continue;
      if (!tokenMap.has(sym)) tokenMap.set(sym, { symbol: sym, instId: t.instId });
      const data = tokenMap.get(sym);
      // 优先保留 USDT 交易对信息
      if (t.instId.includes('-USDT')) data.instId = t.instId;
      data.last = t.last;
      data.change24hPct = t.change24hPct;
      data.vol24h = Math.max(data.vol24h || 0, t.vol24h); // 取最大成交量
      data.open24h = t.open24h;
    }
  }

  // Step 2: 从成交量榜合并
  if (okxData.topVolume) {
    for (const t of okxData.topVolume) {
      const sym = extractSymbol(t.instId);
      if (!sym) continue;
      if (!tokenMap.has(sym)) tokenMap.set(sym, { symbol: sym, instId: t.instId });
      const data = tokenMap.get(sym);
      if (t.instId.includes('-USDT')) data.instId = t.instId;
      data.last = data.last || t.last;
      data.change24hPct = data.change24hPct || t.change24hPct;
      data.vol24h = Math.max(data.vol24h || 0, t.vol24h);
    }
  }

  // Step 3: 从 OI 变化数据中合并
  if (Array.isArray(okxData.oiChanges)) {
    for (const item of okxData.oiChanges) {
      const sym = extractSymbol(item.instId);
      if (!sym) continue;
      if (!tokenMap.has(sym)) tokenMap.set(sym, { symbol: sym, instId: item.instId });
      const data = tokenMap.get(sym);
      data.oiChangePct = parseFloat(item.oiDeltaPct || item.oiChgPct || 0);
      data.fundingRate = parseFloat(item.fundingRate || 0);
      // OI 数据中也包含价格变化
      if (!data.change24hPct && item.pxChgPct) {
        data.change24hPct = parseFloat(item.pxChgPct);
      }
      if (!data.last && item.last) {
        data.last = parseFloat(item.last);
      }
      if (!data.vol24h && item.volUsd24h) {
        data.vol24h = parseFloat(item.volUsd24h);
      }
    }
  }

  // Step 4: 从新闻中统计每个币的新闻数量
  const newsCoinCount = {};
  if (Array.isArray(okxData.news)) {
    for (const article of okxData.news) {
      // OKX news 格式: ccyList 是币种数组
      const coins = article.ccyList || article.coins || article.relatedCoins || [];
      for (const coin of (Array.isArray(coins) ? coins : [coins])) {
        const sym = (typeof coin === 'string' ? coin : coin.symbol || coin.name || '').toUpperCase();
        if (sym) {
          const weight = article.importance === 'high' ? 2 : 1;
          newsCoinCount[sym] = (newsCoinCount[sym] || 0) + weight;
        }
      }
    }
  }
  if (Array.isArray(okxData.importantNews)) {
    for (const article of okxData.importantNews) {
      const coins = article.ccyList || article.coins || article.relatedCoins || [];
      for (const coin of (Array.isArray(coins) ? coins : [coins])) {
        const sym = (typeof coin === 'string' ? coin : coin.symbol || coin.name || '').toUpperCase();
        if (sym) newsCoinCount[sym] = (newsCoinCount[sym] || 0) + 3;
      }
    }
  }
  for (const [sym, count] of Object.entries(newsCoinCount)) {
    if (!tokenMap.has(sym)) tokenMap.set(sym, { symbol: sym });
    tokenMap.get(sym).newsCount = count;
  }

  // Step 5: 从 OKX sentiment-rank 合并社交热度 + 情绪
  if (Array.isArray(okxData.sentimentRank)) {
    for (const item of okxData.sentimentRank) {
      const sym = (item.ccy || item.coin || item.symbol || '').toUpperCase();
      if (!sym) continue;
      if (!tokenMap.has(sym)) tokenMap.set(sym, { symbol: sym });
      const data = tokenMap.get(sym);

      // 社交热度: 基于 X(Twitter) 提及量
      const xMentions = parseInt(item.xMentionCnt || 0);
      const totalMentions = parseInt(item.mentionCnt || 0);
      // 提及量越高分越高, 超过500次满分, 100次以上高分, 20次以上有分
      data.socialScore = Math.max(data.socialScore || 0, calcScore(totalMentions, 20, 100, 500));
      data.xMentionCnt = xMentions;
      data.totalMentionCnt = totalMentions;

      // 情绪指标: 基于 bullish/bearish 比例
      if (item.sentiment) {
        const bullRatio = parseFloat(item.sentiment.bullishRatio || 0);
        const bearRatio = parseFloat(item.sentiment.bearishRatio || 0);
        // bullishRatio 0~1, 转为 0~100 分数
        const sentVal = (bullRatio - bearRatio + 1) * 50; // 范围 0~100
        data.sentimentScore = Math.max(data.sentimentScore || 0, Math.min(100, sentVal));
        data.sentimentLabel = item.sentiment.label; // 'bullish'/'bearish'/'neutral'
        if (item.sentiment.label === 'bullish') {
          data.sentimentScore = Math.max(data.sentimentScore, 65);
        }
      }
    }
  }

  // Step 6: 从新闻中提取币种计数 (补充)
  if (Array.isArray(okxData.news)) {
    for (const article of okxData.news) {
      const title = (article.title || '') + ' ' + (article.content || article.summary || '');
      for (const [sym] of tokenMap) {
        if (sym.length >= 3 && title.toUpperCase().includes(sym)) {
          const data = tokenMap.get(sym);
          data.newsCount = (data.newsCount || 0) + 0.5; // 文本匹配权重较低
        }
      }
    }
  }

  // Step 6.5: 计算成交量倍数 (基于当前扫描中位数作为基线)
  const allVols = [...tokenMap.values()]
    .map(t => t.vol24h)
    .filter(v => v && v > 0)
    .sort((a, b) => a - b);
  const medianVol = allVols.length > 0 ? allVols[Math.floor(allVols.length / 2)] : 0;
  if (medianVol > 0) {
    for (const data of tokenMap.values()) {
      if (data.vol24h && data.vol24h > 0) {
        data.volumeMultiplier = data.vol24h / medianVol;
      }
    }
  }

  // Step 7: 为每个候选代币评分
  const results = [];
  for (const [, tokenData] of tokenMap) {
    // 过滤主流币、稳定币、无效符号
    const sym = tokenData.symbol || '';
    if (MAINSTREAM_COINS.has(sym)) continue;
    if (sym.length < 2 || sym.length > 15) continue;
    if (sym.includes(' ') || sym.includes("'")) continue; // 过滤非代币符号
    const result = analyzeToken(tokenData);
    if (result.totalScore > 0) {
      results.push(result);
    }
  }

  // 按分数排序
  results.sort((a, b) => b.totalScore - a.totalScore);

  // 过滤出达到告警阈值的
  const alerts = results.filter(r => r.totalScore >= THRESHOLDS.alertThreshold);
  const watchlist = results.filter(r => r.totalScore >= 20 && r.totalScore < THRESHOLDS.alertThreshold).slice(0, 10);

  console.log(`[Analyzer] 分析完成: ${results.length}个代币, ${alerts.length}个告警, ${watchlist.length}个观察`);

  return { alerts, watchlist, allScores: results.slice(0, 50), marketContext };
}

module.exports = {
  analyzeToken,
  analyze,
  WEIGHTS,
  THRESHOLDS,
};
