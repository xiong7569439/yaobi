# 🔮 妖币监控系统 (Meme Coin Monitor)

基于 **OKX Agent Trade Kit** + **Surf Data Platform** 的加密货币异动监控系统。每 5 分钟自动扫描新闻、市场、社交和合约数据，通过 7 维特征评分框架发现潜在"妖币"，并在 Web 仪表盘实时推送告警。

> 💡 灵感来源：[@Xuegaogx](https://x.com/Xuegaogx) 的妖币共同特征分析框架

## 📸 预览

线上地址：[https://cryptocurrency-beryl-zeta.vercel.app](https://cryptocurrency-beryl-zeta.vercel.app)

## ✨ 功能特性

- **定时扫描**：每 5 分钟自动扫描全市场数据
- **多维数据源**：OKX 市场/新闻/合约数据 + Surf 社交/链上/情绪数据
- **智能评分**：7 维妖币特征匹配引擎，加权评分过滤噪音
- **主流币过滤**：自动排除 BTC/ETH 等大市值主流币和稳定币
- **实时告警**：SSE 推送（本地）/ 轮询（Vercel），告警分级展示
- **Web 仪表盘**：暗色主题，实时展示告警、观察列表和扫描状态
- **手动扫描**：一键手动触发扫描
- **双模式部署**：支持本地 Node.js 长驻服务 + Vercel Serverless 部署

## 🏗️ 系统架构

```
[定时调度器 5min] ──► [OKX API: market + news] ──► [数据聚合 & 分析引擎]
                  ──► [Surf API: social + news] ──►        │
                                                    [妖币特征匹配框架]
                                                           │
                                                    [Express / Serverless]
                                                           │
                                                    [Web 仪表盘 实时推送]
```

## 📊 妖币特征评分体系

| 维度 | 权重 | 数据源 | 说明 |
|------|------|--------|------|
| 社交热度 | 20% | Surf 社交排名 | Twitter 提及量激增、趋势排名上升 |
| 新闻热度 | 15% | OKX 新闻 + Surf 新闻 | 短时间内出现多条相关新闻 |
| 价格异动 | 15% | OKX Spot Tickers | 24h 涨幅超过阈值 |
| 成交量异动 | 15% | OKX Spot Tickers | 24h 成交量暴增 |
| 合约数据 | 15% | OKX OI + 资金费率 | OI 快速增长、资金费率偏高 |
| 链上活跃 | 10% | Surf DEX 数据 | DEX 交易活跃度突增 |
| 情绪指标 | 10% | OKX 情绪 + Surf 恐惧贪婪 | 新闻/社交情绪偏正面 |

**告警规则**：总分 ≥ 15 触发告警 → ≥ 45 高优先级告警

## 📁 项目结构

```
cryptocurrency/
├── server.js              # 本地 Express 主服务入口
├── package.json
├── vercel.json            # Vercel 部署配置
├── lib/                   # 本地模式核心模块
│   ├── okx-fetcher.js     # OKX CLI 数据获取
│   ├── surf-fetcher.js    # Surf CLI 数据获取
│   ├── analyzer.js        # 妖币特征匹配引擎
│   ├── scanner.js         # 定时扫描调度器
│   └── store.js           # 内存 + JSON 持久化 + SSE
├── api/                   # Vercel Serverless Functions
│   ├── scan.js            # POST /api/scan 手动扫描
│   ├── alerts.js          # GET /api/alerts 告警列表
│   ├── status.js          # GET /api/status 系统状态
│   ├── latest.js          # GET /api/latest 最新扫描
│   ├── cron.js            # Vercel Cron 定时任务
│   └── _lib/              # Serverless 共享模块
│       ├── okx-http.js    # OKX REST API (纯 HTTP)
│       ├── surf-http.js   # Surf REST API (纯 HTTP)
│       ├── analyzer.js    # 评分引擎
│       └── store.js       # 内存缓存
└── public/
    └── index.html         # Web 仪表盘（暗色主题）
```

## 🚀 快速开始

### 环境要求

- Node.js ≥ 18
- OKX API Key（用于新闻数据，市场数据免费）
- Surf CLI（可选，用于本地模式）

### 1. 本地运行

```bash
# 克隆项目
git clone https://github.com/xiong7569439/yaobi.git
cd yaobi

# 安装依赖
npm install

# 安装 OKX CLI（可选，本地模式需要）
npm install -g @okx_ai/okx-trade-mcp @okx_ai/okx-trade-cli

# 设置 OKX API Key（用于新闻数据）
export OKX_API_KEY="your-api-key"
export OKX_SECRET_KEY="your-secret-key"
export OKX_PASSPHRASE="your-passphrase"

# 启动服务
npm start
```

访问 http://localhost:3000 查看仪表盘，系统会每 5 分钟自动扫描。

### 2. Vercel 部署

```bash
# 安装 Vercel CLI
npm install -g vercel

# 部署
vercel --prod

# 设置环境变量
vercel env add OKX_API_KEY production
vercel env add OKX_SECRET_KEY production
vercel env add OKX_PASSPHRASE production
```

> Vercel Hobby 不支持高频 Cron，扫描由前端自动轮询触发（页面打开时每 5 分钟调用一次 `/api/scan`）。

## 📡 API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/status` | 系统运行状态 |
| `GET` | `/api/alerts` | 历史告警列表 |
| `GET` | `/api/latest` | 最近一次扫描结果 |
| `POST` | `/api/scan` | 手动触发扫描 |

## 🔧 技术栈

- **后端**：Node.js + Express（本地）/ Vercel Serverless（线上）
- **前端**：原生 HTML + CSS + JS，SSE 实时推送 / 轮询
- **数据源**：OKX Agent Trade Kit（market + news） + Surf Data Platform（social + chain）
- **存储**：内存 + JSON 文件持久化（本地）/ 内存缓存（Vercel）
- **部署**：Vercel

## ⚠️ 免责声明

本项目仅供学习和研究使用，**不构成任何投资建议**。加密货币投资存在高风险，请自行承担风险并做好充分调研。

## 📄 License

ISC
