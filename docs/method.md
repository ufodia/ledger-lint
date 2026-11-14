# Method

Ledger Lint answers one question: **are the values extracted from an invoice consistent with each other and with the rules they must follow?** It never sees the original document and never calls a model.

## 1. Mapping to one invoice

`src/core/map.ts` turns any supported input into a canonical `Invoice` (see [architecture](architecture.md)).

| Input | How it is recognised |
| --- | --- |
| Azure AI Document Intelligence | `documents[0].fields` (optionally under `analyzeResult`) whose fields carry `type` and `valueString` / `valueNumber` / `valueCurrency` / `valueArray` / `valueObject` |
| Google Document AI | `entities` (optionally under `document`) with `type` and `mentionText`; `line_item` and `vat` entities with `properties` become lines and VAT rows; `normalizedValue` money and dates are used when present |
| Any other JSON | field names are normalised (lower case, accents folded, punctuation removed) and looked up in alias tables for the document, the parties, the lines and the VAT rows — English, German and Turkish names such as `invoice_number`, `Rechnungsnummer`, `fatura_no`, `unit_price`, `birim_fiyat`, `kdv_orani` |

Containers such as `totals`, `summary`, `payment` and a single wrapper like `{ "invoice": { … } }` are flattened. Flat party fields (`vendor_name`, `supplierTaxId`, `alici_vkn`) are split into seller and buyer. Values like `{ "amount": 12, "currency": "EUR" }` are unwrapped. Every canonical field records the JSON path it came from.

### Numbers

`parseAmount` accepts numbers and strings with currency symbols, spaces, apostrophes, parentheses and trailing minus signs. When both `.` and `,` appear, the last one is the decimal separator. A single separator followed by exactly three digits (`1.234`, `1,234`) has two readings: the **document's convention** decides and a warning is recorded. The convention is inferred from the other number strings in the document, then from the seller's country (comma in most of the EU, Norway and Türkiye) and the currency, or set explicitly with the “Numbers” option or `--decimal`.

Rates may be `19`, `"19%"`, `"%20"` (Turkish style), `0.19` or `"0,19"`. Withholding may be `"5/10"`, `0.5` or `50`.

### Dates

ISO dates (with or without time), `dd.mm.yyyy`, `yyyy/mm/dd`, written months in English, German, French, Spanish, Italian and Turkish, and slash dates. A slash date whose day and month are both 12 or less is **ambiguous**: it is read day-first (month-first for US sellers) and flagged. Impossible dates such as 30 February are errors.

## 2. Checks

Amounts are compared in the currency's minor unit `u` (0.01 for EUR, 1 for JPY, 0.001 for KWD).

| Check | Rule | Pass | Rounding warning | Error |
| --- | --- | --- | --- | --- |
| Line amount | `qty × price − discount` | within `u/2 + |qty| × step/2`, where `step` is the precision the unit price is written with | — | beyond |
| Line VAT, line gross | `net × rate`, `net + VAT` | within `u` | — | beyond |
| Subtotal | sum of line amounts (± document discounts and charges) | within `u/2` | within `n × u/2` for `n` lines | beyond |
| VAT total | sum of the VAT breakdown, or per rate `round(Σ net × rate)`, or document rate × subtotal | within `u/2` | within `n × u/2` | beyond |
| VAT row | `base × rate`; base vs. lines at that rate | within `u/2` | within `u` (base: `n × u/2`) | beyond |
| Total | subtotal (± discounts and charges) + VAT | within `u/2` | — | beyond |
| Amount due | total − prepaid − withheld VAT | within `u/2` | — | beyond |
| Withholding | `VAT × fraction`, fraction must be k/10 | within `u/2` | within `u` | beyond |

When prices include VAT (`prices_include_vat`), line amounts are gross and are compared with the total instead.

**No cascades.** If a line amount is wrong, the subtotal is re-checked with the expected line amount; if it then matches, the subtotal is reported as *consistent once line N is corrected* (a note), not as a second error. The same applies to the total after a wrong VAT total.

