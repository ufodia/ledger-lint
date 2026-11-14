/** The canonical invoice every input format is mapped to. Amounts are numbers, rates are percentages. */

export interface Party {
  name?: string;
  /** VAT identification number, usually with a country prefix (DE…, FR…, EL…). */
  vatId?: string;
  /** National tax number, e.g. a Turkish VKN or TCKN. */
  taxId?: string;
  iban?: string;
  /** ISO 3166 alpha-2 code. */
  country?: string;
  address?: string;
}

export interface Line {
  description?: string;
  quantity?: number;
  unitPrice?: number;
  discount?: number;
  netAmount?: number;
  vatRate?: number;
  vatAmount?: number;
  grossAmount?: number;
}

export interface TaxRow {
  rate?: number;
  base?: number;
  amount?: number;
}

export interface Invoice {
  number?: string;
  /** e-Fatura ETTN or another document UUID. */
  uuid?: string;
  issueDate?: string;
  dueDate?: string;
  deliveryDate?: string;
  periodStart?: string;
  periodEnd?: string;
  currency?: string;
  seller: Party;
  buyer: Party;
  lines: Line[];
  taxes: TaxRow[];
  /** A single document-level VAT rate, when the extraction gives one. */
  vatRate?: number;
  subtotal?: number;
  allowances?: number;
  charges?: number;
  vatTotal?: number;
  total?: number;
  prepaid?: number;
  amountDue?: number;
  /** Turkish VAT withholding (KDV tevkifatı) as a fraction, e.g. 0.5 for 5/10. */
  withholdingRate?: number;
  withholdingAmount?: number;
  pricesIncludeVat?: boolean;
  /** Payment account, when given separately from the seller. */
  iban?: string;
}

export type Level = 'error' | 'warning' | 'info';

export interface Note {
  /** Canonical path, e.g. "lines[2].netAmount". */
  field: string;
  level: Level;
  message: string;
}

export interface Mapped {
  invoice: Invoice;
  /** Canonical path → path in the input JSON, e.g. "lines[2].netAmount" → "$.items[2].amount". */
  sources: Record<string, string>;
  /** Canonical path → the text a value was parsed from, when it was a string. */
  raw: Record<string, string>;
  notes: Note[];
  /** Input paths that were not used. */
  unused: string[];
  format: 'generic' | 'azure' | 'google';
  /** Decimal separator assumed for ambiguous number strings. */
  decimal: '.' | ',';
}
