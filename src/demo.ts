/**
 * Demo extractions. The companies, people and documents are invented; identifiers are either
 * published test values or computed to have valid check digits, except where an error is planted.
 */

/** An LLM's JSON for a German agency invoice. Planted: line 3 read 1,000× too small, VAT digits transposed, an O in the IBAN. */
export const euInvoice = {
  invoice_number: 'RE-2026-0418',
  invoice_date: '2026-11-03',
  due_date: '2026-12-03',
  currency: 'EUR',
  seller: {
    name: 'Nordlicht Studio GmbH',
    vat_id: 'DE136695976',
    iban: 'DE89 3704 0044 O532 0130 00',
    country: 'DE',
    address: 'Speicherstraße 12, 20457 Hamburg',
  },
  buyer: { name: 'Atelier Brune SARL', vat_id: 'FR40303265045', country: 'FR' },
  line_items: [
    { description: 'Brand workshop (2 days)', quantity: 2, unit_price: 1450, amount: 2900, vat_rate: 19 },
    { description: 'Logo system and guidelines', quantity: 1, unit_price: 3200, amount: 3200, vat_rate: 19 },
    {
      description: 'Photography licence, 12 images',
      quantity: 12,
      unit_price: 102.5,
      amount: 1.23,
      vat_rate: 19,
    },
    {
      description: 'Print production, 500 brochures',
      quantity: 500,
      unit_price: 1.84,
      amount: 920,
      vat_rate: 19,
    },
  ],
  subtotal: 8250,
  tax_total: 1576.5,
  total: 9817.5,
  amount_due: 9817.5,
};

/** An LLM's JSON for a Turkish e-Fatura, with Turkish field names and Turkish number formatting. */
export const trInvoice = {
  fatura_no: 'NLS2026000000137',
  ettn: '3f2c9a4e-8b1d-4c6f-9a2e-71d5b0c4e8f1',
  fatura_tarihi: '12.10.2026',
  vade_tarihi: '11.11.2026',
  para_birimi: 'TL',
  satici: {
    unvan: 'Nilüfer Lojistik A.Ş.',
    vkn: '7310045825',
    iban: 'TR33 0006 1005 1978 6457 8413 26',
    ulke: 'Türkiye',
  },
  alici: { unvan: 'Ege Tekstil Ltd. Şti.', vkn: '2688154098', ulke: 'Türkiye' },
  kalemler: [
    {
      aciklama: 'Konteyner taşıma (İzmir–Bursa)',
      miktar: 3,
      birim_fiyat: '18.500,00',
      tutar: '55.500,00',
      kdv_orani: '%20',
    },
    {
      aciklama: 'Depolama (palet × gün)',
      miktar: 240,
      birim_fiyat: '42,50',
      tutar: '10.200,00',
      kdv_orani: '%20',
    },
    {
      aciklama: 'Gümrük müşavirlik hizmeti',
      miktar: 1,
      birim_fiyat: '7.500,00',
      tutar: '7.500,00',
      kdv_orani: '%18',
    },
  ],
  mal_hizmet_toplam_tutari: '73.200,00',
  hesaplanan_kdv: '14.640,00',
  tevkifat: { oran: '2/10', tutar: '2.928,00' },
  vergiler_dahil_toplam_tutar: '87.840,00',
  odenecek_tutar: '87.840,00',
};

const money = (amount: number) => ({
  type: 'currency',
  valueCurrency: { amount, currencyCode: 'EUR' },
  confidence: 0.97,
});
const str = (valueString: string) => ({
  type: 'string',
  valueString,
  content: valueString,
  confidence: 0.98,
});
const item = (description: string, quantity: number, unitPrice: number, amount: number) => ({
  type: 'object',
  valueObject: {
    Description: str(description),
    Quantity: { type: 'number', valueNumber: quantity, content: String(quantity) },
    UnitPrice: money(unitPrice),
    Amount: money(amount),
    TaxRate: str('21%'),
  },
});

