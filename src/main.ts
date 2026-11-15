import './style.css';
import { lintBatch } from './core/batch.ts';
import { formatDate } from './core/dates.ts';
import { formatIban } from './core/ids.ts';
import {
  fieldLabel,
  type Finding,
  type Group,
  type LintResult,
  type Status,
  type Verdict,
} from './core/lint.ts';
import { splitInput } from './core/map.ts';
import { MAX_INPUT_BYTES } from './core/input.ts';
import { formatAmount, formatRate } from './core/numbers.ts';
import { correctionPrompt, csvReport, jsonReport, markdownReport } from './core/report.ts';
import { DEMOS } from './demo.ts';
import { byId, download, h } from './dom.ts';

const VERDICT: Record<Verdict, { title: string; text: string }> = {
  'does-not-add-up': {
    title: 'Does not add up',
    text: 'One or more supplied values failed a check. Review the marked fields against the original document.',
  },
  'check-warnings': {
    title: 'Check the warnings',
    text: 'No arithmetic contradiction was found in the checks performed. Review the warnings.',
  },
  'adds-up': {
    title: 'Adds up',
    text: 'No errors or warnings in the checks performed. Confirm against the original invoice.',
  },
};
const GROUPS: [Group, string][] = [
  ['arithmetic', 'Arithmetic'],
  ['tax', 'Tax'],
  ['identifiers', 'Identifiers'],
  ['dates', 'Dates'],
  ['document', 'Reading the data'],
];
const STATUS_LABEL: Record<Status, string> = {
  error: 'Error',
  warning: 'Warning',
  info: 'Note',
  pass: 'Passed',
};
const ICON: Record<Status, string> = { error: '✕', warning: '!', info: 'i', pass: '✓' };
const RANK: Record<Status, number> = { error: 0, warning: 1, info: 2, pass: 3 };

let results: LintResult[] = [];
let current = 0;
let selected: string | null = null;
let showAll = false;
let inputVersion = 0;

const intro = byId('intro');
const workspace = byId('workspace');
const input = byId<HTMLTextAreaElement>('input');
const inputError = byId('input-error');
const decimal = byId<HTMLSelectElement>('decimal');
const today = byId<HTMLInputElement>('today');
today.value = new Date().toISOString().slice(0, 10);

function fail(message: string) {
  intro.hidden = false;
  workspace.hidden = true;
  inputError.textContent = message;
  inputError.hidden = false;
}

function run(text: string) {
  inputVersion++;
  inputError.hidden = true;
  const { items, error } = splitInput(text);
  if (error) return fail(error);
  if (!items.length) return fail('No invoices were found in the input.');
  if (items.some((x) => typeof x !== 'object' || x === null || Array.isArray(x)))
    return fail('Each invoice must be a JSON object.');
  try {
    results = lintBatch(items, {
      today: today.value || undefined,
      decimal: (decimal.value || undefined) as ',' | '.' | undefined,
    }).results;
  } catch (error) {
    return fail(`Cannot check this input: ${(error as Error).message}`);
  }
  current = 0;
  showAll = false;
  selectFirst();
  intro.hidden = true;
  workspace.hidden = false;
  render();
  const heading = workspace.querySelector<HTMLElement>('h1');
  heading?.setAttribute('tabindex', '-1');
  heading?.focus();
  window.scrollTo({ top: 0 });
}

function selectFirst() {
  selected =
    results[current]?.findings.find(
      (f) => (f.status === 'error' || f.status === 'warning') && f.fields.length,
    )?.id ?? null;
}

byId('check').addEventListener('click', () => run(input.value));
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) run(input.value);
});
const fileInput = byId<HTMLInputElement>('file');
input.addEventListener('input', () => inputVersion++);
async function openFile(file: File) {
  const version = ++inputVersion;
  if (file.size > MAX_INPUT_BYTES) return fail('The file is larger than 20 MB.');
  try {
    const text = await file.text();
    if (version !== inputVersion) return;
    input.value = text;
    run(text);
  } catch {
    if (version === inputVersion) fail('The file could not be read. Try opening it again.');
  }
}
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (!file) return;
  await openFile(file);
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files[0];
  if (!file) return;
  await openFile(file);
});

const demoList = byId('demo-list');
for (const demo of DEMOS)
  demoList.append(
    h(
      'button',
      {
        type: 'button',
        class: 'demo',
        'data-demo': demo.id,
        onclick: () => {
          input.value = JSON.stringify(demo.data, null, 2);
          run(input.value);
        },
      },
      h('strong', {}, demo.label),
      h('span', {}, demo.note),
    ),
  );

