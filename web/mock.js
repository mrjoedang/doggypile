// Dev-only mock of transport.js. Loaded by app.js when the page URL has
// `?mock` so the full UI can be exercised in a plain browser tab — no daemon,
// no iroh, no phone. Scenarios: ?mock (rich data), ?mock=empty, ?mock=offline.
// Never imported in production; the daemon does not embed this file.

export class NoSupportedAgentError extends Error {
  constructor(message, { agents = [], hostCapabilities = [] } = {}) {
    super(message);
    this.name = 'NoSupportedAgentError';
    this.agents = agents;
    this.hostCapabilities = hostCapabilities;
  }
}

export async function installAgent() {
  await sleep(1200);
  return [{ name: 'opencode', available: true, wire: 'jsonl' }];
}

const scenario = new URLSearchParams(location.search).get('mock') || 'rich';

const now = Math.floor(Date.now() / 1000);
const threads = scenario === 'empty' ? [] : [
  { id: 't1', name: 'Fix flaky pairing test in daemon', cwd: '/Users/joe/src/projects/doggypile', updatedAt: now - 90 },
  { id: 't2', name: 'Add retry backoff to iroh reconnect', cwd: '/Users/joe/src/projects/doggypile', updatedAt: now - 60 * 47 },
  { id: 't3', name: null, preview: 'why is bun install slow on CI runners', cwd: '/Users/joe/src/infra', updatedAt: now - 3600 * 5 },
  { id: 't4', name: 'Refactor opencode bridge translate layer', cwd: '/Users/joe/src/projects/doggypile/daemon', updatedAt: now - 86400 * 2 },
  { id: 't5', name: 'Write release notes for v0.1.1', cwd: '/Users/joe/src/projects/doggypile', updatedAt: now - 86400 * 6 },
];

const t1History = [
  item('userMessage', 'u1', { content: [{ type: 'text', text: 'The pairing test in daemon/crates/doggypile is flaky on CI — it fails maybe 1 in 5 runs with a timeout. Can you find and fix it?' }] }),
  item('reasoning', 'r1', { summary: ['Looking for the pairing test first. It likely spins up a real daemon and races the token exchange against a hard-coded timeout. CI machines are slower, so a 2s budget could plausibly flake.'] }),
  item('commandExecution', 'c1', { command: 'grep -rn "pair" daemon/crates/doggypile/tests --include="*.rs" -l', status: 'completed', aggregatedOutput: 'daemon/crates/doggypile/tests/pairing.rs\ndaemon/crates/doggypile/tests/support/mod.rs\n' }),
  item('commandExecution', 'c2', { command: 'cargo test -p doggypile --test pairing -- --nocapture', status: 'completed', aggregatedOutput: 'running 3 tests\ntest pair_token_roundtrip ... ok\ntest pair_expired_token ... ok\ntest pair_qr_url ... FAILED\n\nfailures:\n    pair_qr_url\n\ntest result: FAILED. 2 passed; 1 failed\n' }),
  item('agentMessage', 'a1', { text: `Found it. The flake is in \`pair_qr_url\` — it waits for the daemon socket with a fixed **2 second** timeout:\n\n\`\`\`rust\nlet sock = wait_for_socket(&path, Duration::from_secs(2))?;\n\`\`\`\n\nOn a loaded CI runner the daemon can take longer than that to bind. Two changes fix it:\n\n1. Bump the budget to 10s — the wait returns as soon as the socket appears, so the happy path stays fast.\n2. Poll with exponential backoff instead of a fixed 50ms spin.\n\nWant me to apply both?` }),
  item('userMessage', 'u2', { content: [{ type: 'text', text: 'yes go ahead' }] }),
  item('fileChange', 'f1', { changes: [{ path: 'daemon/crates/doggypile/tests/support/mod.rs' }] }),
  item('commandExecution', 'c3', { command: 'cargo test -p doggypile --test pairing', status: 'completed', aggregatedOutput: 'running 3 tests\ntest pair_token_roundtrip ... ok\ntest pair_expired_token ... ok\ntest pair_qr_url ... ok\n\ntest result: ok. 3 passed; 0 failed\n' }),
  item('agentMessage', 'a2', { text: `Done — applied both changes and the suite passes. I ran it **20 times in a loop** to be sure:\n\n- \`wait_for_socket\` budget: 2s → 10s\n- polling: fixed 50ms → 25ms doubling to 400ms\n\nNo failures across all 20 runs. The fix is in \`tests/support/mod.rs\`, nothing in production code changed.` }),
];

