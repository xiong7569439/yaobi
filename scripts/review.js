/**
 * 决策复盘脚本 (对标博文"AI自己复盘"步骤)
 *
 * 工作流程:
 *   1. 扫描 tracking.json, 找出所有 "已完成24h且未复盘" 的记录
 *   2. 规则式复盘 (默认): 根据方向+场景+收益自动打标签
 *      - rootCause:   失败/成功的主因 (chased_top/caught_bottom/funding_squeeze/...)
 *      - ignoredSignal: 被忽视的信号 (如 funding_extreme_high)
 *      - lesson:     中文经验总结
 *      - applicableScene: 该教训适用的场景
 *   3. LLM 复盘 (可选): 若配置了 ANTHROPIC_API_KEY, 调用 LLM 生成更有洞察的复盘
 *   4. 写入 data/experience.json 供 memory.js 调取
 *
 * 使用:
 *   node scripts/review.js                    # 规则式复盘
 *   node scripts/review.js --llm              # 启用 LLM (需环境变量)
 *   node scripts/review.js --force            # 重新复盘所有(覆盖已有)
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const TRACKING_FILE = path.join(DATA_DIR, 'tracking.json');
const EXPERIENCE_FILE = path.join(DATA_DIR, 'experience.json');

const ARGS = process.argv.slice(2);
const CLI_USE_LLM = ARGS.includes('--llm');
const CLI_FORCE = ARGS.includes('--force');

/* ------------------ 规则式复盘引擎 ------------------ */

function ruleBasedReview(record) {
  const { direction, scene, return24h, return4h } = record;
  const ret = return24h ?? return4h;
  if (ret == null || !scene) return null;

  const isWin = (direction === 'long' && ret > 0)
             || (direction === 'short' && ret < 0)
             || (direction === 'neutral' && Math.abs(ret) < 5);
  const magnitude = Math.abs(ret);

  const tags = [];
  let rootCause = '';
  const ignoredSignals = [];
  const lessonParts = [];

  // 场景特征总结
  const sc = scene;
  const stageLabel = ({
    crash: '暴跌', pullback: '回调', ambush: '埋伏',
    ignition: '启动', rally: '上涨', tail: '尾部', blowoff: '暴涨尾声'
  }[sc.priceStage] || sc.priceStage);
  const frLabel = ({
    fr_negative: '负费率', fr_low: '费率低位', fr_healthy: '费率健康',
    fr_high: '费率偏高', fr_extreme_high: '费率极高'
  }[sc.fundingRegime] || sc.fundingRegime);

  /* === 失败案例归因 === */
  if (!isWin) {
    if (direction === 'long' && (sc.priceStage === 'tail' || sc.priceStage === 'blowoff')) {
      tags.push('chased_top');
      rootCause = '在涨幅已过半的尾部/暴涨尾声阶段做多,成为接盘侠';
      ignoredSignals.push('priceStage已进入tail/blowoff');
      lessonParts.push(`${stageLabel}阶段不应做多,即使短期情绪火爆也要克制`);
    }
    if (direction === 'long' && (sc.fundingRegime === 'fr_high' || sc.fundingRegime === 'fr_extreme_high')) {
      tags.push('funding_squeeze');
      rootCause = rootCause || '多头已极度拥挤(费率高企),付费做多随时被收割';
      ignoredSignals.push('fundingRate已过热');
      lessonParts.push(`${frLabel}时做多=付费接盘`);
    }
    if (direction === 'long' && sc.oiRegime === 'oi_surge') {
      tags.push('oi_overheated');
      ignoredSignals.push('OI暴增暗示散户集中入场');
      lessonParts.push('OI暴增常是顶部信号,不是确认信号');
    }
    if (direction === 'short' && sc.priceStage === 'ambush') {
      tags.push('shorted_bottom');
      rootCause = rootCause || '在埋伏期(低位震荡)做空,被随后的启动行情扫出局';
      lessonParts.push('埋伏期做空胜率低,等破位或尾部更安全');
    }
    if (direction === 'short' && sc.priceStage === 'crash' && magnitude > 10) {
      tags.push('shorted_capitulation');
      rootCause = rootCause || '追跌投降行情(crash已发生),反弹风险高';
      lessonParts.push('crash阶段继续做空要准备应对技术反弹');
    }
    if (!rootCause) {
      rootCause = `${stageLabel}+${frLabel} 场景中 ${direction} 方向胜率偏低`;
      lessonParts.push('该场景历史表现不佳,需要收紧进入条件');
    }
  }

  /* === 成功案例归因 === */
  if (isWin) {
    if (direction === 'long' && sc.priceStage === 'ambush' && sc.fundingRegime === 'fr_low') {
      tags.push('caught_bottom');
      rootCause = '在埋伏期+费率低位布局,吃到后续启动行情';
      lessonParts.push('埋伏+低费率=黄金组合,应主动加仓');
    }
    if (direction === 'long' && sc.priceStage === 'pullback' && sc.fundingRegime === 'fr_negative') {
      tags.push('caught_dip');
      rootCause = '回调末期+负费率(空头过度),承接反弹';
      lessonParts.push('负费率+回调=空头回补机会');
    }
    if (direction === 'short' && (sc.priceStage === 'blowoff' || sc.priceStage === 'tail')) {
      tags.push('caught_top');
      rootCause = '在尾部/暴涨尾声做空,吃到下跌';
      lessonParts.push('尾部做空是高胜率策略');
    }
    if (direction === 'neutral') {
      tags.push('correctly_avoided');
      rootCause = '正确判断信号不明而观望,规避风险';
    }
    if (!rootCause) {
      rootCause = `${stageLabel}+${frLabel} 场景中 ${direction} 方向命中`;
      lessonParts.push('该场景策略有效,可复用');
    }
  }

  return {
    rootCause,
    ignoredSignals,
    lesson: lessonParts.join(';') || `${stageLabel}+${frLabel} 下 ${direction} 获利 ${ret.toFixed(2)}%`,
    applicableScene: {
      priceStage: sc.priceStage,
      fundingRegime: sc.fundingRegime,
      oiRegime: sc.oiRegime,
    },
    tags,
    outcome: isWin ? 'win' : 'loss',
    returnPct: ret,
    magnitude: Math.round(magnitude * 10) / 10,
    method: 'rule',
  };
}