/** An Azure AI Document Intelligence "prebuilt-invoice" result for a Dutch supplier. Clean. */
export const azureInvoice = {
  apiVersion: '2024-11-30',
  modelId: 'prebuilt-invoice',
  documents: [
    {
      docType: 'invoice',
      confidence: 1,
      fields: {
        InvoiceId: str('INV-88412'),
        InvoiceDate: { type: 'date', valueDate: '2026-10-28', content: '28-10-2026' },
        DueDate: { type: 'date', valueDate: '2026-11-27', content: '27-11-2026' },
        VendorName: str('Kanaal Kantoorartikelen B.V.'),
        VendorTaxId: str('NL004495445B01'),
        VendorAddress: {
          type: 'address',
          content: 'Prinsengracht 263, 1016 GV Amsterdam',
          valueAddress: { city: 'Amsterdam', countryRegion: 'NLD' },
        },
        CustomerName: str('Studio Veld'),
        Items: {
          type: 'array',
          valueArray: [
            item('Ergonomic office chair', 4, 289, 1156),
            item('Monitor arm, single', 4, 64.9, 259.6),
            item('A4 paper 80 g, box of 5 reams', 10, 24.99, 249.9),
            item('LED desk lamp', 3, 61.7, 185.1),
          ],
        },
        SubTotal: money(1850.6),
        TotalTax: money(388.63),
        InvoiceTotal: money(2239.23),
        AmountDue: money(2239.23),
        PaymentDetails: {
          type: 'array',
          valueArray: [{ type: 'object', valueObject: { IBAN: str('NL20INGB0001234567') } }],
        },
      },
    },
  ],
};

const buyer = { name: 'Harbour Coffee Roasters Ltd', country: 'GB' };
const gbInvoice = {
  invoice_number: 'BB-10442',
  issue_date: '2026-10-02',
  due_date: '2026-11-01',
  currency: 'GBP',
  supplier: { name: 'Bean & Burr Supplies Ltd', vat_number: 'GB980780684', country: 'GB' },
  customer: buyer,
  items: [
    { description: 'Espresso blend, 1 kg', quantity: 24, unit_price: 18.5, total: 444 },
    { description: 'Paper cups 8 oz, case of 1,000', quantity: 6, unit_price: 32, total: 192 },
  ],
  subtotal: 636,
  vat_rate: 20,
  vat_amount: 127.2,
  total: 763.2,
};

