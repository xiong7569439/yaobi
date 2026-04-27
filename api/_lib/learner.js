/**
 * 回溯分析与参数学习模块 (Vercel Serverless 版)
 * 使用 /tmp 临时文件存储学习参数
 */
const fs = require('fs');
const path = require('path');

const TMP_DIR = '/tmp';
const PARAMS_FILE = path.join(TMP_DIR, 'yaobi-learned-params.json');

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

function readJSON(file) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {}
  return null;
}

function writeJSON(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data)); } catch {}
}

function createDefaultParams() {
  return {
    updatedAt: Date.now(),
    totalTracked: 0,
    totalCompleted: 0,
    decayFactors: {},
    weightAdjustments: {},
    overheatPatterns: { minChange24h: 60, minFundingRate: 0.0004, minSocialScore: 50, confidence: 0, sampleCount: 0 },
    stats: { avgReturn1h: null, avgReturn4h: null, avgReturn24h: null, hitRate: null, bestHours: [], hourlyStats: {} },
    lastLearnTime: null,
    learnCount: 0,
  };
}

function getParams() {
  return readJSON(PARAMS_FILE) || createDefaultParams();
}

function getDecayFactor(symbol, alertCount = 0) {
  if (alertCount === 0) return 1.1;
  const params = getParams();
  const decay = params.decayFactors[symbol];
  return decay ? decay.factor : 1.0;
}

function getAdjustedWeights() {
  const params = getParams();
  const adjustments = params.weightAdjustments || {};
  const adjusted = { ...BASE_WEIGHTS };
  for (const [dim, adj] of Object.entries(adjustments)) {
    if (adjusted[dim] !== undefined) {
      const delta = typeof adj === 'number' ? adj : (adj.delta || 0);
      adjusted[dim] = Math.max(-0.15, adjusted[dim] + delta);
    }
  }
  // 归一化: 正权重总和=1.0+|负权重总和|
  const posKeys = Object.keys(adjusted).filter(k => adjusted[k] > 0);
  const negKeys = Object.keys(adjusted).filter(k => adjusted[k] <= 0);
  const posSum = posKeys.reduce((s, k) => s + adjusted[k], 0);
  const negSum = negKeys.reduce((s, k) => s + Math.abs(adjusted[k]), 0);
  const target = 1.0 + negSum;
  if (posSum > 0 && Math.abs(posSum - target) > 0.001) {
    const scale = target / posSum;
    for (const k of posKeys) adjusted[k] *= scale;
  }
  return adjusted;
}

function getOverheatPatterns() {
  return getParams().overheatPatterns || {};
}

function pearsonCorrelation(x, y) {
  const n = x.length;
  if (n < 5) return 0;
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx, dy = y[i] - my;
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
  }
  const den = Math.sqrt(dx2 * dy2);
  return den === 0 ? 0 : num / den;
}

