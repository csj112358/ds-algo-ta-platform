/* ============================================================
   markdown.js — 零依赖 Markdown 渲染器
   为什么要自己写：考核要求不得引入 React/Vue/Node 等技术栈，
   也不适合依赖 CDN（演示环境可能离线），所以手写一个够用的子集：
   标题 / 段落 / 无序有序列表 / 表格 / 引用 / 分隔线 / 围栏代码块 /
   行内代码 / 粗体 / 斜体 / 删除线 / 链接，并附带 Python 语法高亮。

   安全策略：先整体转义 HTML，再做 Markdown 变换，
   因此模型输出里的任何标签都不可能被当成 HTML 执行（防注入）。
   ============================================================ */
(function (global) {
  'use strict';

  /* ---------- 转义 ---------- */
  // 只转义 & < > ：足以阻断标签注入，同时保留引号让代码里的字符串正则仍能工作
  function escCode(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escText(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ---------- URL 白名单 ---------- */
  function safeUrl(url) {
    var u = String(url).trim();
    if (/^(https?:|mailto:|tel:)/i.test(u)) return u;
    if (/^[#/]/.test(u)) return u;
    return '#'; // 拦截 javascript: data: 等
  }

  /* ---------- Python 语法高亮 ---------- */
  var PY_RE = new RegExp([
    '"""[\\s\\S]*?"""',                       // 三引号
    "'''[\\s\\S]*?'''",
    '"(?:[^"\\\\\\n]|\\\\.)*"',               // 双引号串
    "'(?:[^'\\\\\\n]|\\\\.)*'",               // 单引号串
    '#[^\\n]*',                               // 注释
    '\\b(?:False|None|True|and|as|assert|async|await|break|class|continue|def|del|' +
      'elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|' +
      'not|or|pass|raise|return|try|while|with|yield|match|case)\\b',
    '\\bself\\b',
    '\\b\\d+(?:\\.\\d+)?\\b',
    '\\b[A-Za-z_]\\w*(?=\\s*\\()'             // 函数调用
  ].join('|'), 'g');

  function highlight(code) {
    var out = '', last = 0, m;
    PY_RE.lastIndex = 0;
    while ((m = PY_RE.exec(code)) !== null) {
      if (m.index > last) out += code.slice(last, m.index);
      var t = m[0], cls;
      if (t.charAt(0) === '#') cls = 'tok-com';
      else if (t.charAt(0) === '"' || t.charAt(0) === "'") cls = 'tok-str';
      else if (t === 'self') cls = 'tok-self';
      else if (/^\d/.test(t)) cls = 'tok-num';
      else if (/^[A-Za-z_]\w*$/.test(t) && !/^(False|None|True)$/.test(t)) {
        cls = /^(and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield|match|case)$/.test(t)
          ? 'tok-kw' : 'tok-fn';
      } else cls = 'tok-kw';
      out += '<span class="' + cls + '">' + t + '</span>';
      last = m.index + t.length;
    }
    out += code.slice(last);
    return out;
  }

  function isPy(lang) {
    return !lang || /^(py|python|python3)$/i.test(lang);
  }

  /* ---------- 行内元素 ---------- */
  // inlineEsc 的输入必须是「已经转义过」的文本；inline 负责先转义。
  // 之所以拆成两个：段落要把换行先拼成 <br> 再走行内规则，
  // 那一步不能把 <br> 自己给转义掉。
  function inlineEsc(text) {
    var codes = [];
    // 1) 行内代码先摘出来，避免其中内容被后续规则误伤
    var s = text.replace(/`([^`\n]+)`/g, function (_, c) {
      codes.push(c);
      return '\u0000C' + (codes.length - 1) + '\u0000';
    });

    // 2) 链接（图片语法也按链接处理，避免出现破图）
    //    URL 允许一对成对括号，否则 javascript:alert(1) 会漏掉结尾的 )
    s = s.replace(/!?\[([^\]\n]*)\]\(\s*([^\s()]*(?:\([^\s()]*\)[^\s()]*)*)\s*(?:"[^"]*")?\)/g,
      function (_, label, url) {
        return '<a href="' + safeUrl(url) + '" target="_blank" rel="noopener noreferrer">' +
               (label || url) + '</a>';
      });

    // 3) 强调
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    s = s.replace(/(^|[^_\w])_([^_\n]+)_/g, '$1<em>$2</em>');
    s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');

    // 4) 还原行内代码
    s = s.replace(/\u0000C(\d+)\u0000/g, function (_, i) {
      return '<code>' + codes[+i] + '</code>';
    });
    return s;
  }

  function inline(raw) { return inlineEsc(escText(raw)); }

  /* GFM 任务列表：[ ] / [x] → 复选框 */
  function taskBox(text) {
    var m = /^\[([ xX])\]\s+/.exec(text);
    if (!m) return null;
    return { done: m[1].toLowerCase() === 'x', rest: text.slice(m[0].length) };
  }

  /* ---------- 代码块 HTML ---------- */
  function codeBlock(code, lang) {
    var body = escCode(code.replace(/\n+$/, ''));
    var html = isPy(lang) ? highlight(body) : body;
    var label = lang ? escText(lang) : 'text';
    return '<div class="code-block">' +
             '<div class="cb-head">' +
               '<span class="cb-lang">' + label + '</span>' +
               '<button class="mini-btn cb-copy" type="button" data-copy-code>' +
                 '<svg viewBox="0 0 24 24"><use href="#i-copy"/></svg><span>复制</span>' +
               '</button>' +
             '</div>' +
             '<pre><code>' + html + '</code></pre>' +
           '</div>';
  }

  /* ---------- 表格 ---------- */
  function splitRow(row) {
    var r = row.trim().replace(/^\|/, '').replace(/\|$/, '');
    return r.split('|').map(function (c) { return c.trim(); });
  }
  var SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

  function alignOf(sep) {
    return splitRow(sep).map(function (c) {
      var l = c.charAt(0) === ':', r = c.charAt(c.length - 1) === ':';
      if (l && r) return 'center';
      if (r) return 'right';
      if (l) return 'left';
      return '';
    });
  }

  function table(header, sep, rows) {
    var align = alignOf(sep);
    var th = splitRow(header).map(function (c, i) {
      return '<th' + (align[i] ? ' style="text-align:' + align[i] + '"' : '') + '>' + inline(c) + '</th>';
    }).join('');
    var tb = rows.map(function (row) {
      return '<tr>' + splitRow(row).map(function (c, i) {
        return '<td' + (align[i] ? ' style="text-align:' + align[i] + '"' : '') + '>' + inline(c) + '</td>';
      }).join('') + '</tr>';
    }).join('');
    return '<div class="tw"><table><thead><tr>' + th + '</tr></thead><tbody>' + tb + '</tbody></table></div>';
  }

  /* ---------- 块级解析 ---------- */
  var RE_FENCE   = /^\s*(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/;
  var RE_HEAD    = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
  var RE_HR      = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
  var RE_QUOTE   = /^\s{0,3}>\s?(.*)$/;
  var RE_UL      = /^(\s*)([-*+])\s+(.*)$/;
  var RE_OL      = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;

  function render(src) {
    var lines = String(src == null ? '' : src).replace(/\r\n?/g, '\n').split('\n');
    var out = [];
    var i = 0;

    while (i < lines.length) {
      var line = lines[i];

      // 空行
      if (!line.trim()) { i++; continue; }

      // 围栏代码块
      var fence = RE_FENCE.exec(line);
      if (fence) {
        var marker = fence[1].charAt(0);
        var lang = fence[2] || '';
        var buf = [];
        i++;
        while (i < lines.length) {
          var close = RE_FENCE.exec(lines[i]);
          if (close && close[1].charAt(0) === marker) { i++; break; }
          buf.push(lines[i]); i++;
        }
        out.push(codeBlock(buf.join('\n'), lang));
        continue;
      }

      // 标题
      var h = RE_HEAD.exec(line);
      if (h) {
        var lv = h[1].length;
        out.push('<h' + lv + '>' + inline(h[2]) + '</h' + lv + '>');
        i++; continue;
      }

      // 分隔线
      if (RE_HR.test(line)) { out.push('<hr>'); i++; continue; }

      // 引用（连续行合并）
      if (RE_QUOTE.test(line)) {
        var q = [];
        while (i < lines.length && RE_QUOTE.test(lines[i])) {
          q.push(RE_QUOTE.exec(lines[i])[1]); i++;
        }
        out.push('<blockquote>' + render(q.join('\n')) + '</blockquote>');
        continue;
      }

      // 表格：当前行含 | 且下一行是分隔行
      if (line.indexOf('|') !== -1 && i + 1 < lines.length && SEP_RE.test(lines[i + 1]) &&
          lines[i + 1].indexOf('-') !== -1) {
        var head = line, sep = lines[i + 1], body = [];
        i += 2;
        while (i < lines.length && lines[i].trim() && lines[i].indexOf('|') !== -1) {
          body.push(lines[i]); i++;
        }
        out.push(table(head, sep, body));
        continue;
      }

      // 列表（按缩进支持一层嵌套）
      if (RE_UL.test(line) || RE_OL.test(line)) {
        var res = list(lines, i);
        out.push(res.html);
        i = res.next;
        continue;
      }

      // 段落：连续普通行用 <br> 连接（中文语境下比合并成一行更忠实原意）
      var p = [];
      while (i < lines.length && lines[i].trim() &&
             !RE_FENCE.test(lines[i]) && !RE_HEAD.test(lines[i]) &&
             !RE_HR.test(lines[i]) && !RE_QUOTE.test(lines[i]) &&
             !RE_UL.test(lines[i]) && !RE_OL.test(lines[i]) &&
             !(lines[i].indexOf('|') !== -1 && i + 1 < lines.length &&
               SEP_RE.test(lines[i + 1]) && lines[i + 1].indexOf('-') !== -1)) {
        p.push(lines[i]); i++;
      }
      if (p.length) out.push('<p>' + inlineEsc(p.map(escText).join('<br>')) + '</p>');
      else i++; // 兜底防死循环
    }
    return out.join('\n');
  }

  /* 列表解析：同一缩进层级归为一组，更深缩进作为嵌套 */
  function list(lines, start) {
    var first = (RE_UL.exec(lines[start]) || RE_OL.exec(lines[start]));
    var ordered = RE_OL.test(lines[start]);
    var baseIndent = first[1].length;
    var items = [];
    var i = start;

    while (i < lines.length) {
      var m = RE_UL.exec(lines[i]) || RE_OL.exec(lines[i]);
      if (!m) {
        // 列表项的续行（缩进对齐的普通文本）
        if (lines[i].trim() && items.length && /^\s{2,}/.test(lines[i]) &&
            !RE_UL.test(lines[i]) && !RE_OL.test(lines[i])) {
          items[items.length - 1].text += '<br>' + inline(lines[i].trim());
          i++; continue;
        }
        break;
      }
      var indent = m[1].length;
      if (indent < baseIndent) break;
      if (indent > baseIndent) {
        // 嵌套：递归
        var sub = list(lines, i);
        items[items.length - 1].text += sub.html;
        i = sub.next;
        continue;
      }
      if (RE_OL.test(lines[i]) !== ordered) break;
      items.push({ text: inline(m[3]), box: taskBox(m[3]) });
      i++;
    }

    var tag = ordered ? 'ol' : 'ul';
    var html = '<' + tag + '>' + items.map(function (it) {
      var inner = it.text;
      if (it.box) {
        inner = '<span class="task' + (it.box.done ? ' is-done' : '') + '"></span>' +
                inline(it.box.rest);
      }
      return '<li>' + inner + '</li>';
    }).join('') + '</' + tag + '>';
    return { html: html, next: i };
  }

  global.Markdown = {
    render: render,
    inline: inline,
    escape: escText,
    highlight: function (code) { return highlight(escCode(code)); }
  };
})(window);
