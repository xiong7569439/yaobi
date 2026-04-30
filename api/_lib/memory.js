/**
 * 经验库 - 场景相似度检索与胜率查询
 *
 * 核心能力 (对标博文中 Hermes/MAKIMA 的经验调取):
 *   1. loadExperiences()  - 从 tracking.json 加载历史已完成案例
 *   2. findSimilar(scene, k) - 返回 TopK 场景最相似的历史案例
 *   3. sceneWinRate(scene, direction) - 当前场景+方向, 历史胜率是多少
 *   4. sceneAdvice(scene, direction) - 给出建议 (加仓/减仓/禁手)
 *
 * 依赖:
 *   - data/tracking.json: 原始案例(含 scene 标签)
 *   - data/experience.json: 精炼经验(可选, 带 lessonText)
 */

const fs = require('fs');
const path = require('path');
const scene = require('./scene');

const DATA_DIR = path.join(__dirname, '..', 'data');
const TRACKING_FILE = path.join(DATA_DIR, 'tracking.json');
const EXPERIENCE_FILE = path.join(DATA_DIR, 'experience.json');

// 内存缓存 + 惰性加载
let cachedExperiences = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5min

function loadExperiences() {
  const now = Date.now();
  if (cachedExperiences && (now - cacheTime) < CACHE_TTL) return cachedExperiences;

  const list = [];
  try {
    if (fs.existsSync(TRACKING_FILE)) {
      const raw = JSON.parse(fs.readFileSync(TRACKING_FILE, 'utf-8'));
      // 只要有 scene 标签 + 至少 4h 结果 的记录都当作经验
      for (const r of raw) {
        if (!r.scene || !r.scene.priceStage) continue;
        if (r.return4h == null && r.return24h == null) continue;
        list.push(r);
      }
    }
  } catch (e) {
    console.error('[Memory] 加载 tracking 失败:', e.message);
  }

  cachedExperiences = list;
  cacheTime = now;
  return list;
}

/**
 * 强制刷新缓存 (tracker 写入新数据后可调用)
 */
function invalidateCache() {
  cachedExperiences = null;
  cacheTime = 0;
}

/**
 * 找到与目标场景最相似的 TopK 条历史经验
 * @param {Object} targetScene - {priceStage, marketScene, fundingRegime, volumeRegime, oiRegime}
 * @param {number} k
 * @returns {Array<{record, similarity}>}
 */
function findSimilar(targetScene, k = 5) {
  if (!targetScene) return [];
  const experiences = loadExperiences();
  const scored = [];
  for (const r of experiences) {
    const sim = scene.sceneSimilarity(targetScene, r.scene);
    if (sim > 0.2) { // 至少匹配1/5
      scored.push({ record: r, similarity: sim });
    }
  }
  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, k);
}

/**
 * 查询: 当前场景 + 某方向下, 历史胜率如何?
 * 返回 null 表示样本不足 (< 3)
 */
function sceneWinRate(targetScene, direction, minSample = 3) {
  if (!targetScene) return null;
  const experiences = loadExperiences();
  // 粗匹配: 至少 priceStage 一致, 且 (fundingRegime 或 oiRegime 一致)
  const matched = experiences.filter(r => {
    if (!r.scene) return false;
    if (r.scene.priceStage !== targetScene.priceStage) return false;
    const frMatch = r.scene.fundingRegime === targetScene.fundingRegime;
    const oiMatch = r.scene.oiRegime === targetScene.oiRegime;
    return frMatch || oiMatch;
  });

  const withDir = direction ? matched.filter(r => r.direction === direction) : matched;
  const rets = withDir.map(r => r.return24h ?? r.return4h).filter(v => v != null);
  if (rets.length < minSample) return null;

  const wins = rets.filter(r => r > 0).length;
  return {
    sample: rets.length,
    winRate: wins / rets.length,
    avgReturn: rets.reduce((s, v) => s + v, 0) / rets.length,
    maxWin: Math.max(...rets),
    maxLoss: Math.min(...rets),
  };
}

/**
 * 综合建议: 给出基于历史的置信度乘数
 * 返回 {multiplier, note}:
 *   multiplier: 0.3 ~ 1.5, 用于调整 directionScore
 *   note: 中文说明, 可写入 reasons
 */
function sceneAdvice(targetScene, direction) {
  const stat = sceneWinRate(targetScene, direction, 3);
  if (!stat) {
    return { multiplier: 1.0, note: null, sample: 0 };
  }

  let multiplier = 1.0;
  let note = '';

  if (stat.winRate >= 0.7 && stat.avgReturn > 5) {
    multiplier = 1.3;
    note = `历史同场景${stat.sample}次, 胜率${(stat.winRate * 100).toFixed(0)}% 均值+${stat.avgReturn.toFixed(1)}%, 信心加强`;
  } else if (stat.winRate >= 0.55) {
    multiplier = 1.1;
    note = `历史同场景${stat.sample}次, 胜率${(stat.winRate * 100).toFixed(0)}%, 偏正面`;
  } else if (stat.winRate <= 0.3 && stat.avgReturn < -3) {
    multiplier = 0.5;
    note = `历史同场景${stat.sample}次, 胜率${(stat.winRate * 100).toFixed(0)}% 均值${stat.avgReturn.toFixed(1)}%, 严重不利`;
  } else if (stat.winRate <= 0.45) {
    multiplier = 0.75;
    note = `历史同场景${stat.sample}次, 胜率${(stat.winRate * 100).toFixed(0)}%, 偏负面`;
  }

  return { multiplier, note, sample: stat.sample, stat };
}

/**
 * 统计: 每个 priceStage 下各方向的历史表现摘要 (供调试和面板展示)
 */
function summaryByStage() {
  const experiences = loadExperiences();
  const summary = {};
  for (const r of experiences) {
    const stage = r.scene?.priceStage || 'unknown';
    if (!summary[stage]) summary[stage] = { long: [], short: [], neutral: [] };
    const ret = r.return24h ?? r.return4h;
    if (ret == null) continue;
    const dir = r.direction || 'neutral';
    if (summary[stage][dir]) summary[stage][dir].push(ret);
  }
  const report = {};
  for (const [stage, dirs] of Object.entries(summary)) {
    report[stage] = {};
    for (const [dir, rets] of Object.entries(dirs)) {
      if (rets.length === 0) continue;
      const wins = rets.filter(r => r > 0).length;
      report[stage][dir] = {
        n: rets.length,
        winRate: Math.round(wins / rets.length * 100) / 100,
        avg: Math.round(rets.reduce((s, v) => s + v, 0) / rets.length * 100) / 100,
      };
    }
  }
  return report;
}

/**
 * 读取精炼经验库 (experience.json, 由 review.js 生成)
 */
function loadLessons() {
  try {
    if (fs.existsSync(EXPERIENCE_FILE)) {
      return JSON.parse(fs.readFileSync(EXPERIENCE_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('[Memory] 加载 experience.json 失败:', e.message);
  }
  return [];
}

module.exports = {
  loadExperiences,
  invalidateCache,
  findSimilar,
  sceneWinRate,
  sceneAdvice,
  summaryByStage,
  loadLessons,
};
