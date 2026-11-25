/* ============================================================
   app.js — 数据结构与算法助教平台 前端逻辑
   纯原生 JS：无框架、无构建、无 CDN 依赖。

   与后端的契约（全部 form-encoded POST，Django 侧 request.POST.get 取值）：
     POST /api/router/  {question}                 -> {label, path}
     POST /api/chat/    {question}                 -> {answer}
     POST /api/rag/     {question}                 -> {answer, sources[{file,chunk_id,snippet}]}
     POST /api/agent/   {student_id, question}     -> {answer}     （慢：会真跑代码 / 查库）
     POST /api/report/  {student_id}               -> {student_id, report}（最慢：CrewAI ~20s）
   ============================================================ */
(function () {
  'use strict';

  /* ══════════════ 1. 配置 ══════════════ */

  // 同源部署（Django 直接托管本页）时用相对路径；用 file:// 打开时回落到本机服务
  var API_BASE = location.protocol === 'file:' ? 'http://127.0.0.1:8000' : '';

  var ROUTES = {
    report: { name: '学习报告', icon: 'i-report', soft: '--c-report-soft', color: '--c-report',
              steps: ['查询做题记录', '研究员整理要点', '写手撰写报告'] },
    tool:   { name: '工具调用', icon: 'i-tool',  steps: ['选择工具', '真实执行'] },
    rag:    { name: '知识库',   icon: 'i-book',  steps: ['检索课程文档', '生成回答'] },
    // chat 不给步骤：徽章「普通问答」已经说明了，再挂一条轨迹是冗余噪音
    chat:   { name: '普通问答', icon: 'i-chat',  steps: [] }
  };

  var TIMEOUT = { report: 240000, tool: 150000, rag: 90000, chat: 60000, router: 30000 };
  var STORE = { msgs: 'dsa.msgs.v1', sid: 'dsa.sid.v1', theme: 'dsa.theme.v1', mode: 'dsa.mode.v1' };

  /* ══════════════ 2. 状态 ══════════════ */

  var state = {
    studentId: '1',
    mode: 'auto',
    codeMode: false,
    busy: false,
    students: [],          // 学生名单，来自 /api/students/
    messages: [],          // {id, role, route, text, sources, raw, report, elapsed, error, code}
    seq: 0
  };

  /* ══════════════ 3. DOM ══════════════ */

  var $ = function (id) { return document.getElementById(id); };
  var dom = {};

  function cacheDom() {
    ['transcript', 'input', 'composer', 'composerBox', 'composerHint', 'sendBtn', 'codeToggle',
     'codeExtra', 'stdin', 'stdinToggle', 'modes', 'studentId', 'studentHint', 'quickChips',
     'themeBtn', 'menuBtn', 'sideClose', 'sidebar', 'scrim', 'clearBtn', 'toasts',
     'conn', 'connText', 'stats', 'statTotal', 'statAvg', 'routeBars', 'topbarSub', 'app',
     'studentSwitch', 'studentName', 'studentDialog', 'studentDialogClose', 'studentList',
     'studentIdInput', 'studentAddForm', 'newStudentName', 'studentAddBtn'
    ].forEach(function (k) { dom[k] = $(k); });
  }

  /* ══════════════ 4. 小工具 ══════════════ */

  function el(html) {
    var t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function ico(name) { return '<svg viewBox="0 0 24 24"><use href="#' + name + '"/></svg>'; }

  function fmtSec(ms) {
    var s = ms / 1000;
    return s < 10 ? s.toFixed(1) + 's' : Math.round(s) + 's';
  }

  function nowClock() {
    var d = new Date();
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function reduceMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /* Toast */
  function toast(msg, kind) {
    var node = el('<div class="toast" data-kind="' + (kind || 'ok') + '">' +
      ico(kind === 'err' ? 'i-alert' : 'i-check') + '<span>' + esc(msg) + '</span></div>');
    dom.toasts.appendChild(node);
    setTimeout(function () {
      node.setAttribute('data-leaving', '1');
      setTimeout(function () { node.remove(); }, 260);
    }, 2100);
  }

  /* 剪贴板：navigator.clipboard 在非安全上下文不可用，回落到 execCommand */
  function copyText(text) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-2000px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      return ok;
    }
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; },
        function () { return fallback(); });
    }
    return Promise.resolve(fallback());
  }

  /* ══════════════ 5. 持久化 ══════════════ */

  function save() {
    try {
      localStorage.setItem(STORE.msgs, JSON.stringify(state.messages.slice(-40)));
      localStorage.setItem(STORE.sid, state.studentId);
      localStorage.setItem(STORE.mode, state.mode);
    } catch (e) { /* 隐私模式下忽略 */ }
  }

  function load() {
    try {
      var m = JSON.parse(localStorage.getItem(STORE.msgs) || '[]');
      if (Array.isArray(m)) state.messages = m;
      var s = localStorage.getItem(STORE.sid);
      if (s != null && s !== '') state.studentId = s;
      var md = localStorage.getItem(STORE.mode);
      if (md && (ROUTES[md] || md === 'auto')) state.mode = md;
    } catch (e) { /* 忽略损坏数据 */ }
  }

  /* ══════════════ 6. 后端调用 ══════════════ */

  function ApiError(message, detail) {
    this.name = 'ApiError';
    this.message = message;
    this.detail = detail || '';
  }
  ApiError.prototype = Object.create(Error.prototype);

  function apiPost(path, data, timeout) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, timeout || 90000);

    var body = new URLSearchParams();
    Object.keys(data).forEach(function (k) {
      if (data[k] !== undefined && data[k] !== null) body.append(k, data[k]);
    });

    setConn('busy', '请求中');

    return fetch(API_BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: body.toString(),
      signal: ctrl.signal
    }).then(function (res) {
      return res.text().then(function (text) {
        var json = null;
        try { json = JSON.parse(text); } catch (e) { /* 下面统一报错 */ }

        if (!res.ok) {
          // Django 出错时会返回 HTML 错误页，截取标题给用户一点线索
          var hint = json ? JSON.stringify(json).slice(0, 200)
                          : text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
          throw new ApiError('后端返回 HTTP ' + res.status, hint);
        }
        if (json === null) {
          throw new ApiError('返回内容不是合法 JSON', text.slice(0, 200));
        }
        setConn('ok', '已连接');
        return json;
      });
    }).catch(function (err) {
      if (err && err.name === 'AbortError') {
        throw new ApiError('请求超时', '后端处理时间超过 ' + Math.round((timeout || 90000) / 1000) + ' 秒');
      }
      if (err instanceof ApiError) { setConn('err', '出错'); throw err; }
      setConn('err', '未连接');
      throw new ApiError('无法连接后端', '请确认 Django 服务已启动（manage.py runserver）后重试');
    }).finally(function () {
      clearTimeout(timer);
    });
  }

  function apiGet(path, timeout) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, timeout || 15000);

    return fetch(API_BASE + path, { signal: ctrl.signal })
      .then(function (res) { return res.json(); })
      .catch(function (err) {
        if (err && err.name === 'AbortError') throw new ApiError('请求超时', '学生名单加载超过 ' + Math.round((timeout || 15000) / 1000) + ' 秒');
        throw new ApiError('学生名单加载失败', '请确认后端在运行');
      })
      .finally(function () { clearTimeout(timer); });
  }

  function setConn(stateName, text) {
    dom.conn.setAttribute('data-state', stateName);
    dom.connText.textContent = text;
  }

  /* ══════════════ 7. 渲染 ══════════════ */

  function scrollDown(force) {
    var t = dom.transcript;
    var near = t.scrollHeight - t.scrollTop - t.clientHeight < 180;
    if (!near && !force) return;
    requestAnimationFrame(function () {
      t.scrollTo({ top: t.scrollHeight, behavior: reduceMotion() ? 'auto' : 'smooth' });
    });
  }

  function welcome() {
    return el(
      '<div class="welcome">' +
        '<h2>你好，我是<em>数据结构与算法</em>课程助教</h2>' +
        '<p>直接提问就行——系统会先判断你的意图，再自动选择最合适的回答方式：' +
          '查课程知识库、调用真实工具（跑代码 / 查做题记录 / 问时间 / 查百科），' +
          '或者用 CrewAI 生成一份真实数据的学习报告。</p>' +
        '<div class="cards">' +
          card('rag',    'i-book',   '知识库检索问答', '基于课程文档切分 + Embedding + 向量检索，并返回来源文件名与原文片段。') +
          card('tool',   'i-tool',   '真实工具调用',   '在线运行 Python 代码并判题、查库里的做题记录与掌握度、取系统时间、查百科词条。') +
          card('report', 'i-report', 'CrewAI 学习报告', '研究员整理真实做题数据，写手据此写 Markdown 报告，数字与数据库一致。') +
          card('chat',   'i-chat',   '普通大模型问答', '课程内的概念讲解与闲聊，不需要外部资料时直接回答。') +
        '</div>' +
      '</div>'
    );
  }

  function card(route, icon, title, desc) {
    return '<div class="card" data-route="' + route + '">' +
             '<span class="card-ic">' + ico(icon) + '</span>' +
             '<b>' + esc(title) + '</b><small>' + esc(desc) + '</small>' +
           '</div>';
  }

  function renderAll() {
    dom.transcript.innerHTML = '';
    var stream = el('<div class="stream"></div>');
    if (!state.messages.length) {
      // 欢迎屏也要放进 .stream：否则它会绕开 812px 的内容列宽，
      // 左边缘贴死侧栏，与下方输入框对不齐。
      stream.appendChild(welcome());
    } else {
      state.messages.forEach(function (m) { stream.appendChild(messageNode(m)); });
    }
    dom.transcript.appendChild(stream);
    renderStats();
  }

  function messageNode(m) {
    return m.role === 'user' ? userNode(m) : aiNode(m);
  }

  function userNode(m) {
    var wrap = el('<div class="msg msg-user"></div>');
    var bubble = el('<div class="bubble"></div>');
    bubble.textContent = m.text;
    wrap.appendChild(bubble);
    return wrap;
  }

  function aiNode(m) {
    var route = m.route && ROUTES[m.route] ? m.route : null;
    var node = el('<article class="msg msg-ai"' + (route ? ' data-route="' + route + '"' : '') + '></article>');

    // 头部
    var head = el('<div class="msg-head"></div>');
    if (route) head.appendChild(routeBadge(route));

    var trace = el('<span class="trace"></span>');
    (m.trace || []).forEach(function (s, i) {
      if (i) trace.appendChild(el('<span class="arrow">→</span>'));
      trace.appendChild(el('<span class="step" data-state="' + (s.state || 'done') + '">' + esc(s.label) + '</span>'));
    });
    head.appendChild(trace);

    var meta = el('<span class="meta"></span>');
    if (m.elapsed) {
      meta.appendChild(el('<span class="lat">' + ico('i-clock') + '<span class="lat-txt">' + fmtSec(m.elapsed) + '</span></span>'));
    }
    meta.appendChild(el('<span class="lat">' + esc(m.clock || '') + '</span>'));
    head.appendChild(meta);

    var tools = el('<span class="msg-tools"></span>');
    if (m.text || m.report) tools.appendChild(miniBtn('i-copy', '复制', 'data-copy-answer'));
    if (m.report) tools.appendChild(miniBtn('i-download', '导出', 'data-export-report'));
    if (m.raw) tools.appendChild(miniBtn('i-raw', '原始', 'data-toggle-raw'));
    head.appendChild(tools);
    node.appendChild(head);

    // 错误
    if (m.error) {
      node.classList.add('msg-err');
      node.appendChild(el(
        '<div class="notice">' + ico('i-alert') + '<div><b>' + esc(m.error.title) + '</b>' +
        esc(m.error.detail || '') +
        (m.error.hint ? '<br><code>' + esc(m.error.hint) + '</code>' : '') +
        (m.error.retry ? '<br><button class="mini-btn" type="button" data-retry>重试</button>' : '') +
        '</div></div>'
      ));
    }

    // 正文
    if (m.text) {
      var body = el('<div class="msg-body md"></div>');
      body.innerHTML = Markdown.render(m.text);
      node.appendChild(body);
    }

    // RAG 来源
    if (m.sources && m.sources.length) node.appendChild(sourcesNode(m.sources));

    // 报告导出条
    if (m.report) {
      node.appendChild(el(
        '<div class="report-bar"><span class="grow"></span>' +
        '<button class="mini-btn" type="button" data-export-report>' + ico('i-download') + '<span>导出 .md</span></button>' +
        '<button class="mini-btn" type="button" data-copy-answer>' + ico('i-copy') + '<span>复制全文</span></button>' +
        '</div>'
      ));
    }

    // 原始 JSON
    if (m.raw) {
      var raw = el('<pre class="raw" hidden></pre>');
      raw.textContent = JSON.stringify(m.raw, null, 2);
      node.appendChild(raw);
    }
    return node;
  }

  function miniBtn(icon, label, attr) {
    return el('<button class="mini-btn" type="button" ' + attr + '>' + ico(icon) +
              '<span>' + esc(label) + '</span></button>');
  }

  function routeBadge(route) {
    var r = ROUTES[route];
    return el('<span class="badge">' + ico(r.icon) + '<span>' + esc(r.name) + '</span></span>');
  }

  function sourcesNode(sources) {
    var wrap = el('<div class="sources"></div>');
    var head = el(
      '<button class="src-head" type="button" aria-expanded="true">' + ico('i-book') +
      '<span>引用来源</span><span class="pill">' + sources.length + '</span>' +
      '<svg class="caret" viewBox="0 0 24 24"><use href="#i-chevron"/></svg>' +
      '</button>'
    );
    var list = el('<div class="src-list"></div>');

    sources.forEach(function (s, i) {
      var file = s.file || '未知来源';
      var chunk = (s.chunk_id === 0 || s.chunk_id) ? '第 ' + s.chunk_id + ' 段' : '';
      var snippet = s.snippet || '';
      var long = snippet.length > 150;
      var item = el(
        '<div class="src">' +
          '<div class="src-top"><span class="idx">' + (i + 1) + '</span>' +
            '<span class="file">' + esc(file) + '</span>' +
            (chunk ? '<span>· ' + esc(chunk) + '</span>' : '') +
          '</div>' +
          '<p class="src-snippet"></p>' +
        '</div>'
      );
      item.querySelector('.src-snippet').textContent = snippet;
      if (long) {
        var more = el('<button class="src-more" type="button">展开全文</button>');
        more.addEventListener('click', function () {
          var open = item.getAttribute('data-open') === '1';
          item.setAttribute('data-open', open ? '0' : '1');
          more.textContent = open ? '展开全文' : '收起';
        });
        item.appendChild(more);
      }
      list.appendChild(item);
    });

    head.addEventListener('click', function () {
      var open = head.getAttribute('aria-expanded') === 'true';
      head.setAttribute('aria-expanded', String(!open));
      list.hidden = open;
    });

    wrap.appendChild(head);
    wrap.appendChild(list);
    return wrap;
  }

  /* 思考中占位 */
  function thinkingNode(label) {
    return el('<div class="thinking"><span class="dots"><i></i><i></i><i></i></span>' +
              '<span class="think-label">' + esc(label) + '</span></div>');
  }

  /* 长时间任务（报告）进度 */
  function progressNode(steps) {
    var node = el(
      '<div class="progress">' +
        '<div class="progress-top"><b>报告生成中…</b>' +
          '<span>研究员正在整理数据，写手随后撰写</span>' +
          '<span class="el">0.0s</span></div>' +
        '<div class="progress-track"></div>' +
        '<div class="progress-steps">' +
          steps.map(function (s) { return '<span data-on="1">' + esc(s) + '</span>'; }).join('') +
        '</div>' +
      '</div>'
    );
    var el0 = node.querySelector('.el');
    var t0 = Date.now();
    var timer = setInterval(function () {
      el0.textContent = ((Date.now() - t0) / 1000).toFixed(1) + 's';
    }, 100);
    node._stop = function () { clearInterval(timer); };
    return node;
  }

  /* ══════════════ 8. 统计 ══════════════ */

  function renderStats() {
    var counts = { report: 0, tool: 0, rag: 0, chat: 0 };
    var asked = 0, done = 0, sum = 0;

    state.messages.forEach(function (m) {
      if (m.role === 'user') { asked++; return; }
      if (m.role !== 'ai') return;
      if (m.elapsed) { done++; sum += m.elapsed; }
      if (m.route && counts[m.route] != null) counts[m.route]++;
    });

    dom.statTotal.textContent = String(asked);
    dom.statAvg.textContent = done ? fmtSec(sum / done) : '—';

    var max = Math.max(1, counts.report, counts.tool, counts.rag, counts.chat);
    dom.routeBars.innerHTML = ['report', 'tool', 'rag', 'chat'].map(function (r) {
      var n = counts[r];
      return '<div class="rbar" data-route="' + r + '">' +
               '<span>' + esc(ROUTES[r].name.slice(0, 2)) + '</span>' +
               '<span class="track"><span class="fill" style="transform:scaleX(' + (n / max).toFixed(3) + ')"></span></span>' +
               '<b>' + n + '</b>' +
             '</div>';
    }).join('');
  }

  /* ══════════════ 9. 发送流程 ══════════════ */

  function currentStudentId() {
    return String(state.studentId || '').trim();
  }

  function addMessage(msg) {
    state.messages.push(msg);
    save();
    renderStats();
    return msg;
  }

  function pushUser(text) {
    if (dom.transcript.querySelector('.welcome')) dom.transcript.innerHTML = '';
    var m = { id: 'u' + (++state.seq), role: 'user', text: text, clock: nowClock() };
    addMessage(m);
    var stream = dom.transcript.querySelector('.stream');
    if (!stream) {
      stream = el('<div class="stream"></div>');
      dom.transcript.appendChild(stream);
    }
    stream.appendChild(userNode(m));
    scrollDown(true);
    return stream;
  }

  function pushAi(partial) {
    var stream = dom.transcript.querySelector('.stream');
    if (!stream) {
      stream = el('<div class="stream"></div>');
      dom.transcript.appendChild(stream);
    }
    var m = Object.assign({ id: 'a' + (++state.seq), role: 'ai', clock: nowClock() }, partial);
    // 必须先入 state 再渲染：stream 的子节点顺序与 state.messages 一一对应，
    // findModel() 依赖这个对齐关系来定位"这条气泡属于哪条消息"。
    addMessage(m);
    var node = aiNode(m);
    // 用一个临时占位容器，等结果回来再整体替换，保证 DOM 与状态一致
    node.setAttribute('data-pending', '1');
    stream.appendChild(node);
    scrollDown(true);
    return { model: m, node: node, stream: stream };
  }

  function finalize(handle, patch) {
    Object.assign(handle.model, patch);
    var fresh = aiNode(handle.model);
    handle.node.replaceWith(fresh);
    save();
    renderStats();
    scrollDown();
    return fresh;
  }

  /* 替换占位节点并返回新节点（保持引用可用于后续再次替换） */
  function swap(oldNode, newNode) {
    oldNode.replaceWith(newNode);
    return newNode;
  }

  function setBusy(on) {
    state.busy = on;
    dom.sendBtn.disabled = on;
    if (!on) setConn('ok', '已连接');
  }

  function send(text, forcedMode) {
    if (state.busy) return;
    var mode = forcedMode || state.mode;

    if (mode === 'report' && !currentStudentId()) {
      toast('生成报告需要学号', 'err');
      openStudentDialog();
      return;
    }

    pushUser(text);
    var handle = pushAi({ route: mode === 'auto' ? null : mode, trace: [] });
    var placeholder = thinkingNode(mode === 'auto' ? '正在判断意图…' : '正在处理…');
    handle.node.appendChild(placeholder);

    setBusy(true);
    var t0 = performance.now();

    resolveRoute(mode, text)
      .then(function (route) {
        // 路由确定 → 更新徽章与轨迹
        handle.model.route = route;
        handle.node.setAttribute('data-route', route);
        var head = handle.node.querySelector('.msg-head');
        if (head && !head.querySelector('.badge')) head.insertBefore(routeBadge(route), head.firstChild);

        var trace = handle.node.querySelector('.trace');
        if (trace) trace.innerHTML = traceHtml(mode === 'auto' ? '判断意图' : null, route, true);

        // 报告是长任务，换成带计时器的进度条
        if (route === 'report') {
          placeholder = swap(placeholder, progressNode(ROUTES.report.steps));
        } else {
          placeholder = swap(placeholder, thinkingNode(ROUTES[route].steps[0] + '…'));
        }
        scrollDown();

        return dispatch(route, text);
      })
      .then(function (json) {
        var elapsed = performance.now() - t0;
        var route = handle.model.route;
        var patch = { elapsed: elapsed, raw: json };

        if (route === 'rag') {
          patch.text = json.answer || '（后端没有返回 answer 字段）';
          patch.sources = Array.isArray(json.sources) ? json.sources : [];
        } else if (route === 'report') {
          patch.text = json.report || '（后端没有返回 report 字段）';
          patch.report = json.report || '';
          patch.studentId = json.student_id;
        } else {
          patch.text = json.answer || '（后端没有返回 answer 字段）';
        }

        patch.trace = traceSteps(mode === 'auto' ? '判断意图' : null, route);

        if (placeholder._stop) placeholder._stop();
        finalize(handle, patch);
        setBusy(false);
      })
      .catch(function (err) {
        if (placeholder._stop) placeholder._stop();
        var msg = err instanceof ApiError ? err : new ApiError('未知错误', String(err && err.message || err));
        if (handle.model.route === 'report' && msg.message === '无法连接后端') {
          msg.detail = '报告生成需要后端在运行（CrewAI 跑在两个 Agent 上，比较慢）。';
        }
        finalize(handle, {
          elapsed: performance.now() - t0,
          error: {
            title: msg.message,
            detail: msg.detail,
            hint: msg.detail && msg.message === '后端返回 HTTP 500' ? msg.detail : '',
            retry: true
          },
          trace: traceSteps(mode === 'auto' ? '判断意图' : null, handle.model.route)
        });
        setBusy(false);
      });
  }

  /* 轨迹步骤：加载中与完成后必须是同一批标签，否则答案落地时内容会"跳变"。
     live=true 表示后段流水线还在跑。 */
  function traceSteps(via, route, live) {
    var steps = [];
    if (via) steps.push({ label: via, state: 'done' });
    if (route && ROUTES[route]) {
      ROUTES[route].steps.forEach(function (s) {
        steps.push({ label: s, state: live ? 'run' : 'done' });
      });
    }
    return steps;
  }

  function traceHtml(via, route, live) {
    return traceSteps(via, route, live).map(function (s) {
      return '<span class="step" data-state="' + s.state + '">' + esc(s.label) + '</span>';
    }).join('<span class="arrow">→</span>');
  }

  function resolveRoute(mode, text) {
    if (mode !== 'auto') return Promise.resolve(mode);
    return apiPost('/api/router/', { question: text }, TIMEOUT.router).then(function (json) {
      var label = String(json.label || '').trim().toLowerCase();
      if (!ROUTES[label]) {
        throw new ApiError('意图判断返回了未知标签', 'label = ' + JSON.stringify(json.label));
      }
      return label;
    });
  }

  function dispatch(route, text) {
    var sid = currentStudentId();
    if (route === 'report') {
      return apiPost('/api/report/', { student_id: sid }, TIMEOUT.report);
    }
    if (route === 'tool') {
      return apiPost('/api/agent/', { student_id: sid, question: text }, TIMEOUT.tool);
    }
    if (route === 'rag') {
      return apiPost('/api/rag/', { question: text }, TIMEOUT.rag);
    }
    return apiPost('/api/chat/', { question: text }, TIMEOUT.chat);
  }

  /* ══════════════ 10. 输入区 ══════════════ */

  function autoGrow() {
    var t = dom.input;
    t.style.height = 'auto';
    t.style.height = Math.min(t.scrollHeight, 220) + 'px';
  }

  function setMode(mode) {
    state.mode = mode;
    save();
    Array.prototype.forEach.call(dom.modes.querySelectorAll('.mode'), function (b) {
      var on = b.getAttribute('data-mode') === mode;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', String(on));
    });
    var subs = {
      auto: '提问即可，系统自动选择回答方式',
      rag: '只查课程知识库，回答会附上来源片段',
      tool: '调用真实工具：跑代码 / 查做题记录 / 问时间 / 查百科',
      chat: '普通问答，不查库也不跑代码',
      report: 'CrewAI 用真实做题数据生成 Markdown 学习报告'
    };
    dom.topbarSub.textContent = subs[mode] || subs.auto;
    dom.composerHint.textContent = state.codeMode
      ? 'Ctrl/⌘ + Enter 发送'
      : (mode === 'report' ? 'Enter 生成 · 约 20 秒' : 'Enter 发送 · Shift+Enter 换行');
  }

  function setCodeMode(on) {
    state.codeMode = on;
    dom.composerBox.setAttribute('data-code', String(on));
    dom.codeExtra.hidden = !on;
    dom.codeToggle.setAttribute('aria-pressed', String(on));
    dom.input.placeholder = on
      ? '# 在这里粘贴你的 Python 代码\n# 会真实运行 → 判题 → 自动写入错题本'
      : '问点什么…\n例如：队列的入队和出队时间复杂度是多少？';
    if (on && (state.mode === 'chat' || state.mode === 'rag' || state.mode === 'report')) setMode('tool');
    if (!on) { dom.stdin.hidden = true; dom.stdinToggle.setAttribute('aria-pressed', 'false'); }
    setMode(state.mode);
    autoGrow();
    dom.input.focus();
  }

  function buildCodeQuestion(code, stdin) {
    var q = '请帮我运行、判题并分析下面这段 Python 代码：\n\n```python\n' + code + '\n```';
    if (stdin && stdin.trim()) {
      q += '\n\n标准输入（stdin）是：\n```\n' + stdin.replace(/\n$/, '') + '\n```';
    }
    return q;
  }

  function submit() {
    var raw = dom.input.value;
    if (!raw.trim() || state.busy) return;

    var text = raw;
    if (state.codeMode) {
      text = buildCodeQuestion(raw.replace(/\s+$/, ''), dom.stdin.value);
    }
    dom.input.value = '';
    if (state.codeMode) dom.stdin.value = '';
    autoGrow();
    send(text);
  }

  /* ══════════════ 11. 事件绑定 ══════════════ */

  function onTranscriptClick(e) {
    var btn = e.target.closest('button');
    if (!btn) {
      // 代码块内的复制按钮
      var codeBtn = e.target.closest('[data-copy-code]');
      if (codeBtn) { handleCopyCode(codeBtn); }
      return;
    }
    var article = btn.closest('.msg-ai');

    if (btn.hasAttribute('data-copy-code')) return handleCopyCode(btn);

    if (btn.hasAttribute('data-copy-answer') && article) {
      var m = findModel(article);
      if (!m) return;
      copyText(m.report || m.text || '').then(function (ok) {
        toast(ok ? '已复制到剪贴板' : '复制失败，请手动选择', ok ? 'ok' : 'err');
      });
      return;
    }

    if (btn.hasAttribute('data-export-report') && article) {
      var mm = findModel(article);
      if (mm && mm.report) exportReport(mm);
      return;
    }

    if (btn.hasAttribute('data-toggle-raw') && article) {
      var raw = article.querySelector('.raw');
      if (raw) {
        raw.hidden = !raw.hidden;
        btn.setAttribute('aria-pressed', String(!raw.hidden));
      }
      return;
    }

    if (btn.hasAttribute('data-retry')) {
      var last = null;
      for (var i = state.messages.length - 1; i >= 0; i--) {
        if (state.messages[i].role === 'user') { last = state.messages[i]; break; }
      }
      if (last) {
        // 复用同一条提问重发，不再重复插入用户气泡
        var mode = state.mode;
        var handle = pushAi({ route: mode === 'auto' ? null : mode });
        handle.node.appendChild(thinkingNode('正在重试…'));
        setBusy(true);
        var t0 = performance.now();
        resolveRoute(mode, last.text).then(function (route) {
          handle.model.route = route;
          handle.node.setAttribute('data-route', route);
          var head = handle.node.querySelector('.msg-head');
          if (head && !head.querySelector('.badge')) head.insertBefore(routeBadge(route), head.firstChild);
          return dispatch(route, last.text).then(function (json) {
            var patch = { elapsed: performance.now() - t0, raw: json, trace: traceSteps(mode === 'auto' ? '判断意图' : null, route) };
            if (route === 'rag') { patch.text = json.answer || ''; patch.sources = json.sources || []; }
            else if (route === 'report') { patch.text = json.report || ''; patch.report = json.report || ''; }
            else patch.text = json.answer || '';
            finalize(handle, patch);
            setBusy(false);
          });
        }).catch(function (err) {
          finalize(handle, {
            elapsed: performance.now() - t0,
            error: { title: err.message || '请求失败', detail: err.detail || '', retry: true },
            trace: traceSteps(null, handle.model.route)
          });
          setBusy(false);
        });
      }
    }
  }

  function handleCopyCode(btn) {
    var block = btn.closest('.code-block');
    var code = block && block.querySelector('code');
    if (!code) return;
    copyText(code.textContent).then(function (ok) {
      toast(ok ? '代码已复制' : '复制失败', ok ? 'ok' : 'err');
    });
  }

  // 事件委托下无法直接拿到状态对象，用节点顺序对齐 state.messages
  function findModel(article) {
    var stream = article.parentElement;
    var idx = Array.prototype.indexOf.call(stream.children, article);
    if (idx < 0) return null;
    // stream 里的节点与 state.messages 一一对应，但 stream 只包含已渲染消息
    return state.messages[idx] || null;
  }

  /* ══════════════ 11. 学生名单与切换 ══════════════ */

  function findStudent() {
    var id = currentStudentId();
    for (var i = 0; i < state.students.length; i++) {
      if (String(state.students[i].id) === String(id)) return state.students[i];
    }
    return null;
  }

  function applyStudent() {
    var id = currentStudentId();
    var s = findStudent();
    dom.studentName.textContent = s ? (s.name || '未命名学生') : (id ? '学号 ' + id : '未选择学生');
    if (!id) {
      dom.studentHint.textContent = '还没填学号，查库、入库和报告都会拦下来';
    } else if (s) {
      dom.studentHint.textContent = '学号 ' + id + ' · 点这里切换';
    } else {
      dom.studentHint.textContent = '学号 ' + id + ' 不在名单里';
    }
    dom.studentIdInput.value = id;
  }

  function renderStudentList() {
    if (!state.students.length) {
      dom.studentList.innerHTML = '<li class="student-empty">名单还是空的，在下面添加第一个学生</li>';
      return;
    }
    var id = currentStudentId();
    dom.studentList.innerHTML = state.students.map(function (s) {
      var on = String(s.id) === String(id);
      return '<li>' +
        '<button class="student-item" type="button" data-student-id="' + esc(String(s.id)) + '"' +
        ' aria-current="' + (on ? 'true' : 'false') + '">' +
          '<span class="student-item-avatar">' + ico('i-user') + '</span>' +
          '<span class="student-item-name">' + esc(s.name || '未命名学生') + '</span>' +
          '<span class="student-item-id">学号 ' + esc(String(s.id)) + '</span>' +
          '<span class="student-item-check">' + ico('i-check') + '</span>' +
        '</button></li>';
    }).join('');
  }

  function loadStudents(silent) {
    return apiGet('/api/students/').then(function (json) {
      state.students = Array.isArray(json.students) ? json.students : [];
      renderStudentList();
      applyStudent();
      return state.students;
    }).catch(function (err) {
      if (!silent) toast(err.message, 'err');
      return state.students;
    });
  }

  function switchStudent(id) {
    var s = null;
    for (var i = 0; i < state.students.length; i++) {
      if (String(state.students[i].id) === String(id)) { s = state.students[i]; break; }
    }
    if (!s) return;
    state.studentId = String(s.id);
    save();
    renderStudentList();
    applyStudent();
    renderStats();
    closeStudentDialog();
    toast('已切换到 ' + (s.name || '学号 ' + s.id));
  }

  function addStudent() {
    var name = (dom.newStudentName.value || '').trim();
    if (!name) { dom.newStudentName.focus(); return; }
    dom.studentAddBtn.disabled = true;
    apiPost('/api/students/', { name: name }, TIMEOUT.router).then(function (json) {
      state.students = Array.isArray(json.students) ? json.students : [];
      dom.newStudentName.value = '';
      renderStudentList();
      if (json.student) switchStudent(json.student.id);
    }).catch(function (err) {
      toast(err.message, 'err');
    }).finally(function () {
      dom.studentAddBtn.disabled = false;
    });
  }

  function openStudentDialog() {
    if (!dom.studentDialog || dom.studentDialog.open) return;
    dom.studentDialog.removeAttribute('data-leaving');
    renderStudentList();
    dom.studentDialog.showModal();
    dom.studentSwitch.setAttribute('aria-expanded', 'true');
    loadStudents(true);
    setTimeout(function () { dom.studentIdInput.focus(); dom.studentIdInput.select(); }, 60);
  }

  function closeStudentDialog() {
    if (!dom.studentDialog || !dom.studentDialog.open) return;
    dom.studentSwitch.setAttribute('aria-expanded', 'false');
    if (reduceMotion()) { dom.studentDialog.close(); return; }
    dom.studentDialog.setAttribute('data-leaving', '1');
    setTimeout(function () {
      dom.studentDialog.close();
      dom.studentDialog.removeAttribute('data-leaving');
    }, 150);
  }

  function exportReport(m) {
    var sid = m.studentId != null ? m.studentId : currentStudentId();
    var head = '# 数据结构与算法 学习报告\n\n' +
               '- 学号：' + sid + '\n' +
               '- 生成时间：' + new Date().toLocaleString('zh-CN') + '\n\n---\n\n';
    var blob = new Blob([head + (m.report || '')], { type: 'text/markdown;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = '学习报告-' + sid + '-' + new Date().toISOString().slice(0, 10) + '.md';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('报告已导出');
  }

  function bind() {
    dom.transcript.addEventListener('click', onTranscriptClick);

    dom.composer.addEventListener('submit', function (e) { e.preventDefault(); submit(); });

    dom.input.addEventListener('input', autoGrow);
    dom.input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        // 代码模式下 Enter 应该换行，只有 Ctrl/⌘+Enter 才发送
        if (state.codeMode && !(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        submit();
      }
    });

    dom.codeToggle.addEventListener('click', function () {
      setCodeMode(dom.codeToggle.getAttribute('aria-pressed') !== 'true');
    });

    dom.stdinToggle.addEventListener('click', function () {
      var open = dom.stdin.hidden;
      dom.stdin.hidden = !open;
      dom.stdinToggle.setAttribute('aria-pressed', String(open));
      if (open) dom.stdin.focus();
    });

    dom.modes.addEventListener('click', function (e) {
      var b = e.target.closest('.mode');
      if (b) setMode(b.getAttribute('data-mode'));
    });

    dom.quickChips.addEventListener('click', function (e) {
      var chip = e.target.closest('.chip');
      if (!chip || state.busy) return;
      var route = chip.getAttribute('data-route');
      // 快捷提问固定走它标注的那条路，方便演示四路分流
      if (route === 'report') setMode('report'); else setMode('auto');
      send(chip.getAttribute('data-q'), route);
    });

    dom.studentIdInput.addEventListener('input', function () {
      state.studentId = dom.studentIdInput.value;
      save();
      applyStudent();
      renderStudentList();
    });

    // 手输一个不在名单里的学号也能直接用：回车确认
    dom.studentIdInput.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      var id = (dom.studentIdInput.value || '').trim();
      if (!id) return;
      if (findStudent()) switchStudent(id);
      else { closeStudentDialog(); toast('已切到学号 ' + id + '（不在名单里）'); }
    });

    dom.studentSwitch.addEventListener('click', openStudentDialog);
    dom.studentDialogClose.addEventListener('click', closeStudentDialog);
    dom.studentDialog.addEventListener('close', function () {
      dom.studentSwitch.setAttribute('aria-expanded', 'false');
    });
    dom.studentDialog.addEventListener('click', function (e) {
      if (e.target === dom.studentDialog) closeStudentDialog();
    });
    dom.studentList.addEventListener('click', function (e) {
      var item = e.target.closest('.student-item');
      if (item) switchStudent(item.getAttribute('data-student-id'));
    });
    dom.studentAddForm.addEventListener('submit', function (e) {
      e.preventDefault();
      addStudent();
    });

    dom.clearBtn.addEventListener('click', function () {
      if (!state.messages.length) return;
      state.messages = [];
      save();
      renderAll();
      dom.transcript.scrollTop = 0;
      toast('对话已清空');
    });

    // 主题
    dom.themeBtn.addEventListener('click', function () {
      var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      try { localStorage.setItem(STORE.theme, next); } catch (e) {}
    });

    // 移动端抽屉
    function openSide(on) {
      dom.sidebar.setAttribute('data-open', on ? '1' : '0');
      if (on) {
        dom.scrim.hidden = false;
        requestAnimationFrame(function () { dom.scrim.removeAttribute('data-leaving'); });
      } else {
        dom.scrim.setAttribute('data-leaving', '1');
        setTimeout(function () { dom.scrim.hidden = true; dom.scrim.removeAttribute('data-leaving'); }, 260);
      }
    }
    dom.menuBtn.addEventListener('click', function () { openSide(true); });
    dom.sideClose.addEventListener('click', function () { openSide(false); });
    dom.scrim.addEventListener('click', function () { openSide(false); });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && dom.sidebar.getAttribute('data-open') === '1') openSide(false);
      // Ctrl/⌘+K 聚焦输入框（键盘高频操作，不加动画）
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        dom.input.focus();
      }
    });
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    meta.content = theme === 'dark' ? '#0a0c0f' : '#f5f6f8';
  }

  /* ══════════════ 12. 启动 ══════════════ */

  function init() {
    cacheDom();
    load();

    try {
      var saved = localStorage.getItem(STORE.theme);
      applyTheme(saved || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
    } catch (e) { applyTheme('light'); }

    applyStudent();
    setMode(state.mode);
    renderAll();
    bind();
    autoGrow();
    loadStudents(true);

    // 后端连通性探针：走轻量健康检查，不消耗大模型调用
    apiPost('/api/health/', {}, 8000)
      .then(function () { setConn('ok', '已连接'); })
      .catch(function () { setConn('err', '未连接'); });

    dom.input.focus();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
