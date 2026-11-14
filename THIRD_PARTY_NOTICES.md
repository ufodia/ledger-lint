# Third-party notices

Ledger Lint's source code, documentation and artwork are MIT-licensed © 2026 ufodia.

## Runtime dependencies

None. Parsing, checks, diagnosis and reports are implemented in this repository.

## Development tools

Vite, TypeScript, Vitest, Playwright, tsx and Prettier build, run and test the project and are not shipped to users. Exact versions are pinned in `package-lock.json`.

## Reference data

- Supported IBAN lengths are bundled format reference data; the authoritative registry is published by [SWIFT](https://www.swift.com/standards/data-standards/iban-international-bank-account-number).
- VAT rates are a bundled plausibility reference with selected date windows. They are not a live or complete tax service. Consult [official EU guidance](https://taxation-customs.ec.europa.eu/taxation/vat/vat-directive/vat-rates_en) and the relevant national authority. See [the method](docs/method.md) for coverage and limits.
- Check-digit algorithms are public; test vectors are published examples.

## Demo data

The invoices in `src/demo.ts` and `examples/` are invented. Identifiers are published test values or numbers computed to have valid check digits, except where an error is deliberately planted. Azure and Google are trademarks of their owners; Ledger Lint is not affiliated with them or with the Turkish Revenue Administration.
