/** Shared resource limits for browser, CLI and library entry points. */
export const MAX_INPUT_BYTES = 20 * 1024 * 1024;
export const MAX_INVOICES = 250;

export function assertJsonTree(input: unknown): void {
  const stack: { value: unknown; depth: number; leaving?: boolean }[] = [{ value: input, depth: 0 }];
  const objects = new WeakSet<object>();
  let count = 0;
  while (stack.length) {
    const { value, depth, leaving } = stack.pop()!;
    if (leaving) {
      objects.delete(value as object);
      continue;
    }
    if (++count > 100_000) throw new Error('Input exceeds 100,000 JSON values. Split the batch.');
    if (depth > 40) throw new Error('Input nesting exceeds 40 levels.');
    if (value === null || value === undefined) continue;
    if (typeof value === 'number' && !Number.isFinite(value))
      throw new Error('Input contains a number outside the finite numeric range.');
    if (typeof value !== 'object') {
      if (!['string', 'number', 'boolean'].includes(typeof value))
        throw new Error('Input must contain JSON-compatible values.');
      continue;
    }
    if (objects.has(value)) throw new Error('Input contains a circular reference.');
    objects.add(value);
    const children = Array.isArray(value) ? value : Object.values(value);
    if (children.length > 10_000) throw new Error('An input container exceeds 10,000 values.');
    stack.push({ value, depth, leaving: true });
    for (const child of children) stack.push({ value: child, depth: depth + 1 });
  }
}

export function assertInvoices(items: unknown[]): void {
  if (!items.length) throw new Error('No invoices were found in the input.');
  if (items.length > MAX_INVOICES) throw new Error(`A batch may contain at most ${MAX_INVOICES} invoices.`);
  if (items.some((item) => !item || typeof item !== 'object' || Array.isArray(item)))
    throw new Error('Each invoice must be a JSON object.');
  assertJsonTree(items);
}
