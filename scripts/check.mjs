#!/usr/bin/env node
// Sanity checks you can run any time: npm run check
//   - the userscript parses
//   - the .meta.js file matches the userscript header (so the phone sees the right version)
//   - the script makes no network requests

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { headerOf, SCRIPT, META } from './lib.mjs';

let ok = true;
const problem = (msg) => {
  console.error('✗ ' + msg);
  ok = false;
};

execFileSync(process.execPath, ['--check', SCRIPT], { stdio: 'inherit' });
console.log('✓ userscript parses');

const source = readFileSync(SCRIPT, 'utf8');
const meta = readFileSync(META, 'utf8').trim();
if (headerOf(source) !== meta) problem('instagram-no-reels.meta.js is out of date (npm run release regenerates it)');
else console.log('✓ .meta.js matches the header');

// The header's update URLs are the only URLs allowed in the file.
const body = source.slice(headerOf(source).length);
const network = /\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource|importScripts)\b|https?:\/\/(?!www\.instagram\.com)/;
const hit = network.exec(body);
if (hit) problem(`possible network use in script body: "${hit[0]}"`);
else console.log('✓ no network APIs or external URLs in the script body');

process.exit(ok ? 0 : 1);
