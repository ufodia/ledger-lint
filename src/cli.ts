/**
 * Ledger Lint command line: check extracted invoice JSON and print a Markdown report.
 *
 *   npm run lint-invoice -- extraction.json [more.json …] [--fail-on error|warning] [--json report.json]
 *                           [--csv findings.csv] [--prompt fix.txt] [--today 2026-11-14] [--decimal ,|.]
 *
 * Each file may hold one invoice, an array, { "invoices": [...] } or JSON Lines.
 * Exit codes: 0 = nothing at or above --fail-on, 1 = findings at or above it, 2 = usage or input error.
 */
import { readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { lintBatch } from './core/batch.ts';
import { parseDate } from './core/dates.ts';
import { MAX_INPUT_BYTES } from './core/input.ts';
import { splitInput } from './core/map.ts';
import { correctionPrompt, csvReport, jsonReport, markdownReport } from './core/report.ts';

const USAGE =
  'Usage: npm run lint-invoice -- <file.json> [more files] [--fail-on error|warning] [--json file] [--csv file] [--prompt file] [--today yyyy-mm-dd] [--decimal , or .]';

async function checkOutputPaths(files: string[], outputs: string[]): Promise<void> {
  const key = (path: string) => (process.platform === 'win32' ? path.toLowerCase() : path);
  const target = async (path: string) => {
    const absolute = resolve(path);
    const info = await stat(absolute).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return undefined;
    });
    const physical = info
      ? await realpath(absolute)
      : resolve(await realpath(dirname(absolute)).catch(() => dirname(absolute)), basename(absolute));
    return { path, absolute: key(absolute), physical: key(physical), info };
  };
  const inputs = await Promise.all(files.map(target));
  const destinations = await Promise.all(outputs.map(target));
  const same = (a: Awaited<ReturnType<typeof target>>, b: Awaited<ReturnType<typeof target>>) =>
    a.absolute === b.absolute ||
    a.physical === b.physical ||
    (a.info && b.info && a.info.ino !== 0 && a.info.dev === b.info.dev && a.info.ino === b.info.ino);
  for (const [i, output] of destinations.entries()) {
    if (inputs.some((input) => same(output, input)))
      throw new Error(`Report output overlaps an input file: ${output.path}`);
    if (destinations.slice(0, i).some((other) => same(output, other)))
      throw new Error(`Report outputs overlap: ${output.path}`);
  }
}

async function main(argv: string[]): Promise<number> {
  const files: string[] = [];
  const flags = new Map<string, string>();
  const allowed = new Set(['fail-on', 'decimal', 'today', 'json', 'csv', 'prompt']);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      console.log(USAGE);
      return 0;
    }
    if (arg.startsWith('--')) {
      const name = arg.slice(2);
      const value = argv[++i];
      if (!allowed.has(name) || !value || value.startsWith('--')) {
        console.error(`Unknown option or missing value: ${arg}\n${USAGE}`);
        return 2;
      }
      flags.set(name, value);
    } else files.push(arg);
  }
  const failOn = flags.get('fail-on') ?? 'error';
  const decimal = flags.get('decimal');
  const today = flags.get('today');
  if (
    !files.length ||
    !['error', 'warning'].includes(failOn) ||
    (decimal && decimal !== ',' && decimal !== '.') ||
    (today && (!/^\d{4}-\d{2}-\d{2}$/.test(today) || parseDate(today).iso !== today))
  ) {
    console.error(USAGE);
    return 2;
  }
  await checkOutputPaths(
    files,
    ['json', 'csv', 'prompt'].flatMap((name) => (flags.has(name) ? [flags.get(name)!] : [])),
  );
  const items: unknown[] = [];
  for (const file of files) {
    let text: string;
    try {
      if ((await stat(file)).size > MAX_INPUT_BYTES) {
        console.error(`${file}: The file is larger than 20 MB.`);
        return 2;
      }
      text = await readFile(file, 'utf8');
    } catch (error) {
      console.error(`Cannot read ${file}: ${(error as Error).message}`);
      return 2;
    }
    const parsed = splitInput(text);
    if (parsed.error) {
      console.error(`${file}: ${parsed.error}`);
      return 2;
    }
    items.push(...parsed.items);
  }
  const { results } = lintBatch(items, { today, decimal: decimal as ',' | '.' | undefined });
  if (flags.get('json')) await writeFile(flags.get('json')!, jsonReport(results));
  if (flags.get('csv')) await writeFile(flags.get('csv')!, csvReport(results));
  if (flags.get('prompt'))
    await writeFile(
      flags.get('prompt')!,
      results
        .map((r, i) => (results.length > 1 ? `### Invoice ${i + 1}\n\n` : '') + correctionPrompt(r))
        .join('\n\n') + '\n',
    );
  process.stdout.write(markdownReport(results));
  const failing = results.reduce(
    (n, r) => n + r.counts.error + (failOn === 'warning' ? r.counts.warning : 0),
    0,
  );
  return failing > 0 ? 1 : 0;
}

process.exitCode = await main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(`Cannot check input or write report: ${(error as Error).message}`);
  return 2;
});
