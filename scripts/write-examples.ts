/** Writes the demo extractions to examples/ so they can be used with the command line. */
import { mkdir, writeFile } from 'node:fs/promises';
import { azureInvoice, batch, euInvoice, trInvoice } from '../src/demo.ts';

const files: [string, unknown][] = [
  ['examples/eu-invoice.json', euInvoice],
  ['examples/tr-efatura.json', trInvoice],
  ['examples/azure-invoice.json', azureInvoice],
  ['examples/batch.json', batch],
];
await mkdir('examples', { recursive: true });
for (const [file, data] of files) {
  await writeFile(file, JSON.stringify(data, null, 2) + '\n');
  console.log(`Wrote ${file}`);
}
