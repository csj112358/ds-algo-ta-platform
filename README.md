# 数据结构与算法助教平台

## 流程（以查一次百度百科为例）

学生问「什么是红黑树」，前后端是这样配合的：

```
┌────────────────────────┐                          ┌──────────────────────────────┐
│ 前端  front/           │                          │ 后端  source/                │
│ HTML + CSS + 原生 JS   │                          │ Django + LangChain + Agent   │
├────────────────────────┤                          ├──────────────────────────────┤
│                        │                          │                              │
│ ① 输入「什么是红黑树」 │ ── POST /api/router/ ──▶ │ 意图判断：需要真实百科       │
│ ② 收到 label = tool    │ ◀──── label = tool ────  │ 返回 {label: tool, path}     │
│ ③ 带学号再发问         │ ── POST /api/agent/ ───▶ │ Agent 调 wiki_search 工具    │
│                        │                          │ GET 百度百科接口（真实请求） │
│                        │                          │ 摘要交给模型组织答案         │
│ ④ 渲染回答 + 工具徽章  │ ◀──── {answer} ────────  │ 返回 {answer} JSON           │
└────────────────────────┘                          └──────────────────────────────┘
```

## 前端 `front/`

纯 HTML + CSS + 原生 JS，**无框架、无构建、无 CDN**，只通过 `/api/*` 与后端通信。

| 文件 | 作用 |
| --- | --- |
| `index.html` | 页面骨架、侧边栏、图标、切换学生弹层 |
| `styles.css` | 设计令牌与全部组件样式，浅色 / 深色主题 |
| `markdown.js` | 手写 Markdown 渲染器 + Python 语法高亮 |
| `app.js` | 状态管理、调用后端接口、四路分流、渲染与交互 |

## 后端 `source/`

Django + SQLite + LangChain + Chroma + CrewAI，只负责接口与数据。

| 位置 | 作用 |
| --- | --- |
| `core/views.py`、`core/urls.py` | HTTP 接口，全部挂在 `/api/` 下 |
| `core/services/` | 四条回答路径：知识库检索、工具调用、CrewAI 报告、普通问答，外加意图分流 |
| `core/services/langchain_agent_tools/` | 真实工具：在线跑代码、查做题记录、当前时间、百科查询 |
| `core/knowledge/` | 知识库 PDF（数组、链表、栈、队列等） |
| `core/database/course.db` | 做题记录与学生名单（不随仓库提供，由 `source/init_db.py` 初始化生成） |
| `core/.env` | 模型与百科接口的密钥（模板见 `core/.env.example`） |

## 运行前准备

**① 装依赖**（Python 3.13 实测，在项目根目录执行）：

```powershell
pip install torch==2.14.1 --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt
```

**② 填密钥**：把 `source/core/.env.example` 复制成 `source/core/.env`，填这 4 个值：

```powershell
copy source\core\.env.example source\core\.env
```

```dotenv
OPENAI_API_KEY=...              # DeepSeek（或任意 OpenAI 兼容接口）的 Key
OPENAI_BASE_URL=https://api.deepseek.com/v1
MODEL_NAME=deepseek-chat
BAIDU_WIKI_API_KEY=...          # 百度千帆 AppBuilder 的 Key，百科工具用
```

**③ 初始化数据库**（`db.sqlite3` 与 `course.db` 都不随仓库提供，首次运行前各执行一次）：

```powershell
python source/manage.py migrate
python source/init_db.py
```

`init_db.py` 会建好做题记录库，并写入 xiaoming / zhangsan 两名演示学生；脚本是幂等的，重复运行不会清空已有数据。

**④ 嵌入模型**：知识库检索用 `BAAI/bge-small-zh-v1.5`（约 100MB）。本地没有 `source/bge-small-zh-v1.5/` 目录时，首次运行会自动从 HuggingFace 下载；国内网络建议先设镜像：

```powershell
$env:HF_ENDPOINT = "https://hf-mirror.com"
```

也可以手动下载模型，把整个目录放到 `source/bge-small-zh-v1.5/`，代码会优先使用本地版本（离线可用）。

## 一键启动

在**项目根目录**打开终端，粘这一行回车：

```powershell
python -X utf8 source/manage.py runserver 127.0.0.1:8000 --noreload
```

然后浏览器打开 **<http://127.0.0.1:8000/>**。前端由 Django 一起托管，不用另外启动前端服务。

首次启动会读取知识库并建向量索引，约 20 秒（这段时间控制台没有新输出）；如果嵌入模型还没下载过，首次会多花几分钟下载模型，之后就正常了。

## 许可证

[MIT](LICENSE)