// ——— Rendering ———

function render() {
  const r = results[current];
  if (!r) return;
  const focusedId = workspace.contains(document.activeElement) ? document.activeElement?.id : '';
  workspace.replaceChildren(
    ...(results.length > 1 ? [batchView()] : []),
    verdictBar(r),
    h('div', { class: 'ws-grid' }, paper(r), panel(r)),
  );
  document.querySelector('.fld.focus')?.scrollIntoView({ block: 'nearest' });
  // A related invoice field must not scroll the focused finding out of view.
  if (focusedId) document.getElementById(focusedId)?.focus();
}

function batchView(): HTMLElement {
  const counts = { 'adds-up': 0, 'check-warnings': 0, 'does-not-add-up': 0 } as Record<Verdict, number>;
  for (const r of results) counts[r.verdict]++;
  const rows = results.map((r, i) => {
    const inv = r.mapped.invoice;
    return h(
      'tr',
      {
        class: `${i === current ? 'current' : ''} v-${r.verdict}`,
        tabindex: 0,
        'aria-selected': String(i === current),
        onclick: () => open(i),
        onkeydown: (e: Event) => {
          if ((e as KeyboardEvent).key === 'Enter') open(i);
        },
      },
      h('td', { class: 'num' }, String(i + 1)),
      h('td', {}, inv.number ?? '—'),
      h('td', {}, inv.seller.name ?? '—'),
      h('td', {}, formatDate(inv.issueDate)),
      h(
        'td',
        { class: 'num' },
        inv.total !== undefined ? `${formatAmount(inv.total, inv.currency)} ${inv.currency ?? ''}` : '—',
      ),
      h(
        'td',
        { class: 'num' },
        r.counts.error ? h('span', { class: 'count-pill s-error' }, String(r.counts.error)) : '0',
      ),
      h(
        'td',
        { class: 'num' },
        r.counts.warning ? h('span', { class: 'count-pill s-warning' }, String(r.counts.warning)) : '0',
      ),
      h('td', {}, h('span', { class: `verdict-chip v-${r.verdict}` }, VERDICT[r.verdict].title)),
    );
  });
  return h(
    'section',
    { class: 'batch' },
    h(
      'div',
      { class: 'batch-head' },
      h('h2', {}, `${results.length} invoices`),
      h(
        'p',
        { class: 'muted' },
        `${counts['adds-up']} add up · ${counts['check-warnings']} with warnings · ${counts['does-not-add-up']} do not add up`,
      ),
    ),
    h(
      'div',
      { class: 'table-scroll' },
      h(
        'table',
        { class: 'batch-table' },
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            ...['#', 'Invoice', 'Seller', 'Date', 'Total', 'Errors', 'Warnings', 'Verdict'].map((t) =>
              h('th', { scope: 'col' }, t),
            ),
          ),
        ),
        h('tbody', {}, ...rows),
      ),
    ),
  );
}

function open(i: number) {
  current = i;
  showAll = false;
  selectFirst();
  render();
  document.querySelector('.verdict-bar')?.scrollIntoView({ block: 'start' });
}

function verdictBar(r: LintResult): HTMLElement {
  const v = VERDICT[r.verdict];
  const inv = r.mapped.invoice;
  const format = { generic: 'JSON', azure: 'Azure Document Intelligence', google: 'Google Document AI' }[
    r.mapped.format
  ];
  return h(
    'section',
    { class: `verdict-bar v-${r.verdict}` },
    h(
      'div',
      {},
      h(
        'p',
        { class: 'eyebrow' },
        `${results.length > 1 ? `Invoice ${current + 1} of ${results.length} · ` : ''}${inv.number ?? 'No invoice number'}${inv.seller.name ? ` · ${inv.seller.name}` : ''}`,
      ),
      h('h1', {}, v.title),
      h('p', { class: 'muted' }, v.text),
      h(
        'p',
        { class: 'read-as' },
        `Read as ${format} · decimal ${r.mapped.decimal === ',' ? 'comma' : 'point'} · ${Object.keys(r.mapped.sources).length} fields mapped`,
      ),
    ),
    h(
      'div',
      { class: 'tallies' },
      tally('error', r.counts.error, 'Errors'),
      tally('warning', r.counts.warning, 'Warnings'),
      tally('pass', r.counts.pass, 'Passed'),
    ),
    h(
      'div',
      { class: 'head-actions' },
      h(
        'button',
        {
          class: 'button ghost small',
          type: 'button',
          onclick: () => {
            inputVersion++;
            workspace.hidden = true;
            intro.hidden = false;
            input.focus();
          },
        },
        'Edit the JSON',
      ),
      h(
        'button',
        {
          class: 'button ghost small',
          type: 'button',
          onclick: () => {
            inputVersion++;
            input.value = '';
            workspace.hidden = true;
            workspace.replaceChildren();
            intro.hidden = false;
            input.focus();
            window.scrollTo({ top: 0 });
          },
        },
        'New check',
      ),
    ),
  );
}

