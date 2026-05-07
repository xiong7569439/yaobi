/**
 * 回测统计模块 - 从 tracking.json 生成分层胜率报表
 *
 * 可被 CLI (node scripts/backtest-stats.js) 和 HTTP (/api/backtest) 共用
 */

const fs = require('fs');
const path = require('path');

const TRACKING_FILE = path.join(__dirname, '..', 'data', 'tracking.json');
const EXPERIENCE_FILE = path.join(__dirname, '..', 'data', 'experience.json');

function loadTracking() {
  if (!fs.existsSync(TRACKING_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(TRACKING_FILE, 'utf-8')); }
  catch { return []; }
}

function statPack(rets) {
  if (!rets || rets.length === 0) return null;
  const wins = rets.filter(r => r > 0).length;
  const avg = rets.reduce((s, v) => s + v, 0) / rets.length;
  return {
    n: rets.length,
    winRate: Math.round(wins / rets.length * 1000) / 10, // %
    avg: Math.round(avg * 100) / 100,
    max: Math.round(Math.max(...rets) * 100) / 100,
    min: Math.round(Math.min(...rets) * 100) / 100,
  };
}

/**
 * 生成完整回测报表 (JSON)
 */
function generateBacktest() {
  const t = loadTracking();
  const total = t.length;
  const has24h = t.filter(r => r.return24h != null).length;

  // --- 按方向 × 时间窗 ---
  const byDirection = {};
  for (const d of ['long', 'short', 'neutral']) {
    byDirection[d] = {};
    for (const w of ['return1h', 'return4h', 'return24h']) {
      const rets = t.filter(r => r.direction === d && r[w] != null).map(r => r[w]);
      byDirection[d][w] = statPack(rets);
    }
  }

  // --- 按告警等级 (24h 口径) ---
  const byLevel = {};
  const levels = [...new Set(t.map(r => r.level).filter(Boolean))];
  for (const lv of levels) {
    const rets = t.filter(r => r.level === lv && r.return24h != null).map(r => r.return24h);
    byLevel[lv] = statPack(rets);
  }

  // --- 按 priceStage × direction (24h 口径) ---
  const stages = ['ambush', 'pullback', 'ignition', 'rally', 'tail', 'blowoff', 'crash'];
  const byStage = {};
  for (const st of stages) {
    byStage[st] = {};
    for (const d of ['long', 'short', 'neutral']) {
      const rets = t.filter(r => r.scene?.priceStage === st && r.direction === d && r.return24h != null).map(r => r.return24h);
      const s = statPack(rets);
      if (s) byStage[st][d] = s;
    }
  }

  // --- 聪明钱先动专项统计 (核心: 验证新 P0 规则的假设) ---
  const smartMoney = {
    withSignal: statPack(
      t.filter(r => r.scene?.smartMoneyEarly === true && r.direction === 'long' && r.return24h != null)
        .map(r => r.return24h)
    ),
    withoutSignal: statPack(
      t.filter(r => r.scene?.priceStage === 'ambush' && r.scene?.smartMoneyEarly === false && r.direction === 'long' && r.return24h != null)
        .map(r => r.return24h)
    ),
  };

  // --- 经验库摘要 ---
  let experienceSummary = null;
  if (fs.existsSync(EXPERIENCE_FILE)) {
    try {
      const exp = JSON.parse(fs.readFileSync(EXPERIENCE_FILE, 'utf-8'));
      const wins = exp.filter(e => e.outcome === 'win').length;
      const losses = exp.filter(e => e.outcome === 'loss').length;
      const byTag = {};
      for (const e of exp) for (const tag of (e.tags || [])) byTag[tag] = (byTag[tag] || 0) + 1;
      experienceSummary = {
        total: exp.length,
        wins, losses,
        winRate: exp.length > 0 ? Math.round(wins / exp.length * 1000) / 10 : null,
        topTags: Object.entries(byTag).sort((a, b) => b[1] - a[1]).slice(0, 10),
      };
    } catch {}
  }

  return {
    generatedAt: Date.now(),
    summary: {
      total,
      with24hComplete: has24h,
      pending: t.filter(r => r.status === 'pending').length,
    },
    byDirection,
    byLevel,
    byStage,
    smartMoney,
    experienceSummary,
  };
}

/**
 * CLI 输出为可读表格
 */
function printConsole() {
  const r = generateBacktest();
  console.log('\n========== 系统历史告警回测 ==========\n');
  console.log(`样本总量: ${r.summary.total} 条, 其中带 24h 完整回报: ${r.summary.with24hComplete} 条\n`);

  const pad = (s, n) => String(s || '-').padEnd(n);
  console.log('--- 按方向 × 时间窗 ---');
  console.log('方向   | 窗口      | 样本 | 胜率   | 均值   | 最大赢 | 最大亏');
  for (const [d, windows] of Object.entries(r.byDirection)) {
    for (const [w, s] of Object.entries(windows)) {
      if (s) console.log(`${pad(d, 6)} | ${pad(w, 9)} | ${pad(s.n, 5)}| ${pad(s.winRate + '%', 6)} | ${pad(s.avg + '%', 6)} | ${pad(s.max + '%', 6)} | ${s.min}%`);
    }
  }

  console.log('\n--- 按场景(priceStage) × 方向 (24h) ---');
  console.log('阶段       | 方向    | 样本 | 胜率   | 均值');
  for (const [st, dirs] of Object.entries(r.byStage)) {
    for (const [d, s] of Object.entries(dirs)) {
      if (s && s.n >= 2) console.log(`${pad(st, 10)} | ${pad(d, 8)}| ${pad(s.n, 5)}| ${pad(s.winRate + '%', 6)} | ${s.avg}%`);
    }
  }

  console.log('\n--- 聪明钱先动专项 (long 方向, 24h) ---');
  if (r.smartMoney.withSignal) {
    const s = r.smartMoney.withSignal;
    console.log(`  有聪明钱信号:  样本${s.n}  胜率${s.winRate}%  均值${s.avg}%`);
  } else {
    console.log('  有聪明钱信号:  样本不足');
  }
  if (r.smartMoney.withoutSignal) {
    const s = r.smartMoney.withoutSignal;
    console.log(`  无聪明钱信号(埋伏期):  样本${s.n}  胜率${s.winRate}%  均值${s.avg}%`);
  }

  if (r.experienceSummary) {
    console.log(`\n--- 经验库: ${r.experienceSummary.total} 条, 胜率 ${r.experienceSummary.winRate}% ---`);
    console.log('高频归因:', r.experienceSummary.topTags.map(([k, v]) => `${k}:${v}`).join(' / '));
  }
}

module.exports = { generateBacktest, loadTracking, statPack };

// CLI 入口
if (require.main === module) {
  printConsole();
}
