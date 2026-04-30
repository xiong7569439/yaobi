/**
 * 妖币告警系统回测脚本
 * 输入: data/tracking.json 历史告警追踪记录
 * 输出: 胜率 / 盈亏比 / 平均回报 / 按维度归因 / "起飞已过 vs 还在埋伏" 判别
 *
 * 交易假设:
 *  - long 方向: alertTime 以 p0 入场, 1h/4h/24h 任意检查点价格为平仓
 *  - short 方向: 同上, 收益 = -(pN - p0)/p0
 *  - neutral 方向: 不交易 (仅统计)
 *  - 手续费 0.05% 单边, 共 0.1% 双边
 *  - 单笔名义仓位 1.0 (等权), 不考虑杠杆/滑点
 */

const fs = require('fs');
const path = require('path');
const scene = require('../lib/scene');

const FEE = 0.001; // 0.1% 双边

const tracking = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'tracking.json'), 'utf-8'));

function sum(arr) { return arr.reduce((s, v) => s + v, 0); }
function avg(arr) { return arr.length === 0 ? 0 : sum(arr) / arr.length; }
function median(arr) { if (arr.length === 0) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; }
function fmt(n, d = 2) { return n == null ? 'N/A' : (Math.round(n * Math.pow(10, d)) / Math.pow(10, d)).toFixed(d); }

// 把 return 换算成「按方向的策略净收益」
function strategyReturn(record, horizon) {
  const r = record[`return${horizon}`];
  if (r == null) return null;
  if (record.direction === 'long') return r - FEE * 100;
  if (record.direction === 'short') return -r - FEE * 100;
  return null; // neutral 不交易
}

function stats(rets) {
  if (rets.length === 0) return null;
  const wins = rets.filter(r => r > 0);
  const losses = rets.filter(r => r <= 0);
  const winRate = wins.length / rets.length;
  const avgWin = avg(wins);
  const avgLoss = avg(losses);
  const profitFactor = losses.length === 0 ? Infinity : Math.abs(sum(wins) / sum(losses));
  const expectancy = avg(rets);
  return {
    count: rets.length,
    winRate,
    avgReturn: expectancy,
    medianReturn: median(rets),
    avgWin,
    avgLoss,
    maxWin: Math.max(...rets),
    maxLoss: Math.min(...rets),
    profitFactor,
    totalPnL: sum(rets),
  };
}

function printStats(title, s) {
  if (!s) { console.log(`\n[${title}] 无有效样本`); return; }
  console.log(`\n[${title}]`);
  console.log(`  样本数        : ${s.count}`);
  console.log(`  胜率          : ${fmt(s.winRate * 100, 1)}%`);
  console.log(`  平均收益      : ${fmt(s.avgReturn, 2)}%`);
  console.log(`  收益中位数    : ${fmt(s.medianReturn, 2)}%`);
  console.log(`  平均盈利      : ${fmt(s.avgWin, 2)}%`);
  console.log(`  平均亏损      : ${fmt(s.avgLoss, 2)}%`);
  console.log(`  最大盈利      : ${fmt(s.maxWin, 2)}%`);
  console.log(`  最大亏损      : ${fmt(s.maxLoss, 2)}%`);
  console.log(`  盈亏比(PF)    : ${isFinite(s.profitFactor) ? fmt(s.profitFactor, 2) : '∞'}`);
  console.log(`  累计PnL(等权) : ${fmt(s.totalPnL, 2)}%`);
}

console.log('='.repeat(70));
console.log(' 妖币告警系统 — 历史追踪数据回测报告');
console.log('='.repeat(70));
console.log(`总告警记录     : ${tracking.length}`);
console.log(`已完成24h追踪  : ${tracking.filter(r => r.return24h != null).length}`);
console.log(`已完成4h追踪   : ${tracking.filter(r => r.return4h != null).length}`);
console.log(`已完成1h追踪   : ${tracking.filter(r => r.return1h != null).length}`);
console.log(`仍在追踪(pending): ${tracking.filter(r => r.status === 'pending').length}`);

// ---------- 1. 按持仓时长 ----------
for (const h of ['1h', '4h', '24h']) {
  const rets = tracking.map(r => strategyReturn(r, h)).filter(v => v != null);
  printStats(`全部告警 - 持仓${h}`, stats(rets));
}

// ---------- 2. 按方向 ----------
console.log('\n' + '-'.repeat(70));
console.log(' 按方向分组 (24h 持仓)');
console.log('-'.repeat(70));
for (const dir of ['long', 'short', 'neutral']) {
  const rets = tracking.filter(r => r.direction === dir).map(r => strategyReturn(r, '24h')).filter(v => v != null);
  // neutral 不交易, 但为了对比, 用原始收益(假设盲目做多)
  if (dir === 'neutral') {
    const raw = tracking.filter(r => r.direction === dir && r.return24h != null).map(r => r.return24h);
    printStats(`neutral(若盲多) - 24h`, stats(raw));
    continue;
  }
  printStats(`${dir} - 24h`, stats(rets));
}