const tally = (s: Status, n: number, label: string) =>
  h('div', { class: `tally s-${s}` }, h('strong', {}, String(n)), h('span', {}, label));

/** Field → worst status and marker number among the problems shown. */
function markers(r: LintResult) {
  const map = new Map<string, { status: Status; n?: number; ids: string[] }>();
  problems(r).forEach((f, i) => {
    f.fields.forEach((field, j) => {
      const m = map.get(field) ?? { status: f.status, ids: [] };
      if (RANK[f.status] < RANK[m.status]) m.status = f.status;
      if (j === 0 && m.n === undefined) m.n = i + 1;
      m.ids.push(f.id);
      map.set(field, m);
    });
  });
  return map;
}

const problems = (r: LintResult) => r.findings.filter((f) => f.status === 'error' || f.status === 'warning');

function paper(r: LintResult): HTMLElement {
  const inv = r.mapped.invoice;
  const marks = markers(r);
  const focus = new Set(r.findings.find((f) => f.id === selected)?.fields ?? []);
  const money = (v?: number) => (v === undefined ? '—' : formatAmount(v, inv.currency));

  const fld = (tag: 'span' | 'td' | 'dd' | 'div', field: string, content: string | Node, extra = '') => {
    const m = marks.get(field);
    const source = r.mapped.sources[field];
    const raw = r.mapped.raw[field];
    return h(
      tag as 'span',
      {
        class: `fld ${extra} ${m ? `s-${m.status}` : ''} ${focus.has(field) ? 'focus' : ''}`,
        'data-field': field,
        title: source
          ? `${fieldLabel(field)} · from ${source}${raw !== undefined ? ` · extracted as "${raw}"` : ''}`
          : undefined,
        tabindex: m ? 0 : undefined,
        onclick: m
          ? () => {
              selected = m.ids[0];
              render();
            }
          : undefined,
      },
      content,
      m?.n
        ? h('sup', { class: `marker s-${m.status}`, role: 'img', 'aria-label': `issue ${m.n}` }, String(m.n))
        : null,
    );
  };
  const party = (role: 'seller' | 'buyer') => {
    const p = inv[role];
    return h(
      'div',
      { class: `party ${role}` },
      h('p', { class: 'party-role' }, role === 'seller' ? 'From' : 'Bill to'),
      fld('div', `${role}.name`, p.name ?? '—', 'party-name'),
      p.address ? h('p', { class: 'address' }, p.address) : null,
      p.vatId ? h('p', { class: 'id-line' }, 'VAT ID ', fld('span', `${role}.vatId`, p.vatId, 'mono')) : null,
      p.taxId
        ? h(
            'p',
            { class: 'id-line' },
            inv.seller.country === 'TR' || inv.currency === 'TRY' ? 'VKN/TCKN ' : 'Tax no. ',
            fld('span', `${role}.taxId`, p.taxId, 'mono'),
          )
        : null,
      p.iban
        ? h(
            'p',
            { class: 'id-line' },
            'IBAN ',
            fld('span', `${role}.iban`, formatIban(p.iban.replace(/\s/g, '').toUpperCase()), 'mono'),
          )
        : null,
      p.country ? h('p', { class: 'id-line muted' }, `Country ${p.country}`) : null,
    );
  };
  const meta = (label: string, field: string, value?: string) => [
    h('dt', {}, label),
    fld('dd', field, value ?? '—'),
  ];

  const lines = inv.lines.map((l, i) =>
    h(
      'tr',
      {},
      h('td', { class: 'num muted' }, String(i + 1)),
      fld('td', `lines[${i}].description`, l.description ?? '—'),
      fld(
        'td',
        `lines[${i}].quantity`,
        l.quantity !== undefined ? l.quantity.toLocaleString('en', { maximumFractionDigits: 4 }) : '—',
        'num',
      ),
      fld('td', `lines[${i}].unitPrice`, money(l.unitPrice), 'num'),
      fld('td', `lines[${i}].netAmount`, money(l.netAmount), 'num'),
      fld('td', `lines[${i}].vatRate`, l.vatRate !== undefined ? formatRate(l.vatRate) : '—', 'num'),
    ),
  );

  const sum = (label: string, field: string, value: number | undefined, strong = false) =>
    value === undefined
      ? []
      : [
          h('dt', { class: strong ? 'strong' : '' }, label),
          fld('dd', field, money(value), `num ${strong ? 'strong' : ''}`),
        ];
  const taxes = inv.taxes.flatMap((t, i) => [
    h(
      'dt',
      {},
      `VAT ${t.rate !== undefined ? formatRate(t.rate) : ''}${t.base !== undefined ? ` of ${money(t.base)}` : ''}`,
    ),
    fld('dd', `taxes[${i}].amount`, money(t.amount), 'num'),
  ]);

  return h(
    'article',
    { class: 'paper', 'aria-label': 'The extracted invoice' },
    h(
      'header',
      { class: 'paper-head' },
      party('seller'),
      h(
        'div',
        { class: 'doc' },
        h('p', { class: 'doc-title' }, inv.lines.length || inv.total !== undefined ? 'Invoice' : 'Document'),
        h(
          'dl',
          { class: 'meta' },
          ...meta('Number', 'number', inv.number),
          ...meta('Issued', 'issueDate', inv.issueDate ? formatDate(inv.issueDate) : undefined),
          ...meta('Due', 'dueDate', inv.dueDate ? formatDate(inv.dueDate) : undefined),
          ...meta('Currency', 'currency', inv.currency),
          ...(inv.uuid ? meta(inv.seller.country === 'TR' ? 'ETTN' : 'UUID', 'uuid', inv.uuid) : []),
        ),
      ),
    ),
    h('div', { class: 'paper-parties' }, party('buyer')),
    inv.lines.length
      ? h(
          'div',
          { class: 'lines-scroll' },
          h(
            'table',
            { class: 'lines' },
            h(
              'thead',
              {},
              h(
                'tr',
                {},
                h('th', { class: 'num' }, '#'),
                h('th', {}, 'Description'),
                h('th', { class: 'num' }, 'Qty'),
                h('th', { class: 'num' }, 'Unit price'),
                h('th', { class: 'num' }, 'Amount'),
                h('th', { class: 'num' }, 'VAT'),
              ),
            ),
            h('tbody', {}, ...lines),
          ),
        )
      : h('p', { class: 'no-lines' }, 'No line items were extracted; only the totals are checked.'),
    h(
      'div',
      { class: 'paper-foot' },
      h(
        'div',
        { class: 'pay' },
        inv.iban
          ? h(
              'p',
              { class: 'id-line' },
              'Pay to ',
              fld('span', 'iban', formatIban(inv.iban.replace(/\s/g, '').toUpperCase()), 'mono'),
            )
          : null,
        inv.vatRate !== undefined
          ? h('p', { class: 'id-line' }, 'VAT rate ', fld('span', 'vatRate', formatRate(inv.vatRate)))
          : null,
      ),
      h(
        'dl',
        { class: 'sums' },
        ...sum('Subtotal', 'subtotal', inv.subtotal),
        ...sum(
          'Discount',
          'allowances',
          inv.allowances === undefined ? undefined : -Math.abs(inv.allowances),
        ),
        ...sum('Charges', 'charges', inv.charges),
        ...(taxes.length ? taxes : sum('VAT', 'vatTotal', inv.vatTotal)),
        ...(taxes.length ? sum('VAT total', 'vatTotal', inv.vatTotal) : []),
        ...sum('Total', 'total', inv.total, true),
        ...(inv.withholdingAmount !== undefined || inv.withholdingRate !== undefined
          ? [
              h(
                'dt',
                {},
                `Withheld VAT${inv.withholdingRate !== undefined ? ` (${Math.round(inv.withholdingRate * 10 * 100) / 100}/10)` : ''}`,
              ),
              fld(
                'dd',
                'withholdingAmount',
                inv.withholdingAmount !== undefined ? money(-inv.withholdingAmount) : '—',
                'num',
              ),
            ]
          : []),
        ...sum('Prepaid', 'prepaid', inv.prepaid === undefined ? undefined : -inv.prepaid),
        ...sum('Amount due', 'amountDue', inv.amountDue, true),
      ),
    ),
    h(
      'p',
      { class: 'paper-note' },
      'Rebuilt from the extracted data, not the original document. Hover a value to see where it came from.',
    ),
  );
}

