# 🔮 妖币监控系统 (Meme Coin Monitor)

基于 **OKX Agent Trade Kit** 的加密货币异动监控系统。每 5 分钟自动扫描市场行情、新闻舆情、合约持仓和社交情绪数据，通过 **7 维特征评分引擎** 发现潜在"妖币"，并支持 **做多/做空方向判断**、**提醒次数追踪**、**告警自进化学习** 和 **大盘背景分析**，在 Web 仪表盘实时推送告警。

> 🎯 v2 增强：在原有统计学学习基础上，引入 **Hermes 式决策闭环** — 场景标签化 + 硬规则拦截追高 + 经验库调取 + 定时自动复盘，让妖币筛选从"看对过"进化为"吃一切长一智"。

## 📸 预览

线上地址：[https://cryptocurrency-beryl-zeta.vercel.app](https://cryptocurrency-beryl-zeta.vercel.app)

## ✨ 功能特性

- **定时扫描**：每 5 分钟自动全量扫描，防重入机制保证不会重叠执行
- **7 维评分引擎**：新闻热度、社交热度、价格异动、成交量异动、合约数据、链上活跃、情绪指标加权评分
- **方向判断**：基于多因子信号自动判断做多/做空/观望，并输出置信度百分比
- **告警去重**：同一币种只保留最新一条告警，通过 `alertCount` 累计提醒次数
- **主流币过滤**：自动排除 BTC/ETH/SOL 等 45+ 个大市值主流币和稳定币
- **交易对去重**：同一基础币种（如 CORE-USDT / CORE-USD / CORE-EUR）自动合并，优先保留 USDT 交易对
- **分级告警**：总分 ≥ 40 触发告警（中优先级），≥ 65 为高优先级
- **实时推送**：本地 SSE 长连接 / Vercel 自动轮询，新告警弹窗 + 音频提示
- **大盘背景**：实时展示 BTC/ETH 行情与涨跌，自动生成市场摘要（强势/微涨/回调/偏弱）
- **告警自进化**：价格追踪验证（1h/4h/24h 回报率）→ 反馈学习 → 自动调整评分权重
- **僵尸检测**：连续告警但无回报的代币自动降权（衰减因子 0.1x ~ 1.0x）
- **权重反转**：成交量等强负相关维度（r < -0.5）自动反转为减分项
- **回调入场**：价格小幅回调 + 情绪/新闻正面 → 识别「跌着等你上车」机会
- **过热模式**：学习做多后暴跌的模式特征，自动增加做空信号
- **场景标签化** 🆕：每条告警自动打 5 维标签（价格阶段 / 大盘状态 / 费率区间 / 成交量区间 / OI 区间），组成 `sceneKey`
- **P0 硬规则拦截** 🆕：暴涨尾声/尾部过热/启动期拥挤 → 强制转为观望或反操，从源头防追高
- **P1 经验库检索** 🆕：基于 Jaccard 场景相似度查历史胜率，自动放大/缩小置信度（0.5x～1.3x）
- **P2 定时复盘** 🆕：每 4h 自动跑规则式复盘，把完成的追踪沉淀为带教训标签的经验条目
- **独立 pending 检查** 🆕：每 2 分钟独立回收 1h/4h/24h 价格，不受扫描卡顿影响
- **Web 仪表盘**：暗色主题，告警卡片、告警验证、系统学习、7 维条形图
- **双模式部署**：本地 Node.js 长驻服务 + Vercel Serverless 无缝切换

## 🏗️ 系统架构

```
┌──────────────────────────────────────────────────────────┐
│                   定时调度器 (每 5 分钟)                    │
└───────────────────────┬──────────────────────────────────┘
                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
  ┌───────────┐  ┌───────────┐  ┌───────────────┐
  │ SPOT 行情  │  │  新闻搜索  │  │ 情绪排名/OI   │
  │ (涨幅/量)  │  │ (orbit)   │  │ (orbit/公开)  │
  └─────┬─────┘  └─────┬─────┘  └──────┬────────┘
        │               │               │
        └───────────────┼───────────────┘
                        ▼
              ┌──────────────────┐
              │ 7 维特征评分引擎  │
              │  + 方向判断模型   │
              │  + 大盘背景分析   │
              └────────┬─────────┘
                       │
         ┌─────────────┼─────────────┐
         ▼             ▼             ▼
   ┌──────────┐  ┌──────────┐  ┌──────────┐
   │ 告警列表  │  │ 观察列表  │  │ 全评分榜  │
   │ (≥40分)  │  │ (20-39)  │  │ (Top 50) │
   └─────┬────┘  └─────┬────┘  └─────┬────┘
         │             │             │
         └─────────────┼─────────────┘
                       ▼
              ┌──────────────────┐
              │  价格追踪 (1/4/24h) │
              │  → 回报率验证     │
              └────────┬─────────┘
                       ▼
              ┌──────────────────┐
              │  反馈学习引擎     │
              │  僵尸检测/权重学习 │
              │  过热模式/时段优化 │
              └────────┬─────────┘
                       ▼
              ┌──────────────────┐
              │ Express / Vercel │
              │   SSE / 轮询     │
              └────────┬─────────┘
                       ▼
              ┌──────────────────┐
              │  Web 仪表盘      │
              │  (暗色主题 SPA)  │
              └──────────────────┘
```

## 📊 妖币特征评分体系

### 评分维度与权重

| 维度 | 权重 | 数据源 | 说明 |
|------|------|--------|------|
| 社交热度 | **20%** | OKX 情绪排名 (`socialScore`) | 社交平台讨论热度、趋势排名 |
| 新闻热度 | **15%** | OKX 新闻搜索 (`orbit/news-search`) | 短时间内出现多条相关新闻 |
| 价格异动 | **15%** | OKX SPOT Tickers | 24h 涨/跌幅超过阈值 |
| 成交量异动 | **15%** | OKX SPOT Tickers | 24h 成交量相对市场中位数的倍数 |
| 合约数据 | **15%** | OKX OI 快照 + 资金费率 | OI 变化幅度、资金费率偏离 |
| 链上活跃 | **10%** | OKX 综合数据 | 链上交易活跃度指标 |
| 情绪指标 | **10%** | OKX 情绪排名 (`sentimentScore`) | 新闻/社交综合情绪偏向 |

### 告警阈值

| 阈值 | 分值 | 说明 |
|------|------|------|
| 告警触发 | **≥ 40 分** | 进入告警列表，标记为中优先级 |
| 高优先级 | **≥ 65 分** | 高优先级告警，红色标记 |
| 观察列表 | **20 - 39 分** | 值得关注但尚未达到告警标准 |

### 各维度阈值配置

| 指标 | 低分线 | 中分线 | 满分线 |
|------|--------|--------|--------|
| 24h 涨幅 | 8% | 20% | 50% |
| 成交量倍数 | 1.5x | 3x | 5x（基于当前扫描所有代币的中位数成交量） |
| OI 变化幅度 | - | 15% | 30% |
| 资金费率 | - | 0.02% | 0.05% |
| 新闻数量 | - | 3 条 | 5 条 |

## 🎯 方向判断模型

系统根据多因子信号自动判断方向建议（做多/做空/观望），并输出置信度（0-100%）。

### 做多信号

| 信号 | 条件 | 得分 |
|------|------|------|
| 价格上涨 | 24h 涨幅 > 5% | +25 |
| 强势上涨 | 24h 涨幅 > 20% | +15（叠加） |
| OI 增长 | OI 变化 > 5% | +20 |
| 费率健康 | 费率 0~0.03%（多头未过热，OKX原始值 < 0.0003） | +10 |
| 情绪正面 | 情绪分 > 50 | +15 |
| 社交关注 | 社交分 > 40 | +15 |

### 回调入场做多（Pullback Buy）

| 信号 | 条件 | 得分 |
|------|------|------|
| 情绪正面回调 | 价格 -1%~-10% 且情绪分 ≥ 60 | +15 |
| 新闻驱动 | 新闻数 ≥ 3 条 | +10 |
| 费率低位 | 资金费率 < 0.02% | +10 |
| OI 稳定 | OI 变化 0%~10%（未崩溃） | +10 |
| 社交关注 | 社交分 > 30 | +10 |

> 回调入场信号需累计 ≥ 25 分才触发，识别「跌着等你上车」的机会

### 做空信号

| 场景 | 条件 | 得分 |
|------|------|------|
| 多头过热 | 暴涨 >30% 且费率 >0.03%（OKX原始值 > 0.0003） | +35 |
| 费率极高 | 费率 >0.05%（OKX原始值 > 0.0005） | +20 |
| 价格暴跌 | 24h 跌幅 >15% | +25 |
| 空头加仓 | 暴跌 >15% 且 OI 增长 >5% | +20 |
| 情绪恐慌 | 情绪分 0~25 | +10 |
| 获利盘压力 | 24h 涨幅 >80% | +15 |

### 判断规则

- 做多/做空得分需 **≥ 25** 且大于对方分数，才输出对应方向
- 否则标记为 **观望**（信号不明确）
- 前端以 🟢做多 / 🔴做空 / ➖观望 标签展示，附置信度百分比

## 🧭 Hermes 式决策闭环

对标 Hermes / MAKIMA 自学习 Agent 方法论，系统实现四步闭环，让每一次告警都成为未来决策的教材：

```
  ① 决策留痕 → ② 24h 回访 → ③ AI 复盘 → ④ 经验调取 → ① ...
  (tracker)    (checkPending)  (review.js)   (memory.js)
```

| 步骤 | 实现模块 | 触发时机 | 产出 |
|------|---------|---------|------|
| ① 决策留痕 | [lib/tracker.js](lib/tracker.js) | 每次告警产生 | 告警快照 + `scene` 标签 + `marketSnapshot` |
| ② 24h 回访 | [lib/tracker.js](lib/tracker.js) (`checkPending`) | 2 min 独立检查 | `return1h/4h/24h` 回报率 |
| ③ AI 复盘 | [scripts/review.js](scripts/review.js) | 4h 自动 + 手动触发 | `data/experience.json` (rootCause/ignoredSignals/lesson/tags) |
| ④ 经验调取 | [lib/memory.js](lib/memory.js) | 每次评分时 | `sceneAdvice.multiplier` (0.5～1.3x 调整置信度) |

### 场景标签体系 ([lib/scene.js](lib/scene.js))

| 维度 | 取值 |
|------|------|
| **priceStage** (价格阶段) | `crash` 暴跌 / `pullback` 回调 / `ambush` 埋伏 / `ignition` 启动 / `rally` 上涨中 / `tail` 尾部 / `blowoff` 暴涨尾声 |
| **marketScene** (大盘) | `btc_strong_up` / `btc_up` / `neutral` / `btc_down` / `btc_strong_down` |
| **fundingRegime** (费率) | `fr_negative` / `fr_low` / `fr_healthy` / `fr_high` / `fr_extreme_high` |
| **volumeRegime** (成交量) | `vol_dry` / `vol_normal` / `vol_active` / `vol_spike` / `vol_explosive` |
| **oiRegime** (持仓) | `oi_plunge` / `oi_decline` / `oi_stable` / `oi_building` / `oi_surge` |

五维组合成 `sceneKey`，例如：`btc_down|crash|fr_negative|oi_stable`

### P0 硬规则拦截

| 场景 | 原方向 | 拦截后 | 原因 |
|------|--------|--------|------|
| `blowoff` (>100%) + long | long | short 或 neutral | 暴涨尾声禁买 |
| `tail` + 费率过热 | long | neutral | 尾部拥挤停手 |
| `tail` + 费率健康 | long | long(×0.7) | 保留但打折 |
| `ignition` + `fr_extreme_high` | long | neutral | 多头已极度拥挤 |

### P1 经验库置信度调整

- `sceneSimilarity(a, b)` Jaccard 匹配，返回 Top-K 相似案例
- `sceneAdvice(scene, direction)` 查同场景同方向历史胜率→输出乘数
  - 胜率 ≥70% + 均值 +5% → **1.3x** (信心加强)
  - 胜率 ≤ 30% + 均值 -3% → **0.5x** (直接降为 neutral)
  - 样本 < 3 → **1.0x** (不干预)

### P2 定时复盘

- 规则式复盘默认开启，每 4h 自动跑一次
- LLM 开关预留：设置 `ANTHROPIC_API_KEY` 后可启用语义级复盘
- 自动归因标签：`chased_top` / `funding_squeeze` / `oi_overheated` / `caught_bottom` / `shorted_bottom` / `correctly_avoided` …
- 产出 `data/experience.json` 精炼经验 + `data/review-report.txt` 人读报告

## 🧠 告警自进化系统

系统通过**追踪 → 验证 → 学习 → 反馈**闭环，自动优化评分引擎。

### 价格追踪验证

告警产生后，系统记录当时价格（P₀），在 1h / 4h / 24h 检查点获取当前价格，计算回报率。

### 反馈学习引擎

| 功能 | 说明 | 触发条件 |
|------|------|----------|
| 僵尸检测 | 连续告警无回报的代币自动降权 | ≥10次告警 + 平均回报 < 2% → 衰减 0.7x |
| 权重学习 | 皮尔逊相关分析各维度与24h回报的关系 | ≥30条完成追踪记录 |
| 权重反转 | 强负相关维度（r < -0.5）反转为减分项 | 如成交量 r=-0.86 → 权重变负 |
| 过热模式 | 做多后暴跌的共同特征 → 增加做空信号 | ≥3个过热样本 |
| 时段优化 | 识别告警质量最高的小时段 | 自动统计24h分布 |

### 学习调度

- 每完成 10 条追踪记录或每 6 小时触发一次学习分析
- 学习参数持久化到 `data/learned-params.json`

## 📈 大盘背景

每次扫描自动提取 BTC/ETH 实时行情，前端顶部展示大盘行情横条：
- 价格 + 24h涨跌幅
- 自动生成市场摘要：🚀强势 / ↗️微涨 / ⚠️回调 / ↘️偏弱

## 🔔 告警去重与提醒计数

- 同一币种（symbol）在告警列表中 **只保留最新一条**
- 旧告警被替换时，保留 `firstSeenAt`（首次发现时间）
- 每次触发告警时 `alertCount` 累计 +1
- 前端展示"已提醒 N 次"蓝色标签
- 提醒计数持久化到 `data/alert-counts.json`

## 📁 项目结构

```
cryptocurrency/
├── server.js              # 本地 Express 主服务入口（SSE + API）
├── package.json           # 项目依赖和脚本
├── vercel.json            # Vercel 部署配置（Cron + 路由重写）
│
├── lib/                   # 本地模式核心模块
│   ├── okx-fetcher.js     # OKX CLI 数据获取 + 大盘背景提取
│   ├── analyzer.js        # 评分引擎 + 方向判断 + P0拦截 + P1经验库
│   ├── scanner.js         # 定时扫描(5min) + pending检查(2min) + 定时复盘(4h)
│   ├── store.js           # 内存 + JSON 持久化 + SSE 广播 + 大盘缓存
│   ├── tracker.js         # 价格追踪模块（1h/4h/24h 回报验证 + 场景快照）
│   ├── learner.js         # 反馈学习引擎（僵尸/权重/过热/时段）
│   ├── scene.js           # 🆕 场景标签器（5维 priceStage/marketScene/fundingRegime/volumeRegime/oiRegime）
│   └── memory.js          # 🆕 经验库检索（Jaccard 相似度 + 场景胜率查询）
│
├── scripts/               # 🆕 离线工具脚本
│   ├── backfill-scenes.js # 历史追踪记录补打场景标签
│   ├── backtest.js        # 按方向/持仓/场景分组的回测报表
│   └── review.js          # 规则式复盘 (+ LLM 挂点预留)
│
├── api/                   # Vercel Serverless Functions
│   ├── scan.js / alerts.js / status.js / latest.js
│   ├── tracking.js / learning.js / cron.js
│   └── _lib/              # Serverless 共享模块（与 lib/ 同步）
│       ├── okx-http.js analyzer.js store.js tracker.js learner.js
│       └── scene.js memory.js         # 🆕 用于 Serverless 调用
│
├── data/                  # 本地持久化数据目录
│   ├── alerts.json        # 告警历史（最多 500 条）
│   ├── alert-counts.json  # 代币提醒次数追踪
│   ├── scan-log.json      # 扫描日志（最多 100 条）
│   ├── tracking.json      # 价格追踪记录（含场景标签）
│   ├── learned-params.json # 学习参数（衰减/权重/过热/时段）
│   ├── experience.json    # 🆕 精炼经验库（review.js 产出）
│   ├── review-report.txt  # 🆕 复盘报告（人读版）
│   └── backtest-report.txt # 🆕 回测报告
│
└── public/
    └── index.html         # Web 仪表盘（暗色主题 SPA，3标签页）
```

## 🚀 快速开始

### 环境要求

- **Node.js** ≥ 18
- **OKX API Key**（新闻/情绪数据需要，市场数据免费）
- **OKX CLI**（本地模式需要）

### 1. 本地运行

```bash
# 克隆项目
git clone https://github.com/xiong7569439/yaobi.git
cd yaobi

# 安装依赖
npm install

# 安装 OKX CLI（本地模式需要）
npm install -g @okx_ai/okx-trade-mcp @okx_ai/okx-trade-cli

# 设置 OKX API 环境变量
export OKX_API_KEY="your-api-key"
export OKX_SECRET_KEY="your-secret-key"
export OKX_PASSPHRASE="your-passphrase"

# 启动服务
npm start
```

访问 **http://localhost:47329** 查看仪表盘。系统启动后 5 秒执行首次扫描，之后每 5 分钟自动扫描；每 2 分钟检查一次 pending 追踪；每 4 小时自动复盘沉淀经验。

> 💡 默认端口由 3000 迁移至 **47329**（冷门高位端口，避免冲突）。自定义请设置环境变量 `PORT`。

### 2. Vercel 部署

```bash
# 安装 Vercel CLI
npm install -g vercel

# 部署
vercel --prod

# 设置环境变量（Vercel 控制台或 CLI）
vercel env add OKX_API_KEY production
vercel env add OKX_SECRET_KEY production
vercel env add OKX_PASSPHRASE production
```

> **注意**：Vercel Hobby 计划不支持高频 Cron。扫描由前端打开页面时自动轮询触发（每 5 分钟调用 `/api/scan`）。Serverless 函数超时限制 30 秒。

## 📡 API 端点

### 本地模式（Express）

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/events` | SSE 实时推送（心跳 30s） |
| `GET` | `/api/alerts` | 告警列表（支持 `level`/`symbol`/`limit` 过滤） |
| `GET` | `/api/status` | 系统运行状态（扫描次数/倒计时/运行时间） |
| `GET` | `/api/latest` | 最新扫描结果（alerts + watchlist + allScores） |
| `GET` | `/api/logs` | 扫描历史日志 |
| `GET` | `/api/tracking` | 告警追踪记录（支持 `status`/`symbol`/`limit`） |
| `GET` | `/api/learning` | 学习参数（衰减因子/权重调整/过热模式） |
| `GET` | `/api/market` | 大盘背景（BTC/ETH 实时行情） |
| `POST` | `/api/scan` | 手动触发扫描 |
| `POST` | `/api/review` | 🆕 手动触发一次复盘（支持 `?force=1` 强制重新生成） |
| `GET` | `/api/experience` | 🆕 查询经验库，支持 `tag`/`stage`/`outcome`/`limit` 过滤 |
| `GET` | `/api/scheduler` | 🆕 调度器状态（下次扫描/上次复盘/经验总数） |

### Vercel 模式（Serverless）

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/alerts` | 告警列表 |
| `GET` | `/api/status` | 系统状态 |
| `GET` | `/api/latest` | 最新扫描结果 |
| `GET` | `/api/tracking` | 追踪记录 |
| `GET` | `/api/learning` | 学习参数 |
| `POST` | `/api/scan` | 触发扫描（前端自动轮询调用） |

## 🛠 离线工具脚本

追踪记录补标签、回测、复盘之类的离线操作：

```bash
# 1）对已有 tracking.json 全量补场景标签 + 分布统计
node scripts/backfill-scenes.js

# 2）场景化回测 (按价格阶段/费率/OI 分组)
node scripts/backtest.js > data/backtest-report.txt

# 3）手动复盘 (规则式)
node scripts/review.js

# 4）手动复盘 (强制重建所有经验)
node scripts/review.js --force

# 5）启用 LLM 复盘 (需 ANTHROPIC_API_KEY 环境变量)
node scripts/review.js --llm
```

## 🔌 OKX 数据源

### 本地模式 - CLI 命令

| 数据 | CLI 命令 | 说明 |
|------|----------|------|
| SPOT 行情 | `market tickers SPOT` | 涨幅榜 + 成交量榜 Top 20 |
| OI 变化 | `market oi-change --instType SWAP` | 合约持仓变化百分比 Top 20 |
| 最新新闻 | `news latest --limit 30` | 需要 API Key |
| 重要新闻 | `news important --limit 20` | 需要 API Key |
| 情绪排名 | `news sentiment-rank --period 24h --limit 20` | 需要 API Key |

### Vercel 模式 - HTTP API

| 数据 | 端点 | 认证方式 |
|------|------|----------|
| SPOT 行情 | `/api/v5/market/tickers?instType=SPOT` | 公开（无需认证） |
| 持仓量快照 | `/api/v5/public/open-interest?instType=SWAP` | 公开（无需认证） |
| 资金费率 | `/api/v5/public/funding-rate` | 公开（无需认证） |
| 新闻搜索 | `/api/v5/orbit/news-search` | HMAC-SHA256 签名 |
| 情绪排名 | `/api/v5/orbit/currency-sentiment-ranking` | HMAC-SHA256 签名 |

> **签名方式**：`HMAC-SHA256(timestamp + 'GET' + fullPathWithQuery)`，请求头携带 `OK-ACCESS-KEY`、`OK-ACCESS-SIGN`、`OK-ACCESS-TIMESTAMP`、`OK-ACCESS-PASSPHRASE`。

## 🖥️ 前端功能

- **告警卡片**：分级颜色标记（🔴高/🟠中/🟡低），显示 7 维评分条形图
- **大盘行情**：顶部实时显示 BTC/ETH 价格与涨跌，自动市场摘要
- **方向标签**：🟢做多 X% / 🔴做空 X% / ➖观望，附方向依据说明（含回调入场）
- **提醒次数**：蓝色"已提醒 N 次"标签，追踪代币历史告警频率
- **告警验证**：追踪每个告警的 1h/4h/24h 回报率，可视化验证结果
- **系统学习**：展示学习参数（僵尸衰减、权重调整+相关系数、时段热力图、过热模式）
- **观察列表**：评分 20-39 的潜力代币表格
- **全评分排名**：Top 50 代币的完整评分明细
- **实时状态**：扫描倒计时、告警数量统计、系统运行时间
- **搜索过滤**：按告警级别和币种名称快速筛选
- **手动扫描**：一键触发即时扫描
- **音频提示**：新告警时自动播放提示音
- **自动重连**：SSE 断开后 5 秒自动重连

## 🔧 技术栈

| 类别 | 技术 |
|------|------|
| **后端** | Node.js + Express 5（本地）/ Vercel Serverless（线上） |
| **前端** | 原生 HTML + CSS + JavaScript（暗色主题 SPA） |
| **数据源** | OKX Agent Trade Kit（CLI + REST API） |
| **实时通信** | SSE（本地长连接）/ HTTP 轮询（Vercel） |
| **存储** | 内存 + JSON 文件持久化（本地）/ `/tmp` 文件缓存（Vercel） |
| **认证** | HMAC-SHA256 签名（OKX orbit API） |
| **部署** | Vercel（Serverless + 静态托管 + Cron） |

## ⚠️ 已知限制

- **Vercel OI 数据**：线上通过两次扫描间的 OI 快照对比（`/tmp/oi-prev.json`）计算 OI 变化百分比，首次扫描（无历史快照时）OI 维度为 0，第二次扫描后恢复正常
- **Vercel 冷启动**：Serverless 函数每次冷启动会丢失内存数据，依赖 `/tmp` 文件缓存
- **Vercel 超时**：函数执行最长 30 秒，网络延迟可能影响数据完整性
- **API 额度**：OKX orbit API 有调用频率限制，建议不要过于频繁手动扫描

## ⚠️ 免责声明

本项目仅供学习和研究使用，**不构成任何投资建议**。加密货币投资存在高风险，请自行承担风险并做好充分调研。

## 📄 License

ISC
