#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR_DIR = join(ROOT, 'web', 'vendor', 'iroh');
const TRANSPORT_PATH = join(ROOT, 'web', 'transport.js');
const CURRENT_PATH = join(VENDOR_DIR, 'current.txt');
const VERSION_RE = /^[0-9a-f]{64}$/;
// These root-level files shipped before content-addressing and must remain
// byte-for-byte compatible with clients that still request the old URLs.
const LEGACY_VERSION = '69aa5ee426524995868877736a69c802f5618c28316f49053e8fec8e3eae4d13';
const OUTPUTS = [
  'doggypile_transport.d.ts',
  'doggypile_transport.js',
  'doggypile_transport_bg.wasm',
  'doggypile_transport_bg.wasm.d.ts',
];

function fail(message) {
  throw new Error(message);
}

function readOutputs(directory) {
  return OUTPUTS.map((name) => {
    const path = join(directory, name);
    if (!existsSync(path) || !lstatSync(path).isFile()) {
      fail(`missing wasm-pack output: ${relative(ROOT, path)}`);
    }
    return [name, readFileSync(path)];
  });
}

function digestOutputs(outputs) {
  const hash = createHash('sha256');
  for (const [name, bytes] of outputs) {
    hash.update(name);
    hash.update('\0');
    hash.update(String(bytes.byteLength));
    hash.update('\0');
    hash.update(bytes);
  }
  return hash.digest('hex');
}

function verifySiblingWasmReference(outputs, label) {
  const glue = outputs.find(([name]) => name === 'doggypile_transport.js')[1].toString('utf8');
  const siblingWasmReferences = glue.match(
    /new URL\('doggypile_transport_bg\.wasm', import\.meta\.url\)/g,
  ) ?? [];
  if (siblingWasmReferences.length !== 1) {
    fail(`${label}/doggypile_transport.js must contain exactly one sibling WASM URL`);
  }
}

function verifyVersionDirectory(directory, expectedVersion) {
  const entries = readdirSync(directory, { withFileTypes: true });
  const unexpected = entries
    .filter((entry) => !entry.isFile() || !OUTPUTS.includes(entry.name))
    .map((entry) => entry.name);
  if (unexpected.length > 0 || entries.length !== OUTPUTS.length) {
    fail(`${relative(ROOT, directory)} must contain exactly the four wasm-pack outputs`);
  }

  const outputs = readOutputs(directory);
  const actualVersion = digestOutputs(outputs);
  if (actualVersion !== expectedVersion) {
    fail(`${relative(ROOT, directory)} hashes to ${actualVersion}, not ${expectedVersion}`);
  }
  verifySiblingWasmReference(outputs, relative(ROOT, directory));
}

function writeCurrentVersion(version) {
  const source = readFileSync(TRANSPORT_PATH, 'utf8');
  const importPattern = /import init, \{ Channel \} from '[^']+';/g;
  const matches = source.match(importPattern) ?? [];
  if (matches.length !== 1) {
    fail(`expected exactly one wasm import in ${relative(ROOT, TRANSPORT_PATH)}`);
  }
  const nextImport = `import init, { Channel } from './vendor/iroh/${version}/doggypile_transport.js';`;
  writeFileSync(CURRENT_PATH, `${version}\n`);
  writeFileSync(TRANSPORT_PATH, source.replace(importPattern, nextImport));
}

