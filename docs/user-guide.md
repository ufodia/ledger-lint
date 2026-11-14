# User guide

## 1. Give it an extraction

Paste JSON into the box, click **Open a .json file**, or drop a file anywhere on the page. Then click **Check invoice** (or press Ctrl/⌘ + Enter).

| Input | Example |
| --- | --- |
| One invoice | `{ "invoice_number": "…", "line_items": [ … ], "total": … }` |
| Several invoices | `[ {…}, {…} ]` or `{ "invoices": [ … ] }` |
| JSON Lines | one invoice object per line |
| Azure AI Document Intelligence | a single-document `analyzeResult` (or object with `documents`) from a `prebuilt-invoice` call; split multi-document responses into separate fields objects |
| Google Document AI | the `document` (or the object with `entities`) returned by the invoice parser |

**Numbers** decides how strings like `"1.234"` are read; leave it on *detect automatically* unless the result says a number was ambiguous. **Reference date** is “today” for the future-date check — set it to the date the invoices were received when you re-check old extractions.

Inputs are limited to 20 MiB of UTF-8, 250 invoices, 40 nested levels, 100,000 JSON values and 10,000 entries per container. Absolute numeric values above 1 trillion are unsupported. Larger or deeper input shows an error; split it into smaller supported invoices.

**No extraction at hand?** Open a demo:

| Demo | What it shows |
| --- | --- |
| German agency invoice | a line read 1,000× too small, transposed VAT digits, an O in the IBAN — and no cascading errors |
| Turkish e-Fatura | Turkish field names and number format, an 18 % KDV rate that is no longer in force, tevkifat that was not deducted, an invalid VKN, “TL” instead of TRY |
| Azure Document Intelligence | a clean `prebuilt-invoice` result: everything adds up |
| Batch of 8 invoices | a duplicate, swapped dates, VAT missing from a total, a Greek `GR` prefix, a misread quantity, an ambiguous date and a Google Document AI result |

## 2. Read the result

The bar at the top gives the verdict — **Does not add up**, **Check the warnings** or **Adds up** — with the number of errors, warnings and passed checks, and how the input was read (format, decimal separator, number of mapped fields).

**Adds up** means the performed checks found no errors or warnings. It does not verify the original document, tax eligibility, registration, bank ownership or payment approval. A warning appears if there is not enough independent data for any arithmetic comparison.

### The rebuilt invoice

The left side shows the extracted data laid out as an invoice. It is **rebuilt from the JSON**, not the original document. Values involved in a problem are underlined in red (error), amber (warning) or blue (note); the field most likely to be wrong carries a numbered marker. Hover any value to see the JSON path it came from and, for strings, the exact text that was parsed. Click a marked value to open its finding.

### Findings

The right side lists findings by family: Arithmetic, Tax, Identifiers, Dates and Reading the data. Click one to expand it:

- **Extracted** and **Expected** values;
- **Likely cause** — the error signature that explains the difference;
- **Suggested value** — what the field should probably be;
- the fields involved, which are also outlined on the invoice.

**Problems & notes** shows errors, warnings and notes; **All checks** adds every check that passed.

Notes such as *“The subtotal is consistent once line 3 is corrected”* mean a proposed line correction explains the subtotal. Confirm that hypothesis against the original document.

### Batches

With more than one invoice, a table lists each with its seller, date, total, errors, warnings and verdict. Click a row (or focus it and press Enter) to open it. Duplicates are flagged on the later invoice.

## 3. Act on it

**Copy correction prompt** copies a message for the model that produced the extraction. It names each wrong field by its path in your JSON, says what the other values imply and why, gives the suggested value, and asks for the complete JSON again without inventing values. **Preview the prompt** shows the text.

| Export | Contents |
| --- | --- |
| Report (Markdown) | per-invoice verdicts and a table of errors and warnings — for tickets and reviews |
| Findings (CSV) | one row per error, warning or note, for filtering and sign-off |
| Full report (JSON) | the canonical invoice as read and every finding, including passed checks |

Exports always cover every invoice in the input. **Edit the JSON** returns to the input with your text; **New check** clears it.

## 4. Command line

```bash
npm run lint-invoice -- extraction.json --fail-on warning --csv findings.csv --prompt fix.txt
```

The Markdown report goes to standard output; exit code `0` means nothing reached `--fail-on` (default `error`), `1` means something did, `2` means a usage, input or report-write error. `--today` must be a real ISO calendar date; `--decimal` matches the app. Unknown options are rejected. Input and report destinations, or two report destinations, may not overlap, including resolved aliases and existing hard links. Collision checks happen before any report is written.

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| *This is not valid JSON* | the model may have wrapped the JSON in prose or a code fence; paste only the JSON |
| Most checks are missing | the field names were not recognised — look at **Fields not used** under *Reading the data* and rename them, or open an issue with the shape |
| A number was read 1,000× too large or small | set **Numbers** to the document's convention |
| A date is a month off | the date was ambiguous (04/05/2026); prefer ISO dates (`2026-05-04`) in your extraction prompt |
| A correct rate is flagged | rates change; open an issue with the official source and the date |
| “Two different IBANs” | the extraction contains a payment IBAN that differs from the seller's — confirm the bank details through a known channel before paying |
