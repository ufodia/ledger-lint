# Third-party notices

Ledger Lint's source code, documentation and artwork are MIT-licensed © 2026 ufodia.

## Runtime dependencies

None. Parsing, checks, diagnosis and reports are implemented in this repository.

## Development tools

Vite, TypeScript, Vitest, Playwright, tsx and Prettier build, run and test the project and are not shipped to users. Exact versions are pinned in `package-lock.json`.

## Reference data

- IBAN lengths follow the SWIFT IBAN Registry.
- VAT rates were compiled in November 2026 from the European Commission's Taxes in Europe Database and national announcements; Türkiye's rates follow Presidential Decree 7346 (July 2023). They are facts, not copyrighted material, and are provided without warranty.
- Check-digit algorithms are public; test vectors are published examples.

## Demo data

The invoices in `src/demo.ts` and `examples/` are invented. Identifiers are published test values or numbers computed to have valid check digits, except where an error is deliberately planted. Azure and Google are trademarks of their owners; Ledger Lint is not affiliated with them or with the Turkish Revenue Administration.
