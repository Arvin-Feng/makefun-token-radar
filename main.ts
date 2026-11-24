// Token Radar, model radar-2 (Node 22, standard library only).
//
// The program reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>),
// scores every pre-token protocol with the comps-calibrated model in lib/model.ts, writes the
// ranked board to /output/board.json, and copies this repository's dashboard/ and screenshots/
// to /output. Last, it writes /output/dossier.json, the summary the judge reads, with the
// vendored make.fun library.
//
// The dashboard is a static page, no framework and no network: dashboard/index.html,
// dashboard/app.css and dashboard/app.js read /output/data.js, which this program writes from
// the same board. The model is comps-calibrated: each category's multiple is the median
// market-cap-to-TVL ratio of the snapshot's own tokenized protocols, computed at run time, so
// the board follows from the snapshot's figures and no name is ever special-cased.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json
//
// The run is strict: a missing snapshot exits 2, a board the gate refuses exits 1, and fewer
// than three screenshots exits 1. Anything else is written, then reported on stdout.

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

/** What --help prints: the run's flags, its inputs, and what it writes. */
const USAGE = `token radar: rank the snapshot's pre-token protocols by comps-calibrated implied value.

usage:
  node main.ts [--input <snapshot.json|directory>] [--output <dir>]
  MAKEFUN_OUTPUT_DIR=<dir> node main.ts [--input <snapshot.json|directory>]

  --input   the sealed snapshot, a file or the directory holding snapshot.json (default /input)
  --output  where the board, the data and the dossier go (default /output, or MAKEFUN_OUTPUT_DIR)
  --help    this text

The run writes board.json, data.js, dashboard/, screenshots/ and dossier.json, then
reports what it scored. It refuses a board the gate will not take.
`;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

/** The snapshot file out of --input, or the sealed /input when no flag is given. */
function resolveInput(): string {
  const inputArg = arg('input', '/input');
  const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
  if (!existsSync(inputFile)) {
    process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
    process.exit(2);
  }
  return inputFile;
}

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
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

/**
 * The screenshots the run copies: three or more, each with a plain name. Fewer than three
 * means the entry has no board, detail and filtered view to show, so the run stops here.
 */
function checkScreenshots(shots: string[]): void {
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
}

/** The run's report: what it scored, the comps it used, and what it wrote. */
function report(out: string, snapshot: ReturnType<typeof parseSnapshot>, board: unknown[], radar: { early_size: number; live_size: number; comps: { global_multiple: number; global_n: number; by_category: unknown[] } }, shots: string[]): void {
  process.stdout.write(
    `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
      `token radar: comps global ${radar.comps.global_multiple}x over ${radar.comps.global_n} tokenized protocols, ${radar.comps.by_category.length} categories with their own multiple\n` +
      `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (3 files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
  );
}

/** The run: read the snapshot, score it, refuse a bad board, write the outputs. */
function main(): void {
  const inputFile = resolveInput();
  const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

  const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
  const { board, radar } = buildRadar(snapshot);
  const issue = boardIssue(board, snapshot);
  if (issue !== null) {
    process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
    process.exit(1);
  }

  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
  writeFileSync(join(out, 'data.js'), dataScript(radar));

  copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
  const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
  checkScreenshots(shots);

  // The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
  writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

  report(out, snapshot, board, radar, shots);
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write(USAGE);
} else {
  main();
}