function panel(r: LintResult): HTMLElement {
  const list = showAll ? r.findings : r.findings.filter((f) => f.status !== 'pass');
  const numbers = new Map(problems(r).map((f, i) => [f.id, i + 1]));
  const groups = GROUPS.map(([group, title]) => {
    const items = list.filter((f) => f.group === group).sort((a, b) => RANK[a.status] - RANK[b.status]);
    if (!items.length) return null;
    return h(
      'section',
      { class: 'group' },
      h('h3', {}, title),
      h('ul', { class: 'findings' }, ...items.map((f) => findingItem(f, numbers.get(f.id)))),
    );
  }).filter(Boolean) as HTMLElement[];
  const prompt = correctionPrompt(r);
  const copy = h('button', { class: 'button small primary', type: 'button' }, 'Copy correction prompt');
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      copy.textContent = 'Copied ✓';
    } catch {
      (document.querySelector('.prompt') as HTMLDetailsElement | null)?.setAttribute('open', '');
      copy.textContent = 'Select the text below to copy';
    }
    setTimeout(() => (copy.textContent = 'Copy correction prompt'), 2500);
  });
  return h(
    'aside',
    { class: 'panel' },
    h(
      'div',
      { class: 'panel-head' },
      h(
        'div',
        { class: 'view-toggle', role: 'group', 'aria-label': 'Which checks to show' },
        h(
          'button',
          {
            id: 'show-problems',
            type: 'button',
            'aria-pressed': String(!showAll),
            onclick: () => ((showAll = false), render()),
          },
          `Problems & notes (${r.findings.filter((f) => f.status !== 'pass').length})`,
        ),
        h(
          'button',
          {
            id: 'show-all',
            type: 'button',
            'aria-pressed': String(showAll),
            onclick: () => ((showAll = true), render()),
          },
          `All checks (${r.findings.length})`,
        ),
      ),
    ),
    groups.length
      ? h('div', { class: 'groups' }, ...groups)
      : h(
          'p',
          { class: 'all-clear' },
          '✓ No errors or warnings found. Switch to “All checks” to see which checks ran.',
        ),
    h(
      'section',
      { class: 'exports' },
      h('h3', {}, 'Send it back to the model'),
      h(
        'p',
        { class: 'fine' },
        'A prompt naming each wrong field, what the other values imply and the likely cause — for the LLM or reviewer that made the extraction.',
      ),
      copy,
      h('details', { class: 'prompt' }, h('summary', {}, 'Preview the prompt'), h('pre', {}, prompt)),
      h('h3', {}, 'Export'),
      h(
        'div',
        { class: 'export-buttons' },
        h(
          'button',
          {
            class: 'button small',
            type: 'button',
            onclick: () => download('ledger-lint-report.md', markdownReport(results), 'text/markdown'),
          },
          'Report (Markdown)',
        ),
        h(
          'button',
          {
            class: 'button small',
            type: 'button',
            onclick: () => download('ledger-lint-findings.csv', csvReport(results), 'text/csv'),
          },
          'Findings (CSV)',
        ),
        h(
          'button',
          {
            class: 'button small',
            type: 'button',
            onclick: () => download('ledger-lint-report.json', jsonReport(results)),
          },
          'Full report (JSON)',
        ),
      ),
      results.length > 1 ? h('p', { class: 'fine' }, `Exports cover all ${results.length} invoices.`) : null,
    ),
  );
}

