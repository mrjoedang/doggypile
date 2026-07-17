// Run with: bunx playwriter@latest -s SESSION -f /absolute/path/to/scripts/playwriter-smoke.mjs
// Optional: BASE_URL='http://127.0.0.1:8123/?mock&machines=2' bunx ...

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:8123/?mock';
const page = state.page || (state.page = await context.newPage());
const startedAt = new Date().toISOString();
const results = {
  suite: 'doggypile-playwriter-smoke',
  baseUrl,
  startedAt,
  status: 'running',
  checks: [],
  observations: [],
  browserErrors: [],
};

const record = (name, detail = {}) => results.checks.push({ name, status: 'passed', ...detail });
const assert = (condition, message) => {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
};
const visible = async (locator) => locator.isVisible().catch(() => false);
const observe = async (label) => {
  const observation = await page.evaluate(() => ({
    url: location.href,
    title: document.title,
    screen: document.querySelector('#sessionview:not([hidden])') ? 'session' : 'home',
    heading: document.querySelector('#chat-title')?.textContent?.trim() || null,
    sessions: [...document.querySelectorAll('.session-title')].map((node) => node.textContent?.trim()).filter(Boolean),
    selectedTab: document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim() || null,
    turnActive: !document.querySelector('#stop')?.hidden,
  }));
  results.observations.push({ label, at: new Date().toISOString(), ...observation });
  return observation;
};

const onConsole = (message) => {
  if (message.type() === 'error') results.browserErrors.push({ type: 'console', text: message.text() });
};
const onPageError = (error) => results.browserErrors.push({ type: 'pageerror', text: error.message });
page.on('console', onConsole);
page.on('pageerror', onPageError);

try {
  await observe('before-navigation');
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

  const home = page.locator('#home');
  const homeButton = page.getByRole('button', { name: 'Home' });
  const firstSession = page.getByRole('button', { name: /Fix flaky pairing test in daemon/i });
  await home.waitFor({ state: 'visible' });
  await firstSession.waitFor({ state: 'visible' });
  assert(await homeButton.getAttribute('aria-current') === 'page', 'Home is current after boot');
  assert((await page.locator('.session-open').count()) >= 5, 'rich mock sessions loaded');
  await observe('home-ready');
  record('boot/home sessions', { sessionCount: await page.locator('.session-open').count() });

  await firstSession.click();
  await page.locator('#sessionview').waitFor({ state: 'visible' });
  await page.getByText('The pairing test in daemon/crates/doggypile is flaky on CI', { exact: false }).waitFor({ state: 'visible' });
  await observe('existing-session-open');
  record('open existing session');

  const contextToggle = page.getByRole('button', { name: 'Toggle context panel' });
  if (await visible(contextToggle)) {
    const before = await contextToggle.getAttribute('aria-pressed');
    await contextToggle.click();
    await page.waitForFunction(
      ({ selector, before }) => document.querySelector(selector)?.getAttribute('aria-pressed') !== before,
      { selector: '#ctx-toggle', before },
    );
    await observe('context-toggled');
    record('context toggle', { from: before, to: await contextToggle.getAttribute('aria-pressed') });
  } else {
    results.checks.push({ name: 'context toggle', status: 'skipped', reason: 'not exposed at this viewport' });
  }

  await homeButton.click();
  await firstSession.waitFor({ state: 'visible' });
  const secondSession = page.getByRole('button', { name: /Add retry backoff to iroh reconnect/i });
  await secondSession.click();
  await page.locator('#chat-title').filter({ hasText: 'Add retry backoff' }).waitFor({ state: 'visible' });
  await observe('second-session-open');

  const firstTab = page.getByRole('tab', { name: /Fix flaky pairing test in daemon/i });
  if (await visible(firstTab)) {
    await firstTab.click();
    await page.waitForFunction(() => document.querySelector('#chat-title')?.textContent?.includes('Fix flaky pairing'));
    await observe('tab-selected');
    record('tab selection');
  } else {
    results.checks.push({ name: 'tab selection', status: 'skipped', reason: 'tab strip not exposed at this viewport' });
  }

  const newSession = page.getByRole('button', { name: 'New session' }).first();
  await newSession.click();
  await page.locator('#chat-title').filter({ hasText: 'New session' }).waitFor({ state: 'visible' });
  await observe('new-session');
  record('new session');

  const machineChooser = page.getByRole('button', { name: /machine.*(?:change|session)|choose a machine/i }).last();
  await machineChooser.waitFor({ state: 'visible' });
  await machineChooser.click();
  const machineOptions = page.getByRole('menuitemradio');
  await machineOptions.first().waitFor({ state: 'visible' });
  const optionCount = await machineOptions.count();
  assert(optionCount >= 1, 'machine chooser has an option');
  let selectedMachine = false;
  for (let index = 0; index < optionCount; index += 1) {
    const option = machineOptions.nth(index);
    if (await option.isEnabled()) {
      await option.click();
      selectedMachine = true;
      break;
    }
  }
  if (!selectedMachine) await page.keyboard.press('Escape');
  assert(selectedMachine, 'machine chooser has a connected option');
  await observe('machine-chosen');
  record('machine chooser', { optionCount });

  const message = `playwriter smoke ${Date.now()}`;
  const input = page.getByRole('textbox', { name: 'Message the agent' });
  await input.fill(message);
  const send = page.getByRole('button', { name: 'Send message' });
  assert(!(await send.isDisabled()), 'Send enables after entering a message');
  await send.click();
  await page.getByText(message, { exact: true }).waitFor({ state: 'visible' });
  await page.getByText(`you said: ${message.slice(0, 40)}`, { exact: false }).waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForFunction(() => document.querySelector('#stop')?.hidden === true, null, { timeout: 15000 });
  await observe('turn-completed');
  assert(!(await page.locator('#main .working').isVisible().catch(() => false)), 'working indicator cleared');
  record('mock message response and turn completion', { message });

  assert(results.browserErrors.length === 0, `browser emitted errors: ${JSON.stringify(results.browserErrors)}`);
  record('console/page errors', { count: 0 });
  results.status = 'passed';
} catch (error) {
  results.status = 'failed';
  results.failure = error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) };
} finally {
  page.off('console', onConsole);
  page.off('pageerror', onPageError);
  results.finishedAt = new Date().toISOString();
  console.log(JSON.stringify(results, null, 2));
}

if (results.status !== 'passed') throw new Error(results.failure?.message || 'Playwriter smoke failed');
