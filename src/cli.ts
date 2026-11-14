/**
 * Ledger Lint command line: check extracted invoice JSON and print a Markdown report.
 *
 *   npm run lint-invoice -- extraction.json [more.json …] [--fail-on error|warning] [--json report.json]
 *                           [--csv findings.csv] [--prompt fix.txt] [--today 2026-11-14] [--decimal ,|.]
 *
 * Each file may hold one invoice, an array, { "invoices": [...] } or JSON Lines.
 * Exit codes: 0 = nothing at or above --fail-on, 1 = findings at or above it, 2 = usage or input error.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { lintBatch } from './core/batch.ts';
import { splitInput } from './core/map.ts';
import { correctionPrompt, csvReport, jsonReport, markdownReport } from './core/report.ts';

const USAGE =
  'Usage: npm run lint-invoice -- <file.json> [more files] [--fail-on error|warning] [--json file] [--csv file] [--prompt file] [--today yyyy-mm-dd] [--decimal , or .]';

async function main(argv: string[]): Promise<number> {
  const files: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      console.log(USAGE);
      return 0;
    }
    if (arg.startsWith('--')) flags.set(arg.slice(2), argv[++i] ?? '');
    else files.push(arg);
  }
  const failOn = flags.get('fail-on') ?? 'error';
  const decimal = flags.get('decimal');
  const today = flags.get('today');
  if (
    !files.length ||
    !['error', 'warning'].includes(failOn) ||
    (decimal && decimal !== ',' && decimal !== '.') ||
    (today && !/^\d{4}-\d{2}-\d{2}$/.test(today))
  ) {
    console.error(USAGE);
    return 2;
  }
  const items: unknown[] = [];
  for (const file of files) {
    let text: string;
    try {
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

process.exitCode = await main(process.argv.slice(2));