function analyze(completedRecords, alertCounts = {}) {
  const params = getParams();
  if (!completedRecords || completedRecords.length === 0) return params;

  console.log(`[Learner] 开始学习, ${completedRecords.length} 条记录`);

  // 1. 僵尸检测
  const bySymbol = {};
  for (const r of completedRecords) {
    if (!bySymbol[r.symbol]) bySymbol[r.symbol] = [];
    bySymbol[r.symbol].push(r);
  }
  for (const [symbol, recs] of Object.entries(bySymbol)) {
    const count = alertCounts[symbol]?.count || recs.length;
    const rets = recs.filter(r => r.return24h != null).map(r => r.return24h);
    if (rets.length === 0) continue;
    const avg = rets.reduce((s, v) => s + v, 0) / rets.length;
    const recentHigh = recs.some(r => r.return24h > 10 && (Date.now() - r.alertTime) < 48 * 3600000);
    if (recentHigh) { delete params.decayFactors[symbol]; continue; }
    let factor = 1.0, reason = '';
    if (count >= 30 && avg < 0) { factor = 0.1; reason = `${count}次, 平均${avg.toFixed(1)}%`; }
    else if (count >= 20 && avg < 1) { factor = 0.4; reason = `${count}次, 平均${avg.toFixed(1)}%`; }
    else if (count >= 10 && avg < 2) { factor = 0.7; reason = `${count}次, 平均${avg.toFixed(1)}%`; }
    if (factor < 1.0) {
      params.decayFactors[symbol] = { factor, reason, alertCount: count, avgReturn: Math.round(avg * 100) / 100, updatedAt: Date.now() };
    } else {
      delete params.decayFactors[symbol];
    }
  }

  // 2. 权重学习
  if (completedRecords.length >= 30) {
    const adj = {};
    for (const dim of DIMENSIONS) {
      const pairs = completedRecords.filter(r => r.scores?.[dim] != null && r.return24h != null);
      if (pairs.length < 20) continue;
      const corr = pearsonCorrelation(pairs.map(p => p.scores[dim]), pairs.map(p => p.return24h));
      const bw = BASE_WEIGHTS[dim];
      let delta = 0;
      if (corr > 0.3) delta = Math.min(bw * 0.5, (corr - 0.1) * bw * 0.8);
      else if (corr < -0.5) delta = corr * bw * 1.5; // 强负相关反转
      else if (corr < -0.1) delta = Math.max(-bw * 0.5, corr * bw * 0.8);
      if (Math.abs(delta) > 0.005) adj[dim] = { delta: Math.round(delta * 1000) / 1000, correlation: Math.round(corr * 1000) / 1000 };
    }
    params.weightAdjustments = adj;
  }

  // 3. 过热模式
  const oh = completedRecords.filter(r => r.direction === 'long' && r.return24h < -10);
  if (oh.length >= 3) {
    const sc = [...oh.map(r => Math.abs(r.change24hPct || 0))].sort((a, b) => a - b);
    const sr = [...oh.map(r => Math.abs(r.fundingRate || 0))].sort((a, b) => a - b);
    const ss = [...oh.map(r => r.scores?.socialHeat || 0)].sort((a, b) => a - b);
    params.overheatPatterns = {
      minChange24h: Math.round(sc[Math.floor(sc.length / 2)] * 10) / 10,
      minFundingRate: sr[Math.floor(sr.length / 2)],
      minSocialScore: Math.round(ss[Math.floor(ss.length / 2)]),
      confidence: Math.min(1, oh.length / 10),
      sampleCount: oh.length,
      avgDrop: Math.round(oh.reduce((s, r) => s + r.return24h, 0) / oh.length * 100) / 100,
    };
  }

  // 4. 时段优化
  const hb = {};
  for (const r of completedRecords) {
    if (r.return24h == null) continue;
    const h = new Date(r.alertTime).getHours();
    if (!hb[h]) hb[h] = [];
    hb[h].push(r.return24h);
  }
  const hs = {};
  const hp = [];
  for (const [h, rets] of Object.entries(hb)) {
    const avg = rets.reduce((s, v) => s + v, 0) / rets.length;
    const hr = rets.filter(r => r > 0).length / rets.length;
    hs[h] = { count: rets.length, avgReturn: Math.round(avg * 100) / 100, hitRate: Math.round(hr * 100) / 100 };
    hp.push({ hour: parseInt(h), score: avg * hr });
  }
  hp.sort((a, b) => b.score - a.score);
  params.stats.hourlyStats = hs;
  params.stats.bestHours = hp.slice(0, 3).map(h => h.hour);

  // 5. 统计
  const w1 = completedRecords.filter(r => r.return1h != null);
  const w4 = completedRecords.filter(r => r.return4h != null);
  const w24 = completedRecords.filter(r => r.return24h != null);
  params.stats.avgReturn1h = w1.length ? Math.round(w1.reduce((s, r) => s + r.return1h, 0) / w1.length * 100) / 100 : null;
  params.stats.avgReturn4h = w4.length ? Math.round(w4.reduce((s, r) => s + r.return4h, 0) / w4.length * 100) / 100 : null;
  params.stats.avgReturn24h = w24.length ? Math.round(w24.reduce((s, r) => s + r.return24h, 0) / w24.length * 100) / 100 : null;
  params.stats.hitRate = w24.length ? Math.round(w24.filter(r => r.return24h > 0).length / w24.length * 100) / 100 : null;
  params.stats.totalRecords = completedRecords.length;

  params.updatedAt = Date.now();
  params.totalCompleted = completedRecords.length;
  params.lastLearnTime = Date.now();
  params.learnCount = (params.learnCount || 0) + 1;

  writeJSON(PARAMS_FILE, params);
  console.log('[Learner] 学习完成');
  return params;
}

module.exports = { analyze, getParams, getDecayFactor, getAdjustedWeights, getOverheatPatterns };