function packageOutputs(sourceDirectory) {
  const source = resolve(sourceDirectory);
  const outputs = readOutputs(source);
  verifySiblingWasmReference(outputs, relative(ROOT, source));
  const version = digestOutputs(outputs);
  const destination = join(VENDOR_DIR, version);

  if (existsSync(destination)) {
    verifyVersionDirectory(destination, version);
    for (const [name, bytes] of outputs) {
      if (!readFileSync(join(destination, name)).equals(bytes)) {
        fail(`refusing to replace immutable asset ${relative(ROOT, join(destination, name))}`);
      }
    }
  } else {
    mkdirSync(VENDOR_DIR, { recursive: true });
    const temporary = mkdtempSync(join(VENDOR_DIR, '.wasm-version-'));
    try {
      for (const [name] of outputs) {
        cpSync(join(source, name), join(temporary, name), { errorOnExist: true });
      }
      renameSync(temporary, destination);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }

  writeCurrentVersion(version);
  console.log(`packaged wasm assets as ${version}`);
}

function readCurrentVersion() {
  if (!existsSync(CURRENT_PATH)) fail(`missing ${relative(ROOT, CURRENT_PATH)}`);
  const contents = readFileSync(CURRENT_PATH, 'utf8');
  if (!VERSION_RE.test(contents.trim()) || contents !== `${contents.trim()}\n`) {
    fail(`${relative(ROOT, CURRENT_PATH)} must contain one lowercase full SHA-256 followed by a newline`);
  }
  return contents.trim();
}

function verifyTransportImport(version) {
  const expected = `import init, { Channel } from './vendor/iroh/${version}/doggypile_transport.js';`;
  const source = readFileSync(TRANSPORT_PATH, 'utf8');
  const imports = source.match(/import init, \{ Channel \} from '[^']+';/g) ?? [];
  if (imports.length !== 1 || imports[0] !== expected) {
    fail(`${relative(ROOT, TRANSPORT_PATH)} must import the version selected by current.txt`);
  }
}

function immutablePathsAt(ref) {
  let listing;
  try {
    listing = execFileSync(
      'git',
      ['ls-tree', '-r', '--name-only', ref, '--', 'web/vendor/iroh'],
      { cwd: ROOT, encoding: 'utf8' },
    );
  } catch {
    fail(`could not read wasm asset history at git ref ${ref}`);
  }

  return listing.split('\n').filter((path) => {
    if (!path) return false;
    const suffix = path.slice('web/vendor/iroh/'.length);
    const parts = suffix.split('/');
    return (parts.length === 1 && OUTPUTS.includes(parts[0]))
      || (parts.length === 2 && VERSION_RE.test(parts[0]) && OUTPUTS.includes(parts[1]));
  });
}

function verifyHistory(ref) {
  for (const path of immutablePathsAt(ref)) {
    const workingPath = join(ROOT, path);
    if (!existsSync(workingPath)) {
      fail(`immutable wasm asset from ${ref} was deleted: ${path}`);
    }
    let historical;
    try {
      historical = execFileSync('git', ['show', `${ref}:${path}`], {
        cwd: ROOT,
        encoding: 'buffer',
        maxBuffer: 16 * 1024 * 1024,
      });
    } catch {
      fail(`could not read ${path} at git ref ${ref}`);
    }
    if (!readFileSync(workingPath).equals(historical)) {
      fail(`immutable wasm asset from ${ref} was modified: ${path}`);
    }
  }
}

function checkAssets(historyRef) {
  const legacyVersion = digestOutputs(readOutputs(VENDOR_DIR));
  if (legacyVersion !== LEGACY_VERSION) {
    fail(`frozen root-level wasm aliases hash to ${legacyVersion}, not ${LEGACY_VERSION}`);
  }
  const currentVersion = readCurrentVersion();
  const versionEntries = readdirSync(VENDOR_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && VERSION_RE.test(entry.name));
  if (versionEntries.length === 0) fail('no content-addressed wasm asset directories found');
  for (const entry of versionEntries) {
    verifyVersionDirectory(join(VENDOR_DIR, entry.name), entry.name);
  }
  if (!versionEntries.some((entry) => entry.name === currentVersion)) {
    fail(`current wasm version directory does not exist: ${currentVersion}`);
  }
  verifyTransportImport(currentVersion);
  if (historyRef) verifyHistory(historyRef);
  console.log(`verified ${versionEntries.length} wasm asset version(s); current is ${currentVersion}`);
}

function usage() {
  console.error('usage: node scripts/package-wasm.mjs package <wasm-pack-output-dir>');
  console.error('       node scripts/package-wasm.mjs check [--history-ref <git-ref>]');
  process.exitCode = 2;
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  try {
    if (command === 'package' && args.length === 1) {
      packageOutputs(args[0]);
    } else if (command === 'check' && args.length === 0) {
      checkAssets();
    } else if (command === 'check' && args.length === 2 && args[0] === '--history-ref') {
      checkAssets(args[1]);
    } else {
      usage();
    }
  } catch (error) {
    console.error(`wasm asset error: ${error.message}`);
    process.exitCode = 1;
  }
}

main();