function findingItem(f: Finding, n?: number): HTMLElement {
  const active = f.id === selected;
  return h(
    'li',
    {},
    h(
      'button',
      {
        type: 'button',
        id: `finding-${f.id}`,
        class: `finding s-${f.status} ${active ? 'active' : ''}`,
        'aria-expanded': String(active),
        onclick: () => {
          selected = active ? null : f.id;
          render();
        },
      },
      h('span', { class: 'status-icon', 'aria-label': STATUS_LABEL[f.status] }, ICON[f.status]),
      h(
        'span',
        { class: 'finding-body' },
        h(
          'span',
          { class: 'finding-title' },
          n ? h('span', { class: `marker s-${f.status}` }, String(n)) : null,
          f.title,
        ),
        h('span', { class: 'finding-message' }, f.message),
        active && (f.expected || f.found)
          ? h(
              'span',
              { class: 'compare' },
              f.found ? h('span', {}, h('em', {}, 'Extracted'), h('code', {}, f.found)) : null,
              f.expected ? h('span', {}, h('em', {}, 'Expected'), h('code', {}, f.expected)) : null,
            )
          : null,
        active && f.cause ? h('span', { class: 'cause' }, h('em', {}, 'Likely cause'), f.cause) : null,
        active && f.suggestion
          ? h('span', { class: 'suggestion' }, 'Suggested value ', h('code', {}, f.suggestion))
          : null,
        active && f.fields.length
          ? h('span', { class: 'fields' }, f.fields.map((x) => fieldLabel(x)).join(' · '))
          : null,
      ),
    ),
  );
}
