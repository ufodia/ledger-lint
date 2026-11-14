# Privacy

Invoices carry names, addresses, tax numbers, bank accounts and prices. Ledger Lint never sends them anywhere.

| Behaviour | How it is implemented |
| --- | --- |
| No upload | Pasted text and opened files are parsed with `JSON.parse` and checked in the tab. There is no server endpoint. The production configuration sends `Content-Security-Policy: connect-src 'none'`, which blocks `fetch`, XHR, WebSocket, EventSource and beacons. |
| No model calls | Every check is deterministic code. No AI service is contacted; the correction prompt is text for you to send. |
| No online lookups | VAT numbers and IBANs are validated offline (formats and check digits). There are no VIES, GİB or bank queries. |
| No third-party code | `default-src 'self'` and zero runtime dependencies. No analytics, fonts or CDNs. |
| No storage | Nothing is written to cookies, `localStorage`, `sessionStorage` or IndexedDB. Reloading the tab discards everything. |
| Nothing executes | Values are inserted as text nodes, never as HTML. CSV exports neutralise cells that a spreadsheet would treat as formulas. |
| Local exports | Reports are created in the tab and saved through the browser's downloads; the prompt goes to your clipboard only when you click **Copy**. |

## What remains your responsibility

- **Exports and the correction prompt** contain invoice data. Share them as you would the invoice — and mind where you paste the prompt.
- **Your device** — browser extensions with page access, clipboard managers and security software that injects scripts into pages are outside the app's control.
- **Hosting** — keep the headers from [`vercel.json`](../vercel.json) when self-hosting (see [deployment](deployment.md)). The Vite development server does not send them; the app still never sends invoice data anywhere.

Report a way to make the page send data, or to execute content from an input, privately as described in [SECURITY.md](../SECURITY.md).
