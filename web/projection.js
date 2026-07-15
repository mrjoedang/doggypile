// Fold codex thread items + streaming notifications into an ordered list of
// renderable messages. This is the JS mini-version of the Rust thread
// projection: the codex server owns truth; we just shape it for display.

export function createProjection() {
  const items = new Map(); // id -> message
  let order = [];
  let nextLocalId = 1;

  function upsert(id, patch) {
    const existing = items.get(id) || { id, order: order.length };
    if (!items.has(id)) order.push(id);
    items.set(id, { ...existing, ...patch });
  }

  function remove(id) {
    if (!items.delete(id)) return false;
    order = order.filter((itemId) => itemId !== id);
    return true;
  }

  function removeMatchingLocalUser(text) {
    for (const id of order) {
      const item = items.get(id);
      if (item?.local && item.role === 'user' && item.text === text) remove(id);
    }
  }

  // Map a codex ThreadItem into our display shape.
  function fromItem(it) {
    switch (it.type) {
      case 'userMessage':
        return { role: 'user', kind: 'text', text: textOf(it.content) };
      case 'agentMessage':
        return { role: 'assistant', kind: 'text', text: it.text || '' };
      case 'reasoning':
        return { role: 'assistant', kind: 'reasoning', text: (it.summary || it.content || []).join('\n') };
      case 'plan':
        return { role: 'assistant', kind: 'plan', text: it.text || '' };
      case 'commandExecution':
        return { role: 'tool', kind: 'command', command: it.command, status: it.status || 'running', text: it.aggregatedOutput || '' };
      case 'fileChange':
        return { role: 'tool', kind: 'fileChange', text: summarizeFileChange(it), files: fileChangePaths(it) };
      case 'mcpToolCall':
        return { role: 'tool', kind: 'tool', text: `${it.server || ''}·${it.tool || 'tool'}` };
      case 'webSearch':
        return { role: 'tool', kind: 'tool', text: `search: ${it.query || ''}` };
      default:
        return { role: 'tool', kind: 'other', text: it.type };
    }
  }

  function applyItem(it, { lifecycle = false } = {}) {
    const existing = items.get(it.id);
    const item = fromItem(it);
    if (item.role === 'user') removeMatchingLocalUser(item.text);
    // opencode can emit assistant deltas, then later replay empty/stale
    // lifecycle frames for the same item. Do not let those frames blank the
    // message the user already saw; still allow non-empty completed items to
    // correct streamed text unless they are the duplicated-token artifact seen
    // from opencode SSE replay.
    if (lifecycle && existing?.text && item.role === existing.role && item.kind === existing.kind) {
      const staleEmpty = !item.text;
      const duplicatedStream = existing.streamed && sameAfterDedupe(item.text, existing.text);
      if (staleEmpty || duplicatedStream) {
        item.text = existing.text;
        item.streamed = existing.streamed;
      }
    }
    upsert(it.id, item);
  }

  // Seed from thread/read (includeTurns).
  function seedFromThread(thread) {
    items.clear();
    order = [];
    for (const turn of thread?.turns || []) {
      for (const it of turn.items || []) applyItem(it);
    }
  }

  // Apply a streaming server notification. Returns true if it changed anything.
  function applyNotification(msg) {
    const p = msg.params || {};
    switch (msg.method) {
      case 'item/started':
      case 'item/completed':
        applyItem(p.item, { lifecycle: true });
        return true;
      case 'item/agentMessage/delta': {
        const cur = items.get(p.itemId);
        upsert(p.itemId, { role: 'assistant', kind: 'text', text: (cur?.text || '') + (p.delta || ''), streamed: true });
        return true;
      }
      case 'item/reasoning/textDelta':
      case 'item/reasoning/summaryTextDelta': {
        const cur = items.get(p.itemId);
        upsert(p.itemId, { role: 'assistant', kind: 'reasoning', text: (cur?.text || '') + (p.delta || ''), streamed: true });
        return true;
      }
      case 'item/commandExecution/outputDelta': {
        const cur = items.get(p.itemId);
        upsert(p.itemId, { role: 'tool', kind: 'command', command: cur?.command, text: (cur?.text || '') + (p.delta ?? decodeChunk(p.chunk)), streamed: true });
        return true;
      }
      default:
        return false;
    }
  }

  function addLocalUserMessage(text) {
    const id = `local-user-${nextLocalId++}`;
    upsert(id, { role: 'user', kind: 'text', text, local: true });
    return id;
  }

  function removeLocalMessage(id) {
    const item = items.get(id);
    if (item?.local) return remove(id);
    return false;
  }

  function toRenderList() {
    return order.map((id) => items.get(id)).filter(Boolean);
  }

  return { seedFromThread, applyNotification, addLocalUserMessage, removeLocalMessage, toRenderList };
}

function sameAfterDedupe(candidate, expected) {
  if (!candidate || !expected) return false;
  return normalizeText(collapseAdjacentDuplicates(candidate)) === normalizeText(expected);
}

function collapseAdjacentDuplicates(text) {
  const tokens = text.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]+/gu) || [];
  const out = [];
  let previousNonSpace = '';
  for (const raw of tokens) {
    if (/^\s+$/.test(raw)) {
      out.push(' ');
      continue;
    }
    const token = halveRepeatedToken(raw);
    if (token === previousNonSpace) continue;
    out.push(token);
    previousNonSpace = token;
  }
  return out.join('');
}

function halveRepeatedToken(token) {
  if (token.length % 2 !== 0) return token;
  const mid = token.length / 2;
  const left = token.slice(0, mid);
  return left === token.slice(mid) ? left : token;
}

function normalizeText(text) {
  return text.replace(/\s+/g, ' ').replace(/\s+([?.!,;:])/g, '$1').trim();
}
function textOf(content) {
  return (content || [])
    .filter((c) => c.type === 'text')
    .map(textInputOf)
    .join('');
}

function textInputOf(input) {
  let text = input.text || '';
  const spans = (input.text_elements || input.textElements || [])
    .filter((e) => e.placeholder && e.byte_range)
    .sort((a, b) => b.byte_range.start - a.byte_range.start);
  for (const el of spans) {
    const { start, end } = el.byte_range;
    text = text.slice(0, start) + el.placeholder + text.slice(end);
  }
  // Codex can encode rich UI placeholders in the plain text fallback, e.g.
  // ::inbox-item{title="Waiting for task details"}. This PWA doesn't render
  // those widgets yet, so show the title instead of the raw marker syntax.
  return text.replace(/::[\w-]+\{title="([^"]+)"[^}]*\}/g, '$1');
}

function summarizeFileChange(it) {
  const changes = it.changes || it.fileChanges || [];
  return changes.length ? `edited ${changes.length} file(s)` : 'file change';
}

function fileChangePaths(it) {
  return (it.changes || it.fileChanges || [])
    .map((c) => c?.path || c?.file || '')
    .filter(Boolean);
}

function decodeChunk(chunk) {
  if (typeof chunk === 'string') { try { return atob(chunk); } catch { return chunk; } }
  return '';
}