// ---------- 3. 按等级 ----------
console.log('\n' + '-'.repeat(70));
console.log(' 按告警等级 (24h 持仓)');
console.log('-'.repeat(70));
for (const lvl of ['high', 'medium', 'low']) {
  const rets = tracking.filter(r => r.level === lvl).map(r => strategyReturn(r, '24h')).filter(v => v != null);
  printStats(`level=${lvl}`, stats(rets));
}

// ---------- 4. "已起飞" vs "还在埋伏" 判别 ----------
console.log('\n' + '-'.repeat(70));
console.log(' 核心问题: 告警触发时, 币价已经涨了多少? (埋伏度分析)');
console.log('-'.repeat(70));
// 以 change24hPct 作为触发时点的"已涨幅", 分桶统计 24h 后续收益
const bins = [
  { label: '已暴跌(<-20%)    ', test: r => r.change24hPct <= -20 },
  { label: '已下跌(-20%~-5%) ', test: r => r.change24hPct > -20 && r.change24hPct <= -5 },
  { label: '盘整(-5%~+5%)    ', test: r => r.change24hPct > -5 && r.change24hPct < 5 },
  { label: '温和上涨(+5%~+20%)', test: r => r.change24hPct >= 5 && r.change24hPct < 20 },
  { label: '中幅上涨(+20%~+50%)', test: r => r.change24hPct >= 20 && r.change24hPct < 50 },
  { label: '已起飞(+50%~+100%)', test: r => r.change24hPct >= 50 && r.change24hPct < 100 },
  { label: '已翻倍(>+100%)   ', test: r => r.change24hPct >= 100 },
];
for (const b of bins) {
  const subset = tracking.filter(b.test);
  const rawRets = subset.map(r => r.return24h).filter(v => v != null);
  const stratRets = subset.map(r => strategyReturn(r, '24h')).filter(v => v != null);
  if (subset.length === 0) continue;
  console.log(`\n  ${b.label} 告警数=${subset.length}`);
  console.log(`      后续24h原始均值: ${fmt(avg(rawRets), 2)}%  (样本 ${rawRets.length})`);
  if (stratRets.length > 0) {
    const s = stats(stratRets);
    console.log(`      策略24h收益均值: ${fmt(s.avgReturn, 2)}%  胜率 ${fmt(s.winRate * 100, 1)}%`);
  }
}

// ---------- 5. 按分数段 ----------
console.log('\n' + '-'.repeat(70));
console.log(' 按总分段 (24h 持仓)');
console.log('-'.repeat(70));
const scoreBins = [[40, 50], [50, 65], [65, 80], [80, 100]];
for (const [lo, hi] of scoreBins) {
  const subset = tracking.filter(r => r.totalScore >= lo && r.totalScore < hi);
  const rets = subset.map(r => strategyReturn(r, '24h')).filter(v => v != null);
  printStats(`${lo}-${hi}分`, stats(rets));
}

// ---------- 6. 反转策略模拟: 若所有方向反过来做 ----------
console.log('\n' + '-'.repeat(70));
console.log(' 反转实验: 如果全部反向操作 (long→short, short→long)');
console.log('-'.repeat(70));
const reverseRets = tracking.map(r => {
  if (r.return24h == null) return null;
  if (r.direction === 'long') return -r.return24h - FEE * 100;
  if (r.direction === 'short') return r.return24h - FEE * 100;
  return null;
}).filter(v => v != null);
printStats('反转操作 - 24h', stats(reverseRets));

// ---------- 7. 最佳/最差 Top 5 ----------
console.log('\n' + '-'.repeat(70));
console.log(' 回报 Top 5 (24h)');
console.log('-'.repeat(70));
const sorted = tracking
  .filter(r => r.return24h != null)
  .map(r => ({ ...r, strat: strategyReturn(r, '24h') }))
  .sort((a, b) => b.strat - a.strat);
for (const r of sorted.slice(0, 5)) {
  console.log(`  ${r.symbol.padEnd(10)} dir=${r.direction.padEnd(7)} score=${fmt(r.totalScore, 1).padStart(5)} change24h=${fmt(r.change24hPct, 1).padStart(7)}% => 策略24h=${fmt(r.strat, 2)}%`);
}
console.log('\n 最差 5:');
for (const r of sorted.slice(-5).reverse()) {
  console.log(`  ${r.symbol.padEnd(10)} dir=${r.direction.padEnd(7)} score=${fmt(r.totalScore, 1).padStart(5)} change24h=${fmt(r.change24hPct, 1).padStart(7)}% => 策略24h=${fmt(r.strat, 2)}%`);
}

