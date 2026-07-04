// Fold codex thread items + streaming notifications into an ordered list of
// renderable messages. This is the JS mini-version of the Rust thread
// projection: the codex server owns truth; we just shape it for display.

export function createProjection() {
  const items = new Map(); // id -> message
  let order = [];

  function upsert(id, patch) {
    const existing = items.get(id) || { id, order: order.length };
    if (!items.has(id)) order.push(id);
    items.set(id, { ...existing, ...patch });
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
        return { role: 'tool', kind: 'fileChange', text: summarizeFileChange(it) };
      case 'mcpToolCall':
        return { role: 'tool', kind: 'tool', text: `${it.server || ''}·${it.tool || 'tool'}` };
      case 'webSearch':
        return { role: 'tool', kind: 'tool', text: `search: ${it.query || ''}` };
      default:
        return { role: 'tool', kind: 'other', text: it.type };
    }
  }

  function applyItem(it) {
    upsert(it.id, fromItem(it));
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
        applyItem(p.item);
        return true;
      case 'item/agentMessage/delta': {
        const cur = items.get(p.itemId);
        upsert(p.itemId, { role: 'assistant', kind: 'text', text: (cur?.text || '') + (p.delta || '') });
        return true;
      }
      case 'item/reasoning/textDelta':
      case 'item/reasoning/summaryTextDelta': {
        const cur = items.get(p.itemId);
        upsert(p.itemId, { role: 'assistant', kind: 'reasoning', text: (cur?.text || '') + (p.delta || '') });
        return true;
      }
      case 'item/commandExecution/outputDelta': {
        const cur = items.get(p.itemId);
        upsert(p.itemId, { role: 'tool', kind: 'command', command: cur?.command, text: (cur?.text || '') + decodeChunk(p.chunk) });
        return true;
      }
      default:
        return false;
    }
  }

  function toRenderList() {
    return order.map((id) => items.get(id)).filter(Boolean);
  }

  return { seedFromThread, applyNotification, toRenderList };
}

function textOf(content) {
  return (content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
}

function summarizeFileChange(it) {
  const changes = it.changes || it.fileChanges || [];
  return changes.length ? `edited ${changes.length} file(s)` : 'file change';
}

function decodeChunk(chunk) {
  if (typeof chunk === 'string') { try { return atob(chunk); } catch { return chunk; } }
  return '';
}