/* ------------------ LLM 复盘 (可选) ------------------ */

async function llmReview(record) {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.log('[Review] 未设置 ANTHROPIC_API_KEY/OPENAI_API_KEY, 跳过 LLM');
    return null;
  }
  // 留接口:实际调用需要引入 SDK, 此处给规则降级
  // TODO: fetch("https://api.anthropic.com/v1/messages", ...)
  console.log('[Review] LLM 调用功能预留接口, 当前降级为规则式');
  return null;
}

/* ------------------ 主流程 ------------------ */

/**
 * 核心复盘函数 - 可被 scheduler / API 调用
 * @param {Object} opts - {useLLM: boolean, force: boolean, verbose: boolean}
 * @returns {Object} {newCount, skipCount, total, wins, losses, reportPath}
 */
async function runReview(opts = {}) {
  const { useLLM = false, force = false, verbose = true } = opts;
  if (verbose) console.log('========== 决策复盘 ==========');
  if (!fs.existsSync(TRACKING_FILE)) {
    throw new Error('tracking.json 不存在');
  }
  const tracking = JSON.parse(fs.readFileSync(TRACKING_FILE, 'utf-8'));

  // 读取已有经验, 以 id 去重
  let existing = [];
  if (fs.existsSync(EXPERIENCE_FILE)) {
    try { existing = JSON.parse(fs.readFileSync(EXPERIENCE_FILE, 'utf-8')); } catch {}
  }
  const existingIds = new Set(existing.map(e => e.sourceId));

  const lessons = force ? [] : [...existing];
  let newCount = 0;
  let skipCount = 0;

  for (const r of tracking) {
    const id = r.id || `${r.symbol}-${r.timestamp}`;
    if (!force && existingIds.has(id)) { skipCount++; continue; }
    if (!r.scene) { skipCount++; continue; }
    if (r.return24h == null && r.return4h == null) { skipCount++; continue; }

    let review = null;
    if (useLLM) {
      review = await llmReview(r);
    }
    if (!review) review = ruleBasedReview(r);
    if (!review) continue;

    lessons.push({
      sourceId: id,
      symbol: r.symbol,
      timestamp: r.timestamp,
      direction: r.direction,
      scene: r.scene,
      sceneKey: r.scene?.sceneKey,
      ...review,
    });
    newCount++;
  }

  fs.writeFileSync(EXPERIENCE_FILE, JSON.stringify(lessons, null, 2));

  if (verbose) {
    console.log(`[Review] 新增经验: ${newCount} 条`);
    console.log(`[Review] 跳过: ${skipCount} 条`);
    console.log(`[Review] 总经验库: ${lessons.length} 条`);
  }

  /* ========= 生成人读报告 ========= */
  const report = [];
  report.push('========== 经验复盘报告 ==========\n');
  report.push(`总经验: ${lessons.length} 条, 本次新增: ${newCount} 条\n`);

  const byTag = {};
  for (const l of lessons) {
    for (const t of (l.tags || [])) {
      byTag[t] = (byTag[t] || 0) + 1;
    }
  }
  report.push('\n--- 高频归因标签 ---');
  Object.entries(byTag).sort((a, b) => b[1] - a[1]).forEach(([t, n]) => {
    report.push(`  ${t}: ${n}`);
  });

  const wins = lessons.filter(l => l.outcome === 'win');
  const losses = lessons.filter(l => l.outcome === 'loss');
  report.push(`\n--- 整体表现 ---`);
  report.push(`  胜: ${wins.length}  负: ${losses.length}`);
  if (lessons.length > 0) {
    report.push(`  胜率: ${(wins.length / lessons.length * 100).toFixed(1)}%`);
  }

  report.push(`\n--- 典型教训 (Top 10 大亏) ---`);
  lessons.filter(l => l.outcome === 'loss')
    .sort((a, b) => b.magnitude - a.magnitude)
    .slice(0, 10)
    .forEach((l, i) => {
      report.push(`${i + 1}. [${l.symbol}] ${l.direction} ${l.returnPct.toFixed(1)}% | ${l.sceneKey}`);
      report.push(`   主因: ${l.rootCause}`);
      report.push(`   教训: ${l.lesson}`);
    });

  report.push(`\n--- 成功范本 (Top 5 大赢) ---`);
  lessons.filter(l => l.outcome === 'win')
    .sort((a, b) => b.magnitude - a.magnitude)
    .slice(0, 5)
    .forEach((l, i) => {
      report.push(`${i + 1}. [${l.symbol}] ${l.direction} +${l.returnPct.toFixed(1)}% | ${l.sceneKey}`);
      report.push(`   原因: ${l.rootCause}`);
    });

  const reportFile = path.join(DATA_DIR, 'review-report.txt');
  fs.writeFileSync(reportFile, report.join('\n'), 'utf-8');
  if (verbose) console.log(`报告已写入: ${reportFile}`);

  // 刷新 memory 缓存, 让新经验立即生效
  try {
    const memory = require('../lib/memory');
    memory.invalidateCache();
  } catch {}

  return {
    newCount,
    skipCount,
    total: lessons.length,
    wins: wins.length,
    losses: losses.length,
    reportPath: reportFile,
  };
}

module.exports = { runReview, ruleBasedReview };

// CLI 入口
 if (require.main === module) {
  runReview({ useLLM: CLI_USE_LLM, force: CLI_FORCE, verbose: true })
    .catch(e => {
      console.error('[Review] 失败:', e);
      process.exit(1);
    });
}
