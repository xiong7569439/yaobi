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
  fundingRate_high: 0.05,     // 资金费率 > 0.05% 满分
  fundingRate_mid: 0.02,      // > 0.02% 高分
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
  const frScore = calcScore(fundingRate * 100, 0.3, THRESHOLDS.fundingRate_mid * 100, THRESHOLDS.fundingRate_high * 100);
  scores.contractData = Math.max(oiScore, frScore);
  if (oiChangePct >= 5) reasons.push(`OI变化${oiChangePct.toFixed(1)}%`);
  if (fundingRate >= 0.01) reasons.push(`费率${(fundingRate * 100).toFixed(3)}%`);

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

  // 计算加权总分
  let totalScore = 0;
  for (const [key, weight] of Object.entries(WEIGHTS)) {
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
  if (rawFundingRate > 0 && rawFundingRate < 0.03) { longPoints += 10; dirReasons.push('费率健康'); }
  if (sentiment > 50) { longPoints += 15; dirReasons.push('情绪正面'); }
  if ((tokenData.socialScore || 0) > 40) { longPoints += 15; dirReasons.push('社交关注'); }

  // --- 做空信号 ---
  let shortPoints = 0;
  const shortReasons = [];
  // 场景1: 暴涨后过热 (高费率 + 价格已大涨 = 多头拥挤)
  if (rawChange > 30 && rawFundingRate > 0.03) { shortPoints += 35; shortReasons.push('多头过热'); }
  if (rawFundingRate > 0.05) { shortPoints += 20; shortReasons.push('费率极高'); }
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
 * 批量分析 — 汇聚 OKX + Surf 数据，生成候选代币列表
 */
function analyze(okxData, surfData) {
  console.log('[Analyzer] 开始分析...');
  const tokenMap = new Map();

  // Step 1: 从 OKX 涨幅榜提取候选
  if (okxData.topGainers) {
    for (const t of okxData.topGainers) {
      const sym = t.symbol;
      if (!tokenMap.has(sym)) tokenMap.set(sym, { symbol: sym, instId: t.instId });
      const data = tokenMap.get(sym);
      data.last = t.last;
      data.change24hPct = t.change24hPct;
      data.vol24h = t.vol24h;
      data.open24h = t.open24h;
    }
  }

  // Step 2: 从成交量榜合并
  if (okxData.topVolume) {
    for (const t of okxData.topVolume) {
      const sym = t.symbol;
      if (!tokenMap.has(sym)) tokenMap.set(sym, { symbol: sym, instId: t.instId });
      const data = tokenMap.get(sym);
      data.last = data.last || t.last;
      data.change24hPct = data.change24hPct || t.change24hPct;
      data.vol24h = t.vol24h; // 用成交量榜的数据覆盖
    }
  }

  // Step 3: 从 OI 变化数据中合并
  if (Array.isArray(okxData.oiChanges)) {
    for (const item of okxData.oiChanges) {
      const sym = (item.instId || '').replace('-USDT-SWAP', '').replace('-USDC-SWAP', '');
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

  // Step 5: 从 Surf 社交排名合并
  if (Array.isArray(surfData?.socialRanking)) {
    for (const item of surfData.socialRanking) {
      const sym = (item.token?.symbol || item.project?.name || '').toUpperCase();
      if (!sym) continue;
      if (!tokenMap.has(sym)) tokenMap.set(sym, { symbol: sym });
      const data = tokenMap.get(sym);
      // 排名越靠前分越高, sentiment_score > 0 表示正面
      const rank = item.rank || 50;
      data.socialScore = Math.max(data.socialScore || 0, Math.min(100, Math.max(0, 100 - (rank - 1) * 3)));
      // 情绪数据
      if (item.sentiment_score != null) {
        const sentVal = parseFloat(item.sentiment_score);
        // sentiment_score 范围约 -1~1，转化为 0~100
        data.sentimentScore = Math.max(data.sentimentScore || 0, Math.min(100, (sentVal + 1) * 50));
        if (item.sentiment === 'positive') data.sentimentScore = Math.max(data.sentimentScore, 60);
      }
    }
  }

  // Step 6: 情绪排名
  if (Array.isArray(okxData.sentimentRank)) {
    for (const item of okxData.sentimentRank) {
      const sym = (item.coin || item.symbol || '').toUpperCase();
      if (!sym) continue;
      if (tokenMap.has(sym)) {
        const data = tokenMap.get(sym);
        const rawSentiment = parseFloat(item.sentimentScore || item.hotness || 0);
        data.sentimentScore = Math.max(data.sentimentScore || 0, Math.min(100, rawSentiment));
      }
    }
  }

  // Step 7: Surf 新闻动态中的币种计数
  if (Array.isArray(surfData?.newsFeed)) {
    for (const article of surfData.newsFeed) {
      // 尝试从标题和内容中提取币种
      const title = (article.title || '') + ' ' + (article.summary || article.description || '');
      for (const [sym] of tokenMap) {
        if (sym.length >= 3 && title.toUpperCase().includes(sym)) {
          const data = tokenMap.get(sym);
          data.newsCount = (data.newsCount || 0) + 1;
        }
      }
    }
  }

  // Step 8: Surf 上所事件 (新币上所是强烈信号)
  if (Array.isArray(surfData?.listings)) {
    for (const listing of surfData.listings) {
      const sym = (listing.symbol || listing.token?.symbol || '').toUpperCase();
      if (!sym) continue;
      if (!tokenMap.has(sym)) tokenMap.set(sym, { symbol: sym });
      const data = tokenMap.get(sym);
      data.newsCount = (data.newsCount || 0) + 3; // 上所事件权重更高
      data.onchainScore = Math.max(data.onchainScore || 0, 50);
    }
  }

  // Step 9: 为每个候选代币评分
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

  return { alerts, watchlist, allScores: results.slice(0, 50) };
}

module.exports = {
  analyzeToken,
  analyze,
  WEIGHTS,
  THRESHOLDS,
};
