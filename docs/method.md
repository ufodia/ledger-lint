# Method

Ledger Lint asks whether supported extracted values are consistent with each other and with its bundled plausibility rules. It never sees the original document and never calls a model. Findings are review evidence; a clean result does not establish that the source invoice is correct, genuine, legally compliant or payable.

## 1. Mapping to one invoice

`src/core/map.ts` turns any supported input into a canonical `Invoice` (see [architecture](architecture.md)).

| Input | How it is recognised |
| --- | --- |
| Azure AI Document Intelligence | `documents[0].fields` (optionally under `analyzeResult`) whose fields carry `type` and `valueString` / `valueNumber` / `valueCurrency` / `valueArray` / `valueObject` |
| Google Document AI | `entities` (optionally under `document`) with `type` and `mentionText`; `line_item` and `vat` entities with `properties` become lines and VAT rows; `normalizedValue` money and dates are used when present |
| Any other JSON | field names are normalised (lower case, accents folded, punctuation removed) and looked up in alias tables for the document, the parties, the lines and the VAT rows — English, German and Turkish names such as `invoice_number`, `Rechnungsnummer`, `fatura_no`, `unit_price`, `birim_fiyat`, `kdv_orani` |

Containers such as `totals`, `summary`, `payment` and a single wrapper like `{ "invoice": { … } }` are flattened. Flat party fields (`vendor_name`, `supplierTaxId`, `alici_vkn`) are split into seller and buyer. Values like `{ "amount": 12, "currency": "EUR" }` are unwrapped. Mapped values retain JSON-style source paths: Azure paths include `valueArray`, `valueObject` and typed value wrappers; Google paths include entity/property indexes and the normalized value or mention used. Composite Google money/date values point to the original composite object. These are descriptive paths rather than a general JSONPath query interface.

A multi-document Azure response is rejected to avoid silently reviewing only its first document. Submit each document's fields object separately.

### Numbers

`parseAmount` accepts numbers and strings with currency symbols, spaces, apostrophes, parentheses and trailing minus signs. When both `.` and `,` appear, the last one is the decimal separator. A single separator followed by exactly three digits (`1.234`, `1,234`) has two readings: the **document's convention** decides and a warning is recorded. The convention is inferred from the other number strings in the document, then from the seller's country (comma in most of the EU, Norway and Türkiye) and the currency, or set explicitly with the “Numbers” option or `--decimal`.

Rates may be `19`, `"19%"`, `"%20"` (Turkish style), `0.19` or `"0,19"`. Withholding may be `"5/10"`, `0.5` or `50`.

Malformed grouping, repeated decimal separators, non-finite values and absolute numeric inputs above 1 trillion are rejected. VAT percentages outside 0–100 and withholding fractions outside 0–1 are reading errors. An explicit percent sign is respected for small withholding percentages: `"1%"` means `0.01`, while the fraction `1` means full withholding.

The engine uses JavaScript binary64 numbers and decimal half-up rounding, including exponent-form numbers. It is not an arbitrary-precision ledger. Values and intermediate operations can lose precision, and comparisons intentionally allow tolerances; confirm high-value or precision-sensitive results independently.

Browser, CLI and library entry points enforce 250 invoices per batch, 40 nested levels, 100,000 JSON values and 10,000 entries per container. Text/file input is limited to 20 MiB of UTF-8. Cyclic objects and unsupported batch members are rejected before recursive mapping.

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

`src/core/rates.ts` is a bundled country/rate reference for the EU-27, the United Kingdom, Switzerland, Norway and Türkiye, with selected date windows. It does not model every historical period, territory, product category, exemption or special regime and is not updated online. An open-ended entry is a table convention, not a guarantee that a rate remains current or applied throughout history.

A rate outside the table's date window or absent from the seller-country reference produces a **warning**. A known older entry can suggest a date or rate extraction issue. Zero is always accepted for plausibility, without establishing an exemption. A matching listed rate is not proof that the invoice uses the correct tax treatment.

For current rules, consult the European Commission's [VAT rates guidance](https://taxation-customs.ec.europa.eu/taxation/vat/vat-directive/vat-rates_en) and [Taxes in Europe database](https://ec.europa.eu/taxation_customs/tedb/index.html), or the relevant national authority. The Commission explains that rate categories and special provisions depend on the goods or services and jurisdiction. Rate-table changes in this repository require an official source and effective date.

A seller and a business buyer in two different EU countries with VAT charged produce an informational review hint. The app does not determine transaction type, place of supply, registration or reverse-charge eligibility.

### Identifiers

| Identifier | Check |
| --- | --- |
| IBAN | country length (88 countries) and ISO 13616 mod 97. If exactly one look-alike substitution (O→0, I→1, S→5, B→8, Z→2, G→6, 8↔3 …) or adjacent swap makes it valid, that is proposed. |
| EU VAT number | country format for the EU-27, XI, GB, CH and NO; check digits for AT, BE, DE, DK, FI, FR (numeric keys), IT, LU, NL (both the classic and the 2020 mod-97 form), PL, PT and SE, tested against published examples. `GR…` is flagged: Greece uses `EL`. |
| VKN | 10 digits; the Revenue Administration's check-digit algorithm (verified against published examples). |
| TCKN | 11 digits, not starting with 0, two check digits. |
| ETTN / UUID | 8-4-4-4-12 hexadecimal format. |

Further heuristics flag a VAT-prefix/country mismatch, matching seller/buyer tax numbers or IBANs, different seller/payment IBANs and an e-Fatura number year that differs from the issue date. These can have legitimate explanations and require source review. No finding establishes fraud.

Offline identifier checks do not establish existence, active registration or account ownership. [VIES](https://europa.eu/youreurope/business/finance-and-tax/vat/check-vat-number-vies/index_en.htm) performs a separate VAT-information lookup; Ledger Lint does not call it. National IBAN format references are published in [SWIFT's ISO 13616 registry](https://www.swift.com/standards/data-standards/iban-international-bank-account-number); this app uses its own bundled supported-length table.

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
| **Adds up** | only passed checks and notes; at least one independent arithmetic comparison was possible |

If no independent arithmetic comparison can be performed, a warning explains the missing coverage. Checks requiring absent values are not silently counted as passed. Fix the reference date with the UI or `--today` to reproduce date-sensitive findings.

## What the method cannot tell you

- A value that was misread consistently everywhere it appears passes every check.
- The original document may itself be wrong; the correction prompt asks the model to keep printed values it can confirm.
- VAT tables are plausibility checks. Reduced rates depend on the goods or services, which Ledger Lint does not classify.
- Identifiers are checked offline; a well-formed VAT number or IBAN may still not exist or not belong to the seller.
