#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function walk(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory() ? walk(path) : [path];
    });
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const webJavaScript = walk(resolve(ROOT, 'web'))
  .filter((path) => path.endsWith('.js'))
  .sort();
const tests = [...webJavaScript, ...walk(resolve(ROOT, 'test'))]
  .filter((path) => path.endsWith('.test.js'))
  .sort();

if (!tests.length) throw new Error('no web tests discovered');

console.log(`Running ${tests.length} web test files…`);
run(process.execPath, ['--test', ...tests.map((path) => relative(ROOT, path))]);

console.log(`Checking ${webJavaScript.length} JavaScript files…`);
for (const path of webJavaScript) run(process.execPath, ['--check', relative(ROOT, path)]);

const localImport = /(?:\bfrom\s*|\bimport\s*\()\s*['"](\.[^'"]+)['"]/g;
for (const source of webJavaScript) {
  const text = readFileSync(source, 'utf8');
  for (const match of text.matchAll(localImport)) {
    const specifier = match[1].split(/[?#]/, 1)[0];
    const target = resolve(dirname(source), specifier);
    if (!existsSync(target)) {
      throw new Error(`${relative(ROOT, source)} imports missing ${specifier}`);
    }
  }
}

console.log('Web tests, syntax checks, and local import checks passed.');