console.log('\n' + '='.repeat(70));
console.log(' ▶ 场景化回测 - 按 priceStage 分组 (全部 197 条)');
console.log('='.repeat(70));
console.log(' 不仅看已完成追踪, 而是看整体分布——告警能在哪些阶段命中?');
console.log('='.repeat(70));
const stageOrder = ['crash', 'pullback', 'ambush', 'ignition', 'rally', 'tail', 'blowoff'];
for (const st of stageOrder) {
  const subset = tracking.filter(r => r.scene?.priceStage === st);
  if (subset.length === 0) continue;
  const raw24 = subset.map(r => r.return24h).filter(v => v != null);
  const strat24 = subset.map(r => strategyReturn(r, '24h')).filter(v => v != null);
  const dirCount = { long: 0, short: 0, neutral: 0 };
  subset.forEach(r => dirCount[r.direction] = (dirCount[r.direction] || 0) + 1);
  const nameCn = scene.labelCn(st);
  console.log(`\n[${nameCn} (${st})] 总样本 ${subset.length}  | 方向分布 long=${dirCount.long} short=${dirCount.short} neutral=${dirCount.neutral}`);
  console.log(`  已完成24h追踪: ${raw24.length} 条`);
  if (raw24.length > 0) {
    const raw = stats(raw24);
    console.log(`  原始24h收益: 均值=${fmt(raw.avgReturn, 2)}% 胜率=${fmt(raw.winRate * 100, 1)}% 中位=${fmt(raw.medianReturn, 2)}% 最高=${fmt(raw.maxWin, 1)}% 最低=${fmt(raw.maxLoss, 1)}%`);
  }
  if (strat24.length > 0) {
    const s = stats(strat24);
    console.log(`  按策略收益: 均值=${fmt(s.avgReturn, 2)}% 胜率=${fmt(s.winRate * 100, 1)}% (${s.count} 单)`);
  }
}

// 按费率状态
console.log('\n' + '-'.repeat(70));
console.log(' ▶ 按费率状态分组 (fundingRegime)');
console.log('-'.repeat(70));
const frOrder = ['fr_negative', 'fr_low', 'fr_healthy', 'fr_high', 'fr_extreme_high'];
for (const fr of frOrder) {
  const subset = tracking.filter(r => r.scene?.fundingRegime === fr);
  if (subset.length === 0) continue;
  const raw24 = subset.map(r => r.return24h).filter(v => v != null);
  console.log(`\n[${scene.labelCn(fr)} (${fr})] 样本 ${subset.length}, 已完成 ${raw24.length}`);
  if (raw24.length > 0) {
    const raw = stats(raw24);
    console.log(`  原始24h均值: ${fmt(raw.avgReturn, 2)}%  胜率: ${fmt(raw.winRate * 100, 1)}%`);
  }
}

// 按OI状态
console.log('\n' + '-'.repeat(70));
console.log(' ▶ 按OI状态分组 (oiRegime)');
console.log('-'.repeat(70));
const oiOrder = ['oi_flee', 'oi_fade', 'oi_stable', 'oi_build', 'oi_flood'];
for (const oi of oiOrder) {
  const subset = tracking.filter(r => r.scene?.oiRegime === oi);
  if (subset.length === 0) continue;
  const raw24 = subset.map(r => r.return24h).filter(v => v != null);
  console.log(`\n[${scene.labelCn(oi)} (${oi})] 样本 ${subset.length}, 已完成 ${raw24.length}`);
  if (raw24.length > 0) {
    const raw = stats(raw24);
    console.log(`  原始24h均值: ${fmt(raw.avgReturn, 2)}%  胜率: ${fmt(raw.winRate * 100, 1)}%`);
  }
}

// 正是未来经验库的核心 - 场景组合的财富码
console.log('\n' + '-'.repeat(70));
console.log(' ▶ 高价值场景组合 (sceneKey Top 10, 按样本数)');
console.log(' 子样本数够时, 这里就是未来经验检索的挖金钿');
console.log('-'.repeat(70));
const keyGroup = {};
for (const r of tracking) {
  const k = r.scene?.sceneKey;
  if (!k) continue;
  if (!keyGroup[k]) keyGroup[k] = [];
  keyGroup[k].push(r);
}
const topKeys = Object.entries(keyGroup).sort((a, b) => b[1].length - a[1].length).slice(0, 10);
for (const [k, subset] of topKeys) {
  const raw24 = subset.map(r => r.return24h).filter(v => v != null);
  const readable = k.split('|').map(p => scene.labelCn(p)).join(' · ');
  const line1 = `[${subset.length}条] ${readable}`;
  if (raw24.length >= 2) {
    const raw = stats(raw24);
    console.log(`  ${line1}`);
    console.log(`         → 已完成${raw24.length}条, 24h均值${fmt(raw.avgReturn, 2)}% 胜率${fmt(raw.winRate * 100, 1)}%`);
  } else {
    console.log(`  ${line1}  (待追踪成熟)`);
  }
}

console.log('\n' + '='.repeat(70));
console.log(' 报告生成完毕');
console.log('='.repeat(70));
