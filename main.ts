// Token Radar entrypoint (Node 22, standard library only, zero network).
// Reads the sealed DefiLlama snapshot, executes the single-source empirical engine
// (dashboard/engine.js via lib/model.ts), validates every gate invariant, writes
// board.json, data.js, copies dashboard/ and screenshots/, and builds dossier.json last.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function readFlag(name: string, fallback: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1]!;
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match === undefined ? fallback : match.slice(prefix.length);
}

function resolveInputFile(): string {
  const raw = readFlag('input', '/input');
  const file = raw.endsWith('.json') ? raw : join(raw, 'snapshot.json');
  if (!existsSync(file)) {
    process.stderr.write(`token-radar: missing snapshot at ${file}\n`);
    process.exit(2);
  }
  return file;
}

function resolveOutputDir(): string {
  return readFlag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
}

function copyPlainFiles(srcDir: string, dstDir: string): string[] {
  if (!existsSync(srcDir)) return [];
  mkdirSync(dstDir, { recursive: true });
  const names = readdirSync(srcDir).filter((n) => !n.startsWith('.')).sort();
  const copied: string[] = [];
  for (const name of names) {
    const src = join(srcDir, name);
    if (!statSync(src).isFile()) continue;
    copyFileSync(src, join(dstDir, name));
    copied.push(name);
  }
  return copied;
}

function copyAndCheckScreenshots(outDir: string): string[] {
  const shots = copyPlainFiles(join(here, 'screenshots'), join(outDir, 'screenshots'));
  if (shots.length < 3 || shots.length > SCREENSHOT_CAPS.max) {
    process.stderr.write(`token-radar: screenshots/ holds ${shots.length} images (gate requires 3..4)\n`);
    process.exit(1);
  }
  for (const name of shots) {
    if (!IMAGE_NAME.test(name)) {
      process.stderr.write(`token-radar: invalid screenshot filename ${name}\n`);
      process.exit(1);
    }
  }
  return shots;
}

const inputFile = resolveInputFile();
const outDir = resolveOutputDir();
const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
if (snapshot.protocols.length === 0) {
  process.stderr.write(`token-radar: empty protocol list in ${inputFile}\n`);
  process.exit(2);
}

const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token-radar: gate check failed: ${issue}\n`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(radar));

const dashFiles = copyPlainFiles(join(here, 'dashboard'), join(outDir, 'dashboard'));
const shotFiles = copyAndCheckScreenshots(outDir);
const dossierBytes = buildDossier(outDir, {
  text_max_bytes: TEXT_MAX_BYTES,
  screenshots: SCREENSHOT_CAPS,
  dashboard: { max_files: 400, max_bytes: 4_194_304 },
});
writeFileSync(join(outDir, 'dossier.json'), dossierBytes);

const c = radar.counts;
process.stdout.write(
  `token-radar (${String(radar.version)}): ${c.total} protocols (${c.watchlist} watchlist, ${c.early} early, ${c.excluded} set aside, ${c.live} live)\n` +
    `token-radar: rank 1 is ${board[0]!.name} at $${board[0]!.implied_value_usd.toLocaleString('en-US')}; verdicts ${c.verdicts.FARM} FARM / ${c.verdicts.SELECTIVE} SELECTIVE / ${c.verdicts.SKIP} SKIP\n` +
    `token-radar: wrote ${dashFiles.length} dashboard files, ${shotFiles.length} screenshots, dossier ${dossierBytes.length.toLocaleString('en-US')} bytes\n`,
);
