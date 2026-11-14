import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, linkSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const run = (...args: string[]) =>
  spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], { encoding: 'utf8' });

const inTemp = (check: (directory: string) => void) => {
  const directory = mkdtempSync(join(tmpdir(), 'ledger-lint-cli-'));
  try {
    check(directory);
  } finally {
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep))
      throw new Error('Unexpected test cleanup path.');
    rmSync(directory, { recursive: true, force: true });
  }
};

describe('CLI input contract', () => {
  it('rejects unknown options instead of silently ignoring them', () => {
    const result = run('examples/eu-invoice.json', '--fail-on', 'error', '--unknown', 'value');
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/Unknown option/);
  });

  it('rejects impossible reference dates', () => {
    expect(run('examples/eu-invoice.json', '--today', '2026-02-30').status).toBe(2);
  });

  it('returns findings rather than a usage error for a valid extraction', () => {
    const result = run('examples/eu-invoice.json', '--today', '2026-11-14');
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('# Ledger Lint report');
    expect(result.stderr).toBe('');
  });

  it('protects input bytes and makes no partial output when a later output overlaps input', () =>
    inTemp((directory) => {
      const input = join(directory, 'invoice.json');
      const report = join(directory, 'report.json');
      copyFileSync('examples/eu-invoice.json', input);
      const before = readFileSync(input);
      const result = run(input, '--json', report, '--csv', join(directory, '.', 'invoice.json'));
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('overlaps an input');
      expect(readFileSync(input)).toEqual(before);
      expect(existsSync(report)).toBe(false);
    }));

  it('rejects duplicate report destinations before writing any report', () =>
    inTemp((directory) => {
      const report = join(directory, 'report.txt');
      expect(run('examples/eu-invoice.json', '--json', report, '--prompt', report).status).toBe(2);
      expect(existsSync(report)).toBe(false);
    }));

  it('protects an input reached through a hard-link alias', () =>
    inTemp((directory) => {
      const input = join(directory, 'invoice.json');
      const alias = join(directory, 'alias.json');
      copyFileSync('examples/eu-invoice.json', input);
      linkSync(input, alias);
      const before = readFileSync(input);
      expect(run(input, '--json', alias).status).toBe(2);
      expect(readFileSync(input)).toEqual(before);
    }));
});
