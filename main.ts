// Token Radar's entrypoint (Node 22, standard library only).
//
// The run has five steps, in order. First it finds the sealed snapshot, at
// /input/snapshot.json or wherever --input points. Then it scores every pre-token
// protocol with the radar-4 model in lib/model.ts and refuses a board the gate would
// refuse, with the reason named. Then it writes the board to /output/board.json and
// the dashboard's dataset to /output/data.js. Then it copies this repository's
// dashboard/ and screenshots/ to /output, checking the screenshots are present and
// named the way the gate wants. Last, it writes /output/dossier.json, the summary
// the judge reads, with the vendored make.fun library — last, because the scorer
// rebuilds it from /output and compares bytes, so it must see the finished output.
//
// The dashboard is a static page, no framework and no network: dashboard/index.html,
// dashboard/app.css and dashboard/app.js read /output/data.js, which this program
// writes from the same board. The board covers the whole watchlist, states the model
// and gives every protocol a farm plan. The model is category-calibrated: each
// category's multiple is the median market-cap-to-TVL of its live-token peers in the
// same snapshot.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

// Inputs and outputs, in one place: the input is the sealed snapshot (a JSON document
// with the protocol index and the watchlist). The outputs are board.json (the ranked
// board), data.js (the dashboard's dataset), dashboard/ and screenshots/ copied
// verbatim, and dossier.json (the judge's summary) written last.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. Both `--name value` and
 * `--name=value` are read, so the grader's spelling does not matter. */
function flag(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

/** The snapshot's path: --input <snapshot.json|directory>, defaulting to /input, with
 * a directory read as its snapshot.json. Refused with a usage hint when nothing is there. */
function resolveInputPath(): string {
  const inputArg = flag('input', '/input');
  const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
  if (!existsSync(inputFile)) {
    process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
    process.exit(2);
  }
  return inputFile;
}

/** The output directory: --output, else MAKEFUN_OUTPUT_DIR, else /output. */
function resolveOutputDir(): string {
  return flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
}

/** The snapshot out of its file, refused when it carries no protocols: an empty
 * snapshot would score an empty board and fail on coverage with a confusing message,
 * so it is refused here with the cause named. */
function loadSnapshot(inputFile: string) {
  const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
  if (snapshot.protocols.length === 0) {
    process.stderr.write(`token radar: the snapshot at ${inputFile} carries no protocols: it cannot be scored\n`);
    process.exit(2);
  }
  return snapshot;
}

/** The board, scored and refused when the gate would refuse it. The check runs
 * before anything is written, so a bad model never leaves a half-written /output. */
function buildAndCheckBoard(snapshot: ReturnType<typeof loadSnapshot>) {
  const { board, radar } = buildRadar(snapshot);
  const issue = boardIssue(board, snapshot);
  if (issue !== null) {
    process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
    process.exit(1);
  }
  return { board, radar };
}

/** The board and the dashboard's dataset, written to the output directory. */
function writeBoardAndData(out: string, board: ReturnType<typeof buildRadar>['board'], radar: ReturnType<typeof buildRadar>['radar']): void {
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
  writeFileSync(join(out, 'data.js'), dataScript(radar));
}

/** Copy one directory's regular files into `to`, skipping names that start with a
 * dot, and returning the names copied. A missing source copies nothing. */
function copyDirectory(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

/** The screenshots, refused unless at least three are handed in and every name is
 * letters, digits and . _ -, 1 to 128 characters, as the gate wants them. */
function copyScreenshots(out: string): string[] {
  const shots = copyDirectory(join(here, 'screenshots'), join(out, 'screenshots'));
  if (shots.length < 3) {
    process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
    process.exit(1);
  }
  for (const name of shots) {
    if (!IMAGE_NAME.test(name)) {
      process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
      process.exit(1);
    }
  }
  return shots;
}

/** The dossier, written last: the scorer rebuilds it from this /output and compares
 * bytes, so it is built only once the board, the data, the dashboard and the
 * screenshots are all in place. */
function writeDossier(out: string): Uint8Array {
  const dossierBytes = buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } });
  writeFileSync(join(out, 'dossier.json'), dossierBytes);
  return dossierBytes;
}

/** The run's summary on stdout: how much was scored, the top row, the dossier's size
 * and where everything went. */
function printSummary(
  out: string,
  snapshot: ReturnType<typeof loadSnapshot>,
  board: ReturnType<typeof buildRadar>['board'],
  radar: ReturnType<typeof buildRadar>['radar'],
  dashFiles: string[],
  shotFiles: string[],
  dossierBytes: Uint8Array,
): void {
  process.stdout.write(
    `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
      `token radar: rank 1 is ${board[0]!.name} at $${board[0]!.implied_value_usd.toLocaleString('en-US')}; dossier is ${dossierBytes.length.toLocaleString('en-US')} bytes\n` +
      `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${dashFiles.length} files), ${join(out, 'screenshots')} (${shotFiles.length} images) and ${join(out, 'dossier.json')}\n`,
  );
}

// The run, in order: find the snapshot, score the board, write the board and the
// data, copy the dashboard and the screenshots, write the dossier last, and report.
const inputFile = resolveInputPath();
const out = resolveOutputDir();
const snapshot = loadSnapshot(inputFile);
const { board, radar } = buildAndCheckBoard(snapshot);
writeBoardAndData(out, board, radar);
const dashFiles = copyDirectory(join(here, 'dashboard'), join(out, 'dashboard'));
const shotFiles = copyScreenshots(out);
const dossierBytes = writeDossier(out);
printSummary(out, snapshot, board, radar, dashFiles, shotFiles, dossierBytes);
