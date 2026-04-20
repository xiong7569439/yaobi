# 🔮 妖币监控系统 (Meme Coin Monitor)

基于 **OKX Agent Trade Kit** 的加密货币异动监控系统。每 5 分钟自动扫描市场行情、新闻舆情、合约持仓和社交情绪数据，通过 **7 维特征评分引擎** 发现潜在"妖币"，并支持 **做多/做空方向判断** 和 **提醒次数追踪**，在 Web 仪表盘实时推送告警。

> 💡 灵感来源：[@Xuegaogx](https://x.com/Xuegaogx) 的妖币共同特征分析框架

## 📸 预览

线上地址：[https://cryptocurrency-beryl-zeta.vercel.app](https://cryptocurrency-beryl-zeta.vercel.app)

## ✨ 功能特性

- **定时扫描**：每 5 分钟自动全量扫描，防重入机制保证不会重叠执行
- **7 维评分引擎**：新闻热度、社交热度、价格异动、成交量异动、合约数据、链上活跃、情绪指标加权评分
- **方向判断**：基于多因子信号自动判断做多/做空/观望，并输出置信度百分比
- **告警去重**：同一币种只保留最新一条告警，通过 `alertCount` 累计提醒次数
- **主流币过滤**：自动排除 BTC/ETH/SOL 等 45+ 个大市值主流币和稳定币
- **分级告警**：总分 ≥ 40 触发告警（中优先级），≥ 65 为高优先级
- **实时推送**：本地 SSE 长连接 / Vercel 自动轮询，新告警弹窗 + 音频提示
- **Web 仪表盘**：暗色主题，告警卡片、观察列表、全评分排名、7 维条形图
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
| 成交量异动 | **15%** | OKX SPOT Tickers | 24h 成交量相对均值的倍数 |
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
| 成交量倍数 | 1.5x | 3x | 5x |
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
| 费率健康 | 费率 0~0.03%（多头未过热） | +10 |
| 情绪正面 | 情绪分 > 50 | +15 |
| 社交关注 | 社交分 > 40 | +15 |

### 做空信号

| 场景 | 条件 | 得分 |
|------|------|------|
| 多头过热 | 暴涨 >30% 且费率 >0.03% | +35 |
| 费率极高 | 费率 >0.05% | +20 |
| 价格暴跌 | 24h 跌幅 >15% | +25 |
| 空头加仓 | 暴跌 >15% 且 OI 增长 >5% | +20 |
| 情绪恐慌 | 情绪分 0~25 | +10 |
| 获利盘压力 | 24h 涨幅 >80% | +15 |

### 判断规则

- 做多/做空得分需 **≥ 25** 且大于对方分数，才输出对应方向
- 否则标记为 **观望**（信号不明确）
- 前端以 🟢做多 / 🔴做空 / ➖观望 标签展示，附置信度百分比

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
│   ├── okx-fetcher.js     # OKX CLI 数据获取（execSync 调用）
│   ├── analyzer.js        # 妖币特征评分引擎 + 方向判断
│   ├── scanner.js         # 定时扫描调度器（5 分钟间隔）
│   └── store.js           # 内存 + JSON 持久化 + SSE 广播 + 告警去重
│
├── api/                   # Vercel Serverless Functions
│   ├── scan.js            # POST /api/scan 触发扫描
│   ├── alerts.js          # GET /api/alerts 告警列表
│   ├── status.js          # GET /api/status 系统状态
│   ├── latest.js          # GET /api/latest 最新扫描结果
│   ├── logs.js            # GET /api/logs 扫描日志
│   ├── cron.js            # Vercel Cron 定时任务
│   └── _lib/              # Serverless 共享模块
│       ├── okx-http.js    # OKX REST API（HTTPS + HMAC 签名）
│       ├── analyzer.js    # 评分引擎（与 lib 版同步）
│       └── store.js       # /tmp 文件缓存 + 告警去重
│
├── data/                  # 本地持久化数据目录
│   ├── alerts.json        # 告警历史（最多 500 条）
│   ├── alert-counts.json  # 代币提醒次数追踪
│   └── scan-log.json      # 扫描日志（最多 100 条）
│
└── public/
    └── index.html         # Web 仪表盘（暗色主题 SPA）
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

访问 **http://localhost:3000** 查看仪表盘。系统启动后 5 秒执行首次扫描，之后每 5 分钟自动扫描。

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
| `POST` | `/api/scan` | 手动触发扫描 |

### Vercel 模式（Serverless）

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/alerts` | 告警列表 |
| `GET` | `/api/status` | 系统状态 |
| `GET` | `/api/latest` | 最新扫描结果 |
| `POST` | `/api/scan` | 触发扫描（前端自动轮询调用） |

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
- **方向标签**：🟢做多 X% / 🔴做空 X% / ➖观望，附方向依据说明
- **提醒次数**：蓝色"已提醒 N 次"标签，追踪代币历史告警频率
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

- **Vercel OI 数据**：线上只能获取持仓量快照（`/api/v5/public/open-interest`），无法获取 OI 变化百分比，导致合约维度（15%）贡献较低，线上评分可能略低于本地
- **Vercel 冷启动**：Serverless 函数每次冷启动会丢失内存数据，依赖 `/tmp` 文件缓存
- **Vercel 超时**：函数执行最长 30 秒，网络延迟可能影响数据完整性
- **API 额度**：OKX orbit API 有调用频率限制，建议不要过于频繁手动扫描

## ⚠️ 免责声明

本项目仅供学习和研究使用，**不构成任何投资建议**。加密货币投资存在高风险，请自行承担风险并做好充分调研。

## 📄 License

ISC
