# 数据结构与算法助教平台 · 前端

课程助教平台的网页前端。零依赖、零构建：**纯 HTML + CSS + 原生 JS**，
没有 React / Vue / Node / npm，符合考核要求「不要引入其他技术栈」。
所有图标是内联 SVG，Markdown 渲染器和 Python 语法高亮都是手写的，不依赖任何 CDN，
断网也能完整显示。

---

## 一、怎么跑起来

前端由 Django 直接托管，**只需要启动后端一个服务**，启动方式见项目根目录的
`README.md`（一条命令，在项目根目录执行）。起来之后浏览器打开
<http://127.0.0.1:8000/> 即可。

> 为什么不能直接双击 `index.html` 打开？
> 页面里的资源用的是 `/static/...` 绝对路径，而且浏览器的同源策略会拦掉
> 从 `file://` 发往 `127.0.0.1:8000` 的请求（Django 没有开 CORS）。
> 走 Django 托管就是同源，不存在这两个问题。

### 后端配合改动（共 3 处，都是新增，没有改动任何原有逻辑）

| 文件 | 改动 | 作用 |
| --- | --- | --- |
| `source/source/settings.py` | 新增 `STATICFILES_DIRS = [BASE_DIR.parent / "front"]` | 把本目录挂到 `/static/`，runserver 自动托管 CSS/JS |
| `source/core/views.py` | 新增 `home()` 与 `health()` | `home` 返回本页；`health` 给前端状态灯做毫秒级探针 |
| `source/core/urls.py` | 新增 `path("", views.home)` 与 `path("api/health/", ...)` | 修掉原来 `GET /` 返回 404 的问题 |

原有的 5 个接口（`/api/report/`、`/api/agent/`、`/api/chat/`、`/api/rag/`、`/api/router/`）一行未动。

---

## 二、文件结构

```
front/
├── index.html     页面骨架：侧边栏 + 对话区 + 输入区，内联 SVG 图标精灵
├── styles.css     设计令牌（浅色/深色）与全部组件样式
├── markdown.js    手写 Markdown 渲染器 + Python 语法高亮（无依赖）
├── app.js         状态、后端调用、四路分流、渲染与交互
└── README.md      本文件
```

---

## 三、它对接的后端契约

全部是 `application/x-www-form-urlencoded` 的 POST，与 Django 侧 `request.POST.get(...)` 对应：

| 接口 | 请求体 | 响应 | 典型耗时 |
| --- | --- | --- | --- |
| `/api/router/` | `question` | `{label, path}`，label ∈ `report\|tool\|rag\|chat` | ~1 s |
| `/api/chat/` | `question` | `{answer}` | 1–3 s |
| `/api/rag/` | `question` | `{answer, sources:[{file, chunk_id, snippet}]}` | 2–5 s |
| `/api/agent/` | `student_id`, `question` | `{answer}` | 2–10 s（含真实跑代码、查库） |
| `/api/report/` | `student_id` | `{student_id, report}`（Markdown） | **~20 s**（CrewAI 两个 Agent 串行） |
| `/api/health/` | — | `{ok, service}` | < 10 ms（本次新增） |

---

## 四、页面上做了什么

### 1. 四路自动分流是"看得见"的

默认「自动」模式下，一条提问会先打 `/api/router/` 判断意图，再转发到对应接口。
每次回答的气泡顶部都会显示：

- **路由徽章** —— 这条答案由哪条路产生（学习报告 / 工具调用 / 知识库 / 普通问答），四色区分；
- **执行轨迹** —— 例如 `判断意图 → 检索课程文档 → 生成回答`，加载中与完成后是同一批标签，
  不会在答案落地时发生内容跳变；
- **真实耗时** —— 从发出到拿到的毫秒数。

也可以在输入框上方手动指定走哪条路，方便答辩时逐条演示。

### 2. 知识库问答会摊开来源

`/api/rag/` 返回的 `sources` 渲染成可折叠的来源卡片，显示文件名、chunk 序号与原文片段，
片段过长时可展开全文 —— 对应考核要求「返回来源文件名和原文片段」。

### 3. 报告生成有进度反馈

`/api/report/` 要跑约 20 秒。这段时间里气泡会变成进度块：`报告生成中…` + 秒表 +
`查询做题记录 → 研究员整理要点 → 写手撰写报告` 三段流水线，提交按钮同时禁用防重复提交。
生成完可一键导出 `.md` 或复制全文。

### 4. 代码提交是独立输入模式

点输入框左下角「代码」切到代码模式：等宽编辑器 + 可选「标准输入」。
提交时会把代码包成一段自然语言问题发给 Agent，由它真实运行、判题并写入错题本。
代码模式下 `Enter` 是换行，`Ctrl/⌘ + Enter` 才发送，避免误提交。

### 5. 其他

- 四种回答的 Markdown 都按 Markdown 渲染（标题 / 列表 / 表格 / 引用 / 代码块 / 链接），
  代码块带语言标签、复制按钮与 Python 语法高亮；
- 每条回答都能用「原始」按钮查看后端返回的原始 JSON；
- 学号、对话记录、主题、当前模式存在 `localStorage`，刷新不丢；
- 深浅色主题跟随系统，可手动切换，切换脚本放在首帧之前，不会白屏闪一下；
- 深色/浅色、桌面/移动都适配；窄屏下侧边栏变成抽屉（带遮罩）；
- 所有动画都在 300 ms 内、只动 `transform`/`opacity`，并且完整支持
  `prefers-reduced-motion` / `prefers-reduced-transparency` / `prefers-contrast`。

---

## 五、安全与实现细节

- **Markdown 先转义再做变换**：模型输出里的 `<script>` 之类会被转义成实体，
  不可能通过 `innerHTML` 注入执行；链接做了 `http/https/mailto/#` 白名单，
  `javascript:` 会被替换成 `#`。
- **用户输入只用 `textContent` 写入**，不走 `innerHTML`。
- `fetch` 全部带 `AbortController` 超时（报告 240 s，工具 150 s，知识库 90 s，闲聊 60 s），
  超时、非 2xx、非 JSON 都有对应的中文错误卡片和「重试」按钮。
- 复制用 `navigator.clipboard`，在非安全上下文（如 http 内网 IP）自动回落到 `execCommand`。

---

## 六、自测

前端逻辑做过两轮自动化验证：

- **Markdown 渲染器**：27 项断言（标题 / 表格对齐 / 嵌套列表 / 任务列表 / 代码高亮 /
  XSS 转义 / `javascript:` 拦截）全部通过；
- **浏览器端到端**：用 Chrome DevTools Protocol 驱动真实页面，真实点击、真实请求，
  **47 项断言全部通过，页面无未捕获异常**。覆盖四路接口的分流与渲染、RAG 来源卡片、
  CrewAI 报告与表格、代码模式请求体构造、缺学号拦截、原始 JSON 折叠、持久化与清空。