### Tax rules

`src/core/rates.ts` lists VAT rates with the dates they apply for the EU-27, the United Kingdom, Switzerland, Norway and Türkiye, compiled in November 2026 from the European Commission's Taxes in Europe Database and national announcements. Among the dated changes: Türkiye 18 % → 20 % and 8 % → 10 % on 10 July 2023; Czechia's 10/15 % → 12 % in 2024; Finland 24 % → 25.5 % (September 2024) and 14 % → 13.5 % (2026); Slovakia 20 % → 23 % (2025); Estonia 22 % → 24 % (July 2025); Romania 19 % → 21 % (August 2025); Lithuania's 9 % rate ending in 2025; Austria's 4.9 % from July 2026.

A rate that is not in force for the seller's country on the issue date is a **warning**; a rate that was valid at another time says so. 0 % is always accepted. When the printed VAT total only matches if a line's out-of-date rate is replaced by a current one, that is reported as the cause.

A seller and a business buyer in two different EU countries with VAT charged produce an informational reverse-charge hint.

### Identifiers

| Identifier | Check |
| --- | --- |
| IBAN | country length (88 countries) and ISO 13616 mod 97. If exactly one look-alike substitution (O→0, I→1, S→5, B→8, Z→2, G→6, 8↔3 …) or adjacent swap makes it valid, that is proposed. |
| EU VAT number | country format for the EU-27, XI, GB, CH and NO; check digits for AT, BE, DE, DK, FI, FR (numeric keys), IT, LU, NL (both the classic and the 2020 mod-97 form), PL, PT and SE, tested against published examples. `GR…` is flagged: Greece uses `EL`. |
| VKN | 10 digits; the Revenue Administration's check-digit algorithm (verified against published examples). |
| TCKN | 11 digits, not starting with 0, two check digits. |
| ETTN / UUID | 8-4-4-4-12 hexadecimal format. |

Further rules: the VAT number's country should match the party's country; seller and buyer must not share a tax number or IBAN; two different IBANs for the seller are flagged as a common invoice-fraud pattern; an e-Fatura number (`ABC2026000000137`) should carry the year of the issue date.

### Dates and document

Due date before the issue date (error), issue date after the reference date, payment terms over 365 days, service periods that end before they start, a missing invoice number or currency, amounts with more decimals than the currency has, and duplicates across a batch (same seller and number, or same seller, date and total).

## 3. Diagnosis

`src/core/diagnose.ts` compares the extracted value with the value the other fields imply, in this order:

1. extracted 0 — the field was not read;
2. the sign is flipped;
3. a factor of 10, 100 or 1,000 — decimal separators (1,000× too small is the classic `1.230,00 → 1.23`);
4. the digits in minor units: two adjacent digits transposed, two digits swapped, one digit different (with the common OCR pairs 1↔7, 3↔8, 5↔6, 6↔8, 0↔8, 0↔6, 0↔9, 4↔9, 5↔8, 2↔7, 1↔4, 3↔5 named), one digit dropped or added;
5. the value with or without a VAT rate in play — gross taken for net, net for gross, or the VAT amount for the net;
6. equal to another field — copied from the wrong place.

For a sum, a difference equal to one line means that line is missing or extra. For a line, the amount is tested first, then the unit price implied by `amount ÷ quantity`, then a whole-number quantity implied by `amount ÷ price`; the first field whose implied value has a recognisable error signature is named as the likely culprit and its implied value suggested.

## 4. Verdict

| Verdict | Condition |
| --- | --- |
| **Does not add up** | at least one error |
| **Check the warnings** | warnings, no errors |
| **Adds up** | only passed checks and notes |

## What the method cannot tell you

- A value that was misread consistently everywhere it appears passes every check.
- The original document may itself be wrong; the correction prompt asks the model to keep printed values it can confirm.
- VAT tables are plausibility checks. Reduced rates depend on the goods or services, which Ledger Lint does not classify.
- Identifiers are checked offline; a well-formed VAT number or IBAN may still not exist or not belong to the seller.
