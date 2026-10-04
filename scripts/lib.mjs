// Shared helpers for release.mjs and check.mjs.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export const SCRIPT = join(root, 'instagram-no-reels.user.js');
export const META = join(root, 'instagram-no-reels.meta.js');

/** The "// ==UserScript== ... // ==/UserScript==" block from a script's source. */
export function headerOf(source) {
  const m = /\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/.exec(source);
  if (!m) throw new Error('no ==UserScript== header found');
  return m[0];
}