/** Eight extractions for one café's accounts payable inbox. */
export const batch: unknown[] = [
  gbInvoice,
  { ...gbInvoice, issue_date: '2026-10-09', due_date: '2026-11-08' },
  {
    invoice_number: 'KC-2026-311',
    issue_date: '2026-10-30',
    due_date: '2026-09-30',
    currency: 'EUR',
    supplier: { name: 'Kettle & Co GmbH', vat_number: 'DE136695976', country: 'DE' },
    customer: buyer,
    items: [{ description: 'Milk jug 600 ml', quantity: 12, unit_price: 9.8, total: 117.6 }],
    subtotal: 117.6,
    vat_rate: 19,
    vat_amount: 22.34,
    total: 139.94,
  },
  {
    invoice_number: 'RW-77120',
    issue_date: '2026-10-21',
    due_date: '2026-11-20',
    currency: 'EUR',
    supplier: { name: 'Roastworks Nederland B.V.', vat_number: 'NL004495445B01', country: 'NL' },
    customer: buyer,
    items: [
      { description: 'Green beans, Colombia Huila, 60 kg', quantity: 1, unit_price: 540, total: 540 },
      { description: 'Freight', quantity: 1, unit_price: 45, total: 45 },
    ],
    subtotal: 585,
    vat_rate: 9,
    vat_amount: 52.65,
    total: 585,
  },
  {
    invoice_number: 'AC-0938',
    issue_date: '2026-10-12',
    due_date: '2026-11-11',
    currency: 'EUR',
    supplier: { name: 'Aegean Ceramics IKE', vat_number: 'GR094259216', country: 'GR' },
    customer: buyer,
    items: [{ description: 'Stoneware cups, 180 ml', quantity: 48, unit_price: 6.5, total: 312 }],
    subtotal: 312,
    vat_rate: 24,
    vat_amount: 74.88,
    total: 386.88,
  },
  {
    invoice_number: 'SOD-5521',
    issue_date: '2026-10-18',
    due_date: '2026-10-25',
    currency: 'GBP',
    supplier: { name: 'Sweet Oat Dairy Ltd', vat_number: 'GB980780684', country: 'GB' },
    customer: buyer,
    items: [
      { description: 'Oat milk, barista, 1 l', quantity: 18, unit_price: 4.2, total: 54.6 },
      { description: 'Almond milk, 1 l', quantity: 6, unit_price: 4.6, total: 27.6 },
    ],
    subtotal: 82.2,
    vat_rate: 0,
    vat_amount: 0,
    total: 82.2,
  },
  {
    invoice_number: 'BT-2290',
    issue_date: '04/05/2026',
    due_date: '2026-06-04',
    currency: 'GBP',
    supplier: { name: 'Brew Tools Ltd', vat_number: 'GB980780684', country: 'GB' },
    customer: buyer,
    items: [{ description: 'Grinder burr set, 64 mm', quantity: 2, unit_price: 85, total: 170 }],
    subtotal: 170,
    vat_rate: 20,
    vat_amount: 34,
    total: 204,
  },
  {
    document: {
      entities: [
        { type: 'invoice_id', mentionText: 'LL-5521' },
        {
          type: 'invoice_date',
          mentionText: '15 Oct 2026',
          normalizedValue: { text: '2026-10-15', dateValue: { year: 2026, month: 10, day: 15 } },
        },
        {
          type: 'due_date',
          mentionText: '14 Nov 2026',
          normalizedValue: { text: '2026-11-14', dateValue: { year: 2026, month: 11, day: 14 } },
        },
        { type: 'supplier_name', mentionText: 'Liffey Linen Ltd' },
        { type: 'supplier_tax_id', mentionText: 'IE6388047V' },
        { type: 'receiver_name', mentionText: 'Harbour Coffee Roasters Ltd' },
        { type: 'currency', mentionText: '€', normalizedValue: { text: 'EUR' } },
        {
          type: 'line_item',
          mentionText: 'Barista aprons 10 22.00 220.00',
          properties: [
            { type: 'line_item/description', mentionText: 'Barista aprons, waxed canvas' },
            { type: 'line_item/quantity', mentionText: '10' },
            { type: 'line_item/unit_price', mentionText: '22.00' },
            { type: 'line_item/amount', mentionText: '220.00' },
          ],
        },
        {
          type: 'vat',
          mentionText: 'VAT 23% 50.60',
          properties: [
            { type: 'vat/tax_rate', mentionText: '23%' },
            { type: 'vat/tax_amount', mentionText: '50.60' },
          ],
        },
        {
          type: 'net_amount',
          mentionText: '220.00',
          normalizedValue: { text: '220', moneyValue: { currencyCode: 'EUR', units: '220' } },
        },
        {
          type: 'total_tax_amount',
          mentionText: '50.60',
          normalizedValue: {
            text: '50.6',
            moneyValue: { currencyCode: 'EUR', units: '50', nanos: 600000000 },
          },
        },
        {
          type: 'total_amount',
          mentionText: '270.60',
          normalizedValue: {
            text: '270.6',
            moneyValue: { currencyCode: 'EUR', units: '270', nanos: 600000000 },
          },
        },
      ],
    },
  },
];

export interface Demo {
  id: string;
  label: string;
  note: string;
  data: unknown;
}

export const DEMOS: Demo[] = [
  { id: 'eu', label: 'German agency invoice', note: 'LLM JSON · EUR · 3 planted errors', data: euInvoice },
  { id: 'tr', label: 'Turkish e-Fatura', note: 'Turkish field names · TRY · KDV tevkifatı', data: trInvoice },
  {
    id: 'azure',
    label: 'Azure Document Intelligence',
    note: 'prebuilt-invoice result · clean',
    data: azureInvoice,
  },
  {
    id: 'batch',
    label: 'Batch of 8 invoices',
    note: 'duplicates, swapped dates, missing VAT, Google Document AI',
    data: batch,
  },
];
