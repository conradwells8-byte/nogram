#!/usr/bin/env node
// Release NOGRAM: bump the patch version, regenerate the .meta.js file,
// add a CHANGELOG entry, commit everything and push to main.
//
//   npm run release -- "fix nav selector"
//
// The first line of the message is the changelog entry and commit title; any
// further lines go into the commit body only.
//
// No dependencies. Uses only Node built-ins and your local git.

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { headerOf, SCRIPT, META } from './lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHANGELOG = join(root, 'CHANGELOG.md');

const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const fail = (msg) => {
  console.error('release: ' + msg);
  process.exit(1);
};

// 1. Preconditions.
const message = process.argv.slice(2).join(' ').trim();
if (!message) fail('pass a message, e.g. npm run release -- "fix nav selector"');
const [summary, ...body] = message.split('\n');

const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
if (branch !== 'main') fail(`you're on "${branch}", switch to main first`);

execFileSync(process.execPath, ['--check', SCRIPT], { stdio: 'inherit' }); // syntax check

// 2. Bump the patch version in the userscript header.
const source = readFileSync(SCRIPT, 'utf8');
const versionLine = /^(\/\/\s*@version\s+)(\d+)\.(\d+)\.(\d+)\s*$/m;
const m = versionLine.exec(source);
if (!m) fail('could not find a "// @version x.y.z" line in the header');
const next = `${m[2]}.${m[3]}.${Number(m[4]) + 1}`;
const bumped = source.replace(versionLine, `$1${next}`);
writeFileSync(SCRIPT, bumped);

// 3. Regenerate the .meta.js file the phone checks for updates.
writeFileSync(META, headerOf(bumped) + '\n');

// 4. Add a CHANGELOG entry (newest first, right under the title).
const today = new Date().toISOString().slice(0, 10);
const entry = `## ${next} - ${today}\n\n- ${summary.trim()}\n`;
const log = readFileSync(CHANGELOG, 'utf8');
const firstEntry = log.indexOf('\n## ');
writeFileSync(
  CHANGELOG,
  firstEntry === -1 ? log.trimEnd() + '\n\n' + entry : log.slice(0, firstEntry + 1) + entry + '\n' + log.slice(firstEntry + 1)
);

// 5. Commit and push.
git('add', '-A');
git('commit', '-m', `v${next}: ${summary.trim()}` + (body.length ? '\n' + body.join('\n') : ''));
console.log(`Committed v${next}. Pushing...`);
execFileSync('git', ['push', 'origin', 'main'], { cwd: root, stdio: 'inherit' });
console.log(`\nReleased v${next}. On the phone: Safari > Userscripts popup > refresh > update.`);
