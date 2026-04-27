/**
 * 回溯分析与参数学习模块 (本地版)
 * 
 * 功能:
 * 1. 僵尸代币检测 — 连续告警无回报的代币自动降权
 * 2. 维度权重学习 — 回归分析哪些维度预测价格
 * 3. 反向信号识别 — 检测过热崩盘模式
 * 4. 时段优化 — 识别告警质量最高的时段
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const PARAMS_FILE = path.join(DATA_DIR, 'learned-params.json');

// 默认权重 (与 analyzer.js 保持一致)
const BASE_WEIGHTS = {
  newsHeat:     0.15,
  socialHeat:   0.20,
  priceAction:  0.15,
  volumeSpike:  0.15,
  contractData: 0.15,
  onChain:      0.10,
  sentiment:    0.10,
};

const DIMENSIONS = Object.keys(BASE_WEIGHTS);

// 内存缓存
let learnedParams = null;

/**
 * 加载学习参数
 */
function loadParams() {
  try {
    if (fs.existsSync(PARAMS_FILE)) {
      learnedParams = JSON.parse(fs.readFileSync(PARAMS_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('[Learner] 加载参数失败:', e.message);
  }
  if (!learnedParams) {
    learnedParams = createDefaultParams();
  }
  return learnedParams;
}

/**
 * 保存学习参数
 */
function saveParams() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(PARAMS_FILE, JSON.stringify(learnedParams, null, 2));
  } catch (e) {
    console.error('[Learner] 保存参数失败:', e.message);
  }
}

/**
 * 创建默认参数结构
 */
function createDefaultParams() {
  return {
    updatedAt: Date.now(),
    totalTracked: 0,
    totalCompleted: 0,
    decayFactors: {},
    weightAdjustments: {},
    overheatPatterns: {
      minChange24h: 60,
      minFundingRate: 0.0004,
      minSocialScore: 50,
      confidence: 0,
      sampleCount: 0,
    },
    stats: {
      avgReturn1h: null,
      avgReturn4h: null,
      avgReturn24h: null,
      hitRate: null,
      bestHours: [],
      hourlyStats: {},
    },
    lastLearnTime: null,
    learnCount: 0,
  };
}

/**
 * 获取当前学习参数
 */
function getParams() {
  if (!learnedParams) loadParams();
  return learnedParams;
}

/**
 * 获取代币的衰减因子
 * @param {string} symbol
 * @param {number} alertCount - 当前告警累计次数
 * @returns {number} 衰减因子 0.1 ~ 1.1
 */
function getDecayFactor(symbol, alertCount = 0) {
  if (!learnedParams) loadParams();

  // 首次告警加成
  if (alertCount === 0) return 1.1;

  const decay = learnedParams.decayFactors[symbol];
  if (decay) return decay.factor;

  return 1.0; // 默认无衰减
}

/**
 * 获取调整后的权重
 * @returns {Object} 调整后的维度权重
 */
function getAdjustedWeights() {
  if (!learnedParams) loadParams();

  const adjustments = learnedParams.weightAdjustments || {};
  const adjusted = { ...BASE_WEIGHTS };

  // 应用调整 (支持新格式 {delta, correlation} 和旧格式 number)
  for (const [dim, adj] of Object.entries(adjustments)) {
    if (adjusted[dim] !== undefined) {
      const delta = typeof adj === 'number' ? adj : (adj.delta || 0);
      adjusted[dim] = adjusted[dim] + delta;
      // 允许负权重 (减分项), 但不能低于 -0.15
      adjusted[dim] = Math.max(-0.15, adjusted[dim]);
    }
  }

  // 归一化: 确保正权重总和 = 1.0, 负权重保留原值
  const positiveKeys = Object.keys(adjusted).filter(k => adjusted[k] > 0);
  const negativeKeys = Object.keys(adjusted).filter(k => adjusted[k] <= 0);
  const positiveSum = positiveKeys.reduce((s, k) => s + adjusted[k], 0);
  const negativeSum = negativeKeys.reduce((s, k) => s + Math.abs(adjusted[k]), 0);
  const targetPositiveSum = 1.0 + negativeSum; // 补偿负权重
  if (positiveSum > 0 && Math.abs(positiveSum - targetPositiveSum) > 0.001) {
    const scale = targetPositiveSum / positiveSum;
    for (const key of positiveKeys) {
      adjusted[key] = adjusted[key] * scale;
    }
  }

  return adjusted;
}

/**
 * 获取过热模式参数
 */
function getOverheatPatterns() {
  if (!learnedParams) loadParams();
  return learnedParams.overheatPatterns || {};
}

// ===== 核心学习算法 =====

/**
 * 执行完整的学习分析
 * @param {Array} completedRecords - 已完成追踪的记录
 * @param {Object} alertCounts - 各代币的告警计数 { symbol: { count, firstSeen, lastSeen } }
 */
function analyze(completedRecords, alertCounts = {}) {
  if (!learnedParams) loadParams();
  if (!completedRecords || completedRecords.length === 0) {
    console.log('[Learner] 无已完成追踪记录，跳过学习');
    return learnedParams;
  }

  console.log(`[Learner] 开始学习分析, ${completedRecords.length} 条已完成记录`);

  // 1. 僵尸检测
  analyzeZombies(completedRecords, alertCounts);

  // 2. 维度权重学习 (至少30条记录)
  if (completedRecords.length >= 30) {
    analyzeWeights(completedRecords);
  }

  // 3. 反向信号 / 过热模式
  analyzeOverheat(completedRecords);

  // 4. 时段优化
  analyzeTimeSlots(completedRecords);

  // 5. 整体统计
  updateStats(completedRecords);

  // 更新元数据
  learnedParams.updatedAt = Date.now();
  learnedParams.totalCompleted = completedRecords.length;
  learnedParams.lastLearnTime = Date.now();
  learnedParams.learnCount = (learnedParams.learnCount || 0) + 1;

  saveParams();
  console.log('[Learner] 学习分析完成');
  return learnedParams;
}

/**
 * 僵尸代币检测与衰减因子计算
 */
function analyzeZombies(records, alertCounts) {
  // 按代币分组
  const bySymbol = {};
  for (const r of records) {
    if (!bySymbol[r.symbol]) bySymbol[r.symbol] = [];
    bySymbol[r.symbol].push(r);
  }

  for (const [symbol, symbolRecords] of Object.entries(bySymbol)) {
    const count = alertCounts[symbol]?.count || symbolRecords.length;
    const returns24h = symbolRecords
      .filter(r => r.return24h != null)
      .map(r => r.return24h);

    if (returns24h.length === 0) continue;

    const avgReturn = returns24h.reduce((s, v) => s + v, 0) / returns24h.length;
    const maxReturn = Math.max(...returns24h);

    // 如果最近有高回报，重置衰减
    const recentHigh = symbolRecords.some(
      r => r.return24h != null && r.return24h > 10 &&
           (Date.now() - r.alertTime) < 48 * 60 * 60 * 1000
    );

    if (recentHigh) {
      delete learnedParams.decayFactors[symbol];
      continue;
    }

    // 僵尸判定
    let factor = 1.0;
    let reason = '';

    if (count >= 30 && avgReturn < 0) {
      factor = 0.1;
      reason = `${count}次告警, 平均回报${avgReturn.toFixed(1)}% (几乎屏蔽)`;
    } else if (count >= 20 && avgReturn < 1) {
      factor = 0.4;
      reason = `${count}次告警, 平均回报${avgReturn.toFixed(1)}%`;
    } else if (count >= 10 && avgReturn < 2) {
      factor = 0.7;
      reason = `${count}次告警, 平均回报${avgReturn.toFixed(1)}%`;
    }

    if (factor < 1.0) {
      learnedParams.decayFactors[symbol] = {
        factor,
        reason,
        alertCount: count,
        avgReturn: Math.round(avgReturn * 100) / 100,
        maxReturn: Math.round(maxReturn * 100) / 100,
        updatedAt: Date.now(),
      };
    } else {
      // 不再是僵尸，移除
      delete learnedParams.decayFactors[symbol];
    }
  }
}

/**
 * 维度权重学习 — 简单相关性分析
 */
function analyzeWeights(records) {
  const adjustments = {};

  for (const dim of DIMENSIONS) {
    const pairs = records
      .filter(r => r.scores && r.scores[dim] != null && r.return24h != null)
      .map(r => ({ score: r.scores[dim], ret: r.return24h }));

    if (pairs.length < 20) continue;

    // 皮尔逊相关系数
    const correlation = pearsonCorrelation(
      pairs.map(p => p.score),
      pairs.map(p => p.ret)
    );

    // 根据相关性调整权重
    // correlation > 0.3 → 增加权重 (最多 +50%)
    // correlation < -0.1 → 减少权重 (correlation < -0.5 可反转为负权重)
    const baseWeight = BASE_WEIGHTS[dim];
    let delta = 0;

    if (correlation > 0.3) {
      delta = Math.min(baseWeight * 0.5, (correlation - 0.1) * baseWeight * 0.8);
    } else if (correlation < -0.5) {
      // 强负相关: 允许反转为减分项 (权重变负)
      delta = correlation * baseWeight * 1.5; // e.g. r=-0.86 → delta = -0.86 * 0.15 * 1.5 = -0.194
    } else if (correlation < -0.1) {
      delta = Math.max(-baseWeight * 0.5, correlation * baseWeight * 0.8);
    }

    if (Math.abs(delta) > 0.005) {
      adjustments[dim] = {
        delta: Math.round(delta * 1000) / 1000,
        correlation: Math.round(correlation * 1000) / 1000,
      };
    }
  }

  learnedParams.weightAdjustments = adjustments;
}

/**
 * 过热模式检测 — 告警 long 后暴跌的模式
 */
function analyzeOverheat(records) {
  // 找出 direction=long 但 24h 后跌幅 > 10% 的记录
  const overheatCases = records.filter(
    r => r.direction === 'long' && r.return24h != null && r.return24h < -10
  );

  if (overheatCases.length < 3) {
    learnedParams.overheatPatterns.confidence = 0;
    learnedParams.overheatPatterns.sampleCount = overheatCases.length;
    return;
  }

  // 分析共同特征
  const changes = overheatCases.map(r => Math.abs(r.change24hPct || 0));
  const rates = overheatCases.map(r => Math.abs(r.fundingRate || 0));
  const socials = overheatCases.map(r => r.scores?.socialHeat || 0);

  // 取中位数作为阈值
  const sortedChanges = [...changes].sort((a, b) => a - b);
  const sortedRates = [...rates].sort((a, b) => a - b);
  const sortedSocials = [...socials].sort((a, b) => a - b);

  learnedParams.overheatPatterns = {
    minChange24h: Math.round(sortedChanges[Math.floor(sortedChanges.length / 2)] * 10) / 10,
    minFundingRate: sortedRates[Math.floor(sortedRates.length / 2)],
    minSocialScore: Math.round(sortedSocials[Math.floor(sortedSocials.length / 2)]),
    confidence: Math.min(1, overheatCases.length / 10),
    sampleCount: overheatCases.length,
    avgDrop: Math.round(
      overheatCases.reduce((s, r) => s + r.return24h, 0) / overheatCases.length * 100
    ) / 100,
  };
}

/**
 * 时段优化分析
 */
function analyzeTimeSlots(records) {
  const hourlyBuckets = {};

  for (const r of records) {
    if (r.return24h == null) continue;
    const hour = new Date(r.alertTime).getHours();
    if (!hourlyBuckets[hour]) hourlyBuckets[hour] = [];
    hourlyBuckets[hour].push(r.return24h);
  }

  const hourlyStats = {};
  const hourPerformance = [];

  for (const [hour, returns] of Object.entries(hourlyBuckets)) {
    const avg = returns.reduce((s, v) => s + v, 0) / returns.length;
    const hits = returns.filter(r => r > 0).length;
    const hitRate = hits / returns.length;

    hourlyStats[hour] = {
      count: returns.length,
      avgReturn: Math.round(avg * 100) / 100,
      hitRate: Math.round(hitRate * 100) / 100,
    };

    hourPerformance.push({ hour: parseInt(hour), score: avg * hitRate, avgReturn: avg });
  }

  // 找出最佳时段 (按 avgReturn * hitRate 排序)
  hourPerformance.sort((a, b) => b.score - a.score);
  const bestHours = hourPerformance.slice(0, 3).map(h => h.hour);

  learnedParams.stats.hourlyStats = hourlyStats;
  learnedParams.stats.bestHours = bestHours;
}

/**
 * 更新整体统计
 */
function updateStats(records) {
  const with1h = records.filter(r => r.return1h != null);
  const with4h = records.filter(r => r.return4h != null);
  const with24h = records.filter(r => r.return24h != null);

  learnedParams.stats.avgReturn1h = with1h.length > 0
    ? Math.round(with1h.reduce((s, r) => s + r.return1h, 0) / with1h.length * 100) / 100
    : null;

  learnedParams.stats.avgReturn4h = with4h.length > 0
    ? Math.round(with4h.reduce((s, r) => s + r.return4h, 0) / with4h.length * 100) / 100
    : null;

  learnedParams.stats.avgReturn24h = with24h.length > 0
    ? Math.round(with24h.reduce((s, r) => s + r.return24h, 0) / with24h.length * 100) / 100
    : null;

  // 命中率: 24h回报 > 0 的比例
  learnedParams.stats.hitRate = with24h.length > 0
    ? Math.round(with24h.filter(r => r.return24h > 0).length / with24h.length * 100) / 100
    : null;

  learnedParams.stats.totalRecords = records.length;
}

// ===== 工具函数 =====

/**
 * 皮尔逊相关系数
 */
function pearsonCorrelation(x, y) {
  const n = x.length;
  if (n < 5) return 0;

  const meanX = x.reduce((s, v) => s + v, 0) / n;
  const meanY = y.reduce((s, v) => s + v, 0) / n;

  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }

  const den = Math.sqrt(denX * denY);
  return den === 0 ? 0 : num / den;
}

// 初始化
loadParams();

module.exports = {
  analyze,
  getParams,
  getDecayFactor,
  getAdjustedWeights,
  getOverheatPatterns,
  loadParams,
};
