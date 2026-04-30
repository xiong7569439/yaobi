/**
 * 对已有 tracking.json 中的历史告警补打场景标签
 *
 * 原理:
 *  - 历史记录已有 change24hPct / fundingRate / oiChangePct 等特征
 *  - 没有的是 volumeMultiplier 和 marketContext (老记录不带)
 *  - 用当前逻辑给每条记录尽可能推导出场景标签, 方便后续场景化回测
 *
 * 使用: node scripts/backfill-scenes.js
 */

const fs = require('fs');
const path = require('path');
const scene = require('../lib/scene');

const TRACKING_FILE = path.join(__dirname, '..', 'data', 'tracking.json');

function run() {
  console.log('='.repeat(60));
  console.log(' 场景标签回灌 - backfill-scenes.js');
  console.log('='.repeat(60));

  const raw = fs.readFileSync(TRACKING_FILE, 'utf-8');
  const records = JSON.parse(raw);
  console.log(`加载 ${records.length} 条历史追踪记录`);

  let tagged = 0;
  let skipped = 0;
  const sceneDist = {}; // 场景分布统计

  for (const r of records) {
    // 如果已经打过标签且五个维度齐全, 跳过
    if (r.scene && r.scene.priceStage && r.scene.fundingRegime) {
      skipped++;
      // 依然统计分布
      const key = r.scene.priceStage;
      sceneDist[key] = (sceneDist[key] || 0) + 1;
      continue;
    }

    // 推导标签 - 没有 marketContext 时用 null (会标记为 unknown)
    const tags = scene.tagSnapshot({
      change24hPct: r.change24hPct,
      fundingRate: r.fundingRate,
      oiChangePct: r.oiChangePct,
      volumeMultiplier: r.volumeMultiplier || null,
      marketContext: r.marketSnapshot ? {
        btc: { change24hPct: r.marketSnapshot.btcChange },
        eth: { change24hPct: r.marketSnapshot.ethChange },
      } : null,
    });

    r.scene = tags;
    // 同步字段
    r.reasoning = r.reasoning || '';
    r.directionReasons = r.directionReasons || '';

    tagged++;
    sceneDist[tags.priceStage] = (sceneDist[tags.priceStage] || 0) + 1;
  }

  fs.writeFileSync(TRACKING_FILE, JSON.stringify(records, null, 2));
  console.log(`\n[OK] 新打标签 ${tagged} 条, 已有标签 ${skipped} 条`);

  // 分布报告
  console.log('\n=== 价格阶段分布 (priceStage) ===');
  const totals = records.length;
  const stages = ['crash', 'pullback', 'ambush', 'ignition', 'rally', 'tail', 'blowoff'];
  for (const s of stages) {
    const c = sceneDist[s] || 0;
    const pct = ((c / totals) * 100).toFixed(1);
    const bar = '█'.repeat(Math.round(c / totals * 50));
    console.log(`  ${scene.labelCn(s).padEnd(6)} (${s.padEnd(8)}) ${String(c).padStart(4)} (${pct}%) ${bar}`);
  }

  // 按费率/OI 分布
  console.log('\n=== 费率状态分布 (fundingRegime) ===');
  const frDist = {};
  for (const r of records) {
    const f = r.scene?.fundingRegime || 'unknown';
    frDist[f] = (frDist[f] || 0) + 1;
  }
  for (const [k, v] of Object.entries(frDist).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${scene.labelCn(k).padEnd(6)} (${k.padEnd(16)}) ${String(v).padStart(4)}`);
  }

  console.log('\n=== OI状态分布 (oiRegime) ===');
  const oiDist = {};
  for (const r of records) {
    const o = r.scene?.oiRegime || 'unknown';
    oiDist[o] = (oiDist[o] || 0) + 1;
  }
  for (const [k, v] of Object.entries(oiDist).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${scene.labelCn(k).padEnd(6)} (${k.padEnd(12)}) ${String(v).padStart(4)}`);
  }

  // 样本场景 Top-N - 用于查看经验库概貌
  console.log('\n=== 场景组合 Top 15 (sceneKey 分布) ===');
  const keyDist = {};
  for (const r of records) {
    const k = r.scene?.sceneKey || 'unknown';
    keyDist[k] = (keyDist[k] || 0) + 1;
  }
  const sorted = Object.entries(keyDist).sort((a, b) => b[1] - a[1]).slice(0, 15);
  for (const [k, v] of sorted) {
    const parts = k.split('|');
    const readable = parts.map(p => scene.labelCn(p)).join(' · ');
    console.log(`  ${String(v).padStart(4)} ${readable}`);
  }

  console.log('\n' + '='.repeat(60));
  console.log(` 完成! 写回 ${TRACKING_FILE}`);
  console.log('='.repeat(60));
}

run();
