// Small, safe markdown -> DOM renderer for agent messages. No dependencies,
// no innerHTML on untrusted content: every piece of message text becomes a
// text node. Covers what coding agents actually emit: paragraphs, headings,
// fenced code, inline code, bold/italic/strike, links, lists, blockquotes,
// simple pipe tables, and horizontal rules. Unknown syntax degrades to plain
// text. Tolerates streaming (an unclosed fence renders as a code block).

export function renderMarkdown(text) {
  const frag = document.createDocumentFragment();
  const lines = (text || '').replace(/\r\n?/g, '\n').split('\n');
  let i = 0;

  const peek = () => lines[i];

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i++; continue; }

    // fenced code block (unclosed fence = still-streaming, render what we have)
    const fence = line.match(/^```(\S*)\s*$/);
    if (fence) {
      i++;
      const body = [];
      while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++]);
      if (i < lines.length) i++; // consume closing fence
      frag.append(codeBlock(body.join('\n'), fence[1]));
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const h = document.createElement(`h${Math.min(heading[1].length + 2, 6)}`);
      h.className = `md-h md-h${heading[1].length}`;
      h.append(inline(heading[2]));
      frag.append(h);
      i++;
      continue;
    }

    if (/^(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      frag.append(document.createElement('hr'));
      i++;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quote = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''));
      const bq = document.createElement('blockquote');
      bq.append(renderMarkdown(quote.join('\n')));
      frag.append(bq);
      continue;
    }

    if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(line)) {
      frag.append(list());
      continue;
    }

    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1] || '')) {
      frag.append(table());
      continue;
    }

    // paragraph: consecutive plain lines; single newlines become <br> (chat convention)
    const para = document.createElement('p');
    let first = true;
    while (i < lines.length && peek().trim() && !blockStart(peek())) {
      if (!first) para.append(document.createElement('br'));
      para.append(inline(lines[i++]));
      first = false;
    }
    frag.append(para);
  }

  return frag;

  function list() {
    const ordered = /^\s*\d+[.)]\s+/.test(peek());
    const listEl = document.createElement(ordered ? 'ol' : 'ul');
    const itemRe = ordered ? /^(\s*)\d+[.)]\s+(.*)$/ : /^(\s*)[-*+]\s+(.*)$/;
    while (i < lines.length) {
      const m = peek().match(itemRe);
      if (!m) break;
      i++;
      const li = document.createElement('li');
      const parts = [m[2]];
      // continuation lines (indented, or plain text directly below) belong to this item
      while (i < lines.length && peek().trim() && !blockStart(peek()) && /^\s{2,}/.test(peek())) {
        parts.push(peek().trim());
        i++;
      }
      li.append(inline(parts.join(' ')));
      // nested list, one level
      if (i < lines.length && /^\s{2,}(?:[-*+]|\d+[.)])\s+/.test(peek())) {
        const nested = [];
        const indent = peek().match(/^\s+/)[0].length;
        while (i < lines.length && /^\s{2,}(?:[-*+]|\d+[.)])\s+/.test(peek()) && peek().match(/^\s+/)[0].length >= indent) {
          nested.push(peek().slice(indent));
          i++;
        }
        li.append(renderMarkdown(nested.join('\n')));
      }
      listEl.append(li);
    }
    return listEl;
  }

  function table() {
    const rows = [];
    while (i < lines.length && /^\s*\|.*\|\s*$/.test(peek())) {
      rows.push(peek().trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()));
      i++;
    }
    const tbl = document.createElement('table');
    const wrap = document.createElement('div');
    wrap.className = 'md-table';
    wrap.append(tbl);
    rows.splice(1, 1); // drop the |---|---| separator row
    rows.forEach((cells, r) => {
      const tr = document.createElement('tr');
      for (const cell of cells) {
        const td = document.createElement(r === 0 ? 'th' : 'td');
        td.append(inline(cell));
        tr.append(td);
      }
      tbl.append(tr);
    });
    return wrap;
  }
}

function blockStart(line) {
  return /^```|^#{1,6}\s|^\s*>\s?|^\s*(?:[-*+]|\d+[.)])\s+|^(?:-{3,}|\*{3,}|_{3,})\s*$|^\s*\|.*\|\s*$/.test(line);
}

function codeBlock(code, lang) {
  const wrap = document.createElement('div');
  wrap.className = 'codeblock';
  const head = document.createElement('div');
  head.className = 'codeblock-head';
  const label = document.createElement('span');
  label.textContent = lang || 'code';
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'codeblock-copy';
  copy.textContent = 'copy';
  copy.onclick = () => {
    navigator.clipboard?.writeText(code).then(() => {
      copy.textContent = 'copied';
      setTimeout(() => { copy.textContent = 'copy'; }, 1500);
    });
  };
  head.append(label, copy);
  const pre = document.createElement('pre');
  const codeEl = document.createElement('code');
  codeEl.textContent = code;
  pre.append(codeEl);
  wrap.append(head, pre);
  return wrap;
}

// Inline spans: `code`, **bold**, *italic*, _italic_, ~~strike~~, [text](url),
// bare URLs. Single-pass tokenizer; anything unmatched stays literal text.
const INLINE_RE = /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_|~~([^~]+)~~|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>"')\]]+)/g;

function inline(text) {
  const frag = document.createDocumentFragment();
  let last = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    if (m.index > last) frag.append(text.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[2] !== undefined) {
      const code = document.createElement('code');
      code.textContent = m[2].trim();
      frag.append(code);
    } else if (m[3] !== undefined || m[4] !== undefined) {
      const b = document.createElement('strong');
      b.append(inline(m[3] ?? m[4]));
      frag.append(b);
    } else if (m[5] !== undefined || m[6] !== undefined) {
      const em = document.createElement('em');
      em.append(inline(m[5] ?? m[6]));
      frag.append(em);
    } else if (m[7] !== undefined) {
      const s = document.createElement('s');
      s.append(inline(m[7]));
      frag.append(s);
    } else if (m[8] !== undefined) {
      frag.append(link(m[9], m[8]));
    } else if (m[10] !== undefined) {
      frag.append(link(m[10], m[10]));
    }
  }
  if (last < text.length) frag.append(text.slice(last));
  return frag;
}

function link(href, label) {
  const a = document.createElement('a');
  a.href = href;
  a.textContent = label;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}
