#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const DRY_RUN = process.argv.includes('--dry-run');
const SKIP_PUSH = process.argv.includes('--skip-push');
const SKIP_TAG = process.argv.includes('--skip-tag') || process.argv.includes('--skip-release');
const NO_WAIT = process.argv.includes('--no-wait');
const REPO_SLUG = 'mrjoedang/doggypile';
const RELEASE_WORKFLOW_NAME = 'Release';

function run(cmd, args, opts = {}) {
  const capture = opts.capture ?? true;
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd ?? process.cwd(),
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
  });
  if (result.status !== 0) {
    const details = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
    throw new Error(`Command failed: ${cmd} ${args.join(' ')}${details ? `\n${details}` : ''}`);
  }
  return result.stdout?.trim() ?? '';
}
function runOk(cmd, args) { return spawnSync(cmd, args, { cwd: process.cwd(), stdio: 'ignore' }).status === 0; }
function cleanTree() { if (run('git', ['status', '--porcelain'])) throw new Error('Working tree must be clean before publishing.'); }
function latestTag() {
  const tags = run('git', ['tag', '--list', 'v*', '--sort=-v:refname']).split('\n').map((t) => t.trim()).filter(Boolean);
  return tags.find((t) => /^v\d+\.\d+\.\d+$/.test(t)) ?? null;
}
function currentVersion() { return /^version\s*=\s*"([^"]+)"/m.exec(readFileSync('daemon/Cargo.toml', 'utf8'))?.[1] ?? '0.0.0'; }
function commitEntries(range) {
  return run('git', ['log', range, '--format=%s%n%b%n--END--'])
    .split('\n--END--').map((e) => e.trim()).filter(Boolean)
    .filter((e) => !e.startsWith('chore(release):'));
}
function commitType(entry) { return /^([a-z]+)(?:\([^)]+\))?!?:/m.exec(entry)?.[1] ?? null; }
function recommendedBump(entries, hasTag = true) {
  let bump = null;
  for (const entry of entries) {
    if (/BREAKING CHANGE:/m.test(entry) || /^[a-z]+(?:\([^)]+\))?!:/m.test(entry)) return 'major';
    const type = commitType(entry);
    if (['docs', 'chore', 'ci', 'test'].includes(type)) continue;
    if (type === 'feat') bump = 'minor';
    else if (type) bump ??= 'patch';
  }
  return bump ?? (!hasTag && entries.length ? 'patch' : null);
}
function bumpVersion(version, bump) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`Invalid version: ${version}`);
  let [, major, minor, patch] = match.map(Number);
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}
function replaceVersion(path, version) {
  const text = readFileSync(path, 'utf8');
  writeFileSync(path, text.replace(/^version\s*=\s*"[^"]+"/m, `version = "${version}"`));
}
function writeVersions(version) {
  replaceVersion('daemon/Cargo.toml', version);
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  pkg.version = version;
  writeFileSync('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
  run('cargo', ['generate-lockfile'], { capture: false, cwd: 'daemon' });
}
function remoteTagExists(tag) { try { return run('git', ['ls-remote', '--tags', 'origin', tag]).includes(tag); } catch { return false; } }
function localTagExists(tag) { return runOk('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`]); }
function pushBranch() { run('git', ['push', 'origin', `HEAD:${process.env.DOGGYPILE_PUBLISH_BRANCH?.trim() || 'main'}`], { capture: false }); }
function sleep(seconds) { spawnSync('sleep', [String(seconds)], { stdio: 'ignore' }); }
function triggerReleaseWorkflow(tag) {
  if (!runOk('gh', ['auth', 'status', '-h', 'github.com'])) return;
  run('gh', ['workflow', 'run', 'release.yml', '--repo', REPO_SLUG, '-f', `tag=${tag}`], { capture: false });
}
function waitForWorkflow(_tag, sha) {
  if (NO_WAIT || !runOk('gh', ['auth', 'status', '-h', 'github.com'])) return;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const out = run('gh', ['run', 'list', '--repo', REPO_SLUG, '--workflow', RELEASE_WORKFLOW_NAME, '--commit', sha, '--json', 'databaseId,event']);
    const runId = JSON.parse(out).find((r) => r.event === 'push')?.databaseId;
    if (runId) return run('gh', ['run', 'watch', String(runId), '--repo', REPO_SLUG, '--exit-status'], { capture: false });
    sleep(3);
  }
}

if (SKIP_PUSH && !SKIP_TAG) throw new Error('--skip-tag is required when using --skip-push.');
cleanTree();
run('git', ['fetch', 'origin', '--tags'], { capture: false });
const tag = latestTag();
const entries = commitEntries(tag ? `${tag}..HEAD` : 'HEAD');
const bump = recommendedBump(entries, Boolean(tag));
console.log(`Latest tag: ${tag ?? '(none)'}`);
console.log(`Recommended bump: ${bump ?? 'none'}`);
if (!bump) process.exit(0);
const version = bumpVersion(tag ? tag.slice(1) : currentVersion(), bump);
const nextTag = `v${version}`;
console.log(`Next version: ${version}`);
if (DRY_RUN) process.exit(0);
if (remoteTagExists(nextTag) || localTagExists(nextTag)) throw new Error(`Tag already exists: ${nextTag}`);
writeVersions(version);
run('git', ['add', 'daemon/Cargo.toml', 'daemon/Cargo.lock', 'package.json']);
run('git', ['commit', '-m', `chore(release): ${nextTag}`], { capture: false });
const sha = run('git', ['rev-parse', 'HEAD']);
if (!SKIP_PUSH) pushBranch();
if (SKIP_TAG) process.exit(0);
run('git', ['tag', '-a', nextTag, sha, '-m', nextTag], { capture: false });
if (!SKIP_PUSH) {
  run('git', ['push', 'origin', nextTag], { capture: false });
  triggerReleaseWorkflow(nextTag);
  waitForWorkflow(nextTag, sha);
}