function item(type, id, extra) { return { type, id, ...extra }; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function connect({ onLine, onMetrics, onClose }) {
  if (scenario === 'offline') {
    await sleep(700);
    throw new Error('failed to reach node: relay connection timed out');
  }
  if (scenario === 'noagent') {
    await sleep(500);
    throw new NoSupportedAgentError('No supported agent is available: codex not advertised; opencode not advertised', { hostCapabilities: ['install_agent'] });
  }
  await sleep(scenario === 'slow' ? 3000 : 400);

  let closed = false;
  let notifySeq = 1;
  const emit = (msg) => { if (!closed) onLine(JSON.stringify(msg)); };
  const reply = (id, result) => emit({ jsonrpc: '2.0', id, result });
  const notify = (method, params) => emit({ jsonrpc: '2.0', method, params });

  const metricsTimer = setInterval(() => {
    onMetrics?.({ agent: 'codex', timings: { wasm: 12, iroh: 180, auth: 40 }, path: { selected: 'direct', rtt_ms: 23 } });
  }, 1500);
  onMetrics?.({ agent: 'codex', timings: { wasm: 12, iroh: 180, auth: 40 }, path: { selected: 'direct', rtt_ms: 23 } });

  async function streamTurn(threadId, userText) {
    const seq = notifySeq++;
    const rid = `live-r${seq}`, cid = `live-c${seq}`, aid = `live-a${seq}`;
    notify('turn/started', { threadId });
    await sleep(500);

    notify('item/started', { threadId, item: item('reasoning', rid, { summary: [''] }) });
    for (const chunk of chunks('The user wants a demo of streaming. I will run a quick command to show tool output, then answer with some formatted markdown so every message kind renders.', 6)) {
      await sleep(60); notify('item/reasoning/summaryTextDelta', { threadId, itemId: rid, delta: chunk });
    }
    notify('item/completed', { threadId, item: item('reasoning', rid, { summary: ['The user wants a demo of streaming. I will run a quick command to show tool output, then answer with some formatted markdown so every message kind renders.'] }) });

    await sleep(300);
    notify('item/started', { threadId, item: item('commandExecution', cid, { command: 'ls -la web/', status: 'running' }) });
    const out = 'total 88\ndrwxr-xr-x   9 joe  staff   288 Jul 12 10:22 .\n-rw-r--r--   1 joe  staff  1204 Jul 12 10:22 index.html\n-rw-r--r--   1 joe  staff  9831 Jul 12 10:22 app.js\n-rw-r--r--   1 joe  staff  8412 Jul 12 10:22 styles.css\n-rw-r--r--   1 joe  staff  2210 Jul 12 10:21 mock.js\n';
    for (const chunk of chunks(out, 4)) {
      await sleep(150); notify('item/commandExecution/outputDelta', { threadId, itemId: cid, delta: chunk });
    }
    notify('item/completed', { threadId, item: item('commandExecution', cid, { command: 'ls -la web/', status: 'completed', aggregatedOutput: out }) });

    await sleep(300);
    const answer = `Here's what streaming markdown looks like${userText ? ` (you said: *${userText.slice(0, 40)}*)` : ''}:\n\n## Headings work\n\nAs do **bold**, *italic*, \`inline code\`, ~~strikethrough~~ and [links](https://example.com).\n\n\`\`\`js\nconst answer = 42;\nconsole.log(\`the answer is \${answer}\`);\n\`\`\`\n\n1. Ordered lists\n2. With multiple items\n\n- And unordered ones\n- Like this\n\n> Blockquotes render too.\n\nThat covers every message kind the projection can produce.`;
    notify('item/started', { threadId, item: item('agentMessage', aid, { text: '' }) });
    for (const chunk of chunks(answer, 8)) {
      await sleep(45); notify('item/agentMessage/delta', { threadId, itemId: aid, delta: chunk });
    }
    notify('item/completed', { threadId, item: item('agentMessage', aid, { text: answer }) });
    notify('turn/completed', { threadId });
  }

  let nextThreadId = 100;
  function handleRequest(msg) {
    const { id, method, params } = msg;
    switch (method) {
      case 'initialize': return reply(id, { ok: true });
      case 'thread/list': return setTimeout(() => reply(id, { data: threads }), scenario === 'slowlist' ? 2500 : 350);
      case 'thread/resume': return reply(id, {});
      case 'thread/read': {
        const turns = params.threadId === 't1' ? [{ items: t1History }] : [];
        return setTimeout(() => reply(id, { thread: { id: params.threadId, turns } }), 250);
      }
      case 'thread/start': {
        const tid = `t${nextThreadId++}`;
        threads.unshift({ id: tid, name: null, preview: 'New session', cwd: '/Users/joe/src/projects/doggypile', updatedAt: Math.floor(Date.now() / 1000) });
        return reply(id, { thread: { id: tid } });
      }
      case 'turn/start': {
        reply(id, {});
        const text = params.input?.[0]?.text || '';
        if (/fail/.test(text)) return; // let "fail" test the no-response path
        streamTurn(params.threadId, text);
        return;
      }
      case 'turn/interrupt': {
        reply(id, {});
        return notify('turn/failed', { threadId: params.threadId });
      }
      default: return reply(id, {});
    }
  }

  return {
    agent: 'codex',
    wire: 'websocket',
    sendLine: (line) => {
      let msg; try { msg = JSON.parse(line); } catch { return; }
      if (msg.id !== undefined) setTimeout(() => handleRequest(msg), 30);
    },
    close: () => { closed = true; clearInterval(metricsTimer); onClose?.(); },
  };
}

function chunks(text, size) {
  const words = text.split(/(?<=\s)/);
  const out = [];
  for (let i = 0; i < words.length; i += size) out.push(words.slice(i, i + size).join(''));
  return out;
}
