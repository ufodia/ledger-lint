/**
 * Maps extraction output to the canonical Invoice: plain JSON from an LLM (any reasonable field
 * names in English, German or Turkish), Azure AI Document Intelligence "prebuilt-invoice" results
 * and Google Document AI invoice entities.
 */
import { parseDate } from './dates.ts';
import type { Invoice, Line, Mapped, Note, Party, TaxRow } from './model.ts';
import { parseAmount, parseFraction, parseRate, type DecimalHint } from './numbers.ts';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Obj = { [key: string]: Json };

export interface MapOptions {
  /** Decimal separator for ambiguous strings such as "1.234". Inferred when omitted. */
  decimal?: '.' | ',';
}

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** "Invoice No.", "invoice_number" and "faturaNumarası" all become "invoiceno" / "invoicenumber" / "faturanumarasi". */
export const keyOf = (k: string) =>
  k
    .toLocaleLowerCase('en')
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/ä/g, 'a')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9%]/g, '');

const table = (entries: Record<string, string>) => {
  const out = new Map<string, string>();
  for (const [canonical, keys] of Object.entries(entries))
    for (const k of keys.split(' ')) out.set(k, canonical);
  return out;
};

const DOC = table({
  number:
    'invoicenumber invoiceno invoicenum invoiceid documentnumber docnumber documentno number no faturano faturanumarasi belgeno rechnungsnummer rechnungsnr numero numerofacture',
  uuid: 'uuid ettn guid documentuuid',
  issueDate:
    'issuedate invoicedate date documentdate dateofissue issued faturatarihi duzenlemetarihi rechnungsdatum datefacture',
  dueDate: 'duedate paymentduedate paymentdue payby vadetarihi sonodemetarihi faelligkeitsdatum faelligam',
  deliveryDate:
    'deliverydate servicedate supplydate taxpointdate actualdeliverydate leistungsdatum sevktarihi teslimtarihi',
  periodStart: 'periodstart servicestartdate servicestart billingperiodstart',
  periodEnd: 'periodend serviceenddate serviceend billingperiodend',
  currency:
    'currency currencycode documentcurrency documentcurrencycode parabirimi dovizcinsi waehrung devise',
  subtotal:
    'subtotal net nettotal totalnet netamount taxexclusiveamount lineextensionamount totalexcltax totalexclvat amountexcludingtax totalbeforetax aratoplam maltoplamtutari malhizmettoplamtutari nettobetrag summenetto',
  vatTotal:
    'totaltax taxtotal vattotal totalvat taxamount vatamount totaltaxamount tax vat hesaplanankdv kdvtutari kdvtoplam toplamkdv kdv mwst ust umsatzsteuer steuerbetrag',
  total:
    'total grandtotal totalamount invoicetotal taxinclusiveamount totalincltax totalinclvat amountincludingtax grosstotal gross geneltoplam vergilerdahiltoplamtutar gesamtbetrag bruttobetrag summebrutto',
  amountDue: 'amountdue balancedue payableamount totaldue duetotal odenecektutar odenecek zahlbetrag',
  prepaid: 'prepaid prepaidamount amountpaid paid deposit advance anzahlung',
  allowances:
    'discount discounttotal totaldiscount allowance allowancetotal allowancetotalamount iskonto toplamiskonto rabatt',
  charges:
    'shipping shippingcost freight charges chargetotal chargetotalamount deliverycharge handling kargo versand',
  vatRate: 'vatrate taxrate vatpercent taxpercent kdvorani mwstsatz',
  withholdingRate: 'withholdingrate vatwithholdingrate tevkifatorani tevkifat',
  withholdingAmount:
    'withholdingamount vatwithholding withheldvat tevkifattutari hesaplanantevkifat tevkifatedilenkdv',
  pricesIncludeVat: 'pricesincludevat pricesincludetax taxinclusive vatincluded kdvdahil',
  iban: 'iban paymentiban bankiban accountiban',
});

const PARTY = table({
  name: 'name companyname legalname registrationname registeredname tradename unvan firma firmaadi adsoyad fullname',
  vatId:
    'vatid vatnumber vatno vatregistrationnumber vatidentificationnumber ustidnr ustid tva partitaiva cif nif',
  taxId:
    'taxid taxnumber taxno vkn vergino vergikimlikno vergikimliknumarasi tckn tcno tckimlikno nationalid steuernummer taxidentificationnumber',
  iban: 'iban bankaccount bankiban accountiban',
  country: 'country countrycode ulke land pays',
  address: 'address addressline street adres anschrift',
});

const SELLER =
  'seller supplier vendor issuer from satici saticifirma lieferant verkaufer accountingsupplierparty sellerparty';
const BUYER =
  'buyer customer client receiver recipient billto to alici musteri kunde accountingcustomerparty buyerparty';
const SELLER_KEYS = new Set(SELLER.split(' '));
const BUYER_KEYS = new Set(BUYER.split(' '));
const LINE_KEYS = new Set(
  'lineitems items lines invoicelines invoiceline products services positions kalemler satirlar urunler positionen line_item'
    .split(' ')
    .map(keyOf),
);
const TAX_KEYS = new Set(
  'taxbreakdown vatbreakdown taxes taxsubtotals taxsubtotal vatsummary taxsummary vatrates kdvdokumu vergiler'.split(
    ' ',
  ),
);
const CONTAINERS = new Set(
  'totals summary amounts monetarytotal legalmonetarytotal payment paymentdetails paymentinfo bank bankdetails header meta dates document invoice fatura details'.split(
    ' ',
  ),
);
const IGNORED = new Set('confidence boundingregions spans type kind pageanchor textanchor id'.split(' '));

const LINE = table({
  description:
    'description name item product title text details itemname productname aciklama urun urunadi malhizmet hizmet bezeichnung artikel',
  quantity: 'quantity qty count units invoicedquantity miktar adet menge quantite cantidad',
  unitPrice:
    'unitprice price priceperunit rate unitcost unitpriceamount priceamount birimfiyat birimfiyati einzelpreis prixunitaire',
  discount: 'discount discountamount linediscount iskonto iskontotutari rabatt',
  netAmount:
    'amount total linetotal netamount net lineamount lineextensionamount linenetamount totalnet subtotal totalprice extendedprice value tutar maltutari malhizmettutari betrag nettobetrag',
  vatRate: 'vatrate taxrate vatpercent taxpercent taxpercentage vat% tax% kdvorani kdvoran mwstsatz ustsatz',
  vatAmount: 'vatamount taxamount linevat linetax kdvtutari mwstbetrag',
  grossAmount:
    'grossamount totalwithtax totalincltax amountincltax totalinclvat linegrossamount gross brutto brut',
});

const TAX_ROW = table({
  rate: 'rate taxrate vatrate percent percentage kdvorani',
  base: 'base taxable taxableamount taxbase net netamount matrah',
  amount: 'amount tax vat taxamount vatamount kdvtutari',
});

const COMMON_RATES = new Set([
  0, 1, 2.1, 3, 4, 4.8, 4.9, 5, 5.5, 6, 7, 8, 8.1, 9, 9.5, 10, 11, 12, 13, 13.5, 14, 15, 17, 18, 19, 20, 21,
  22, 23, 24, 25, 25.5, 27,
]);

const CURRENCY_ALIASES: Record<string, string> = {
  '€': 'EUR',
  EURO: 'EUR',
  EUROS: 'EUR',
  '£': 'GBP',
  '₺': 'TRY',
  TL: 'TRY',
  YTL: 'TRY',
  US$: 'USD',
  $: 'USD',
  '¥': 'JPY',
  FR: 'CHF',
  SFR: 'CHF',
  ZŁ: 'PLN',
  ZL: 'PLN',
  KČ: 'CZK',
  KC: 'CZK',
};

export const ISO_CURRENCIES = new Set(
  'AED AFN ALL AMD AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CLP CNY COP CRC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD UYU UZS VES VND VUV WST XAF XCD XCG XOF XPF YER ZAR ZMW ZWG'.split(
    ' ',
  ),
);

const COUNTRY_NAMES: Record<string, string> = {
  austria: 'AT',
  osterreich: 'AT',
  belgium: 'BE',
  belgique: 'BE',
  belgie: 'BE',
  bulgaria: 'BG',
  croatia: 'HR',
  hrvatska: 'HR',
  cyprus: 'CY',
  czechia: 'CZ',
  czechrepublic: 'CZ',
  denmark: 'DK',
  danmark: 'DK',
  estonia: 'EE',
  finland: 'FI',
  suomi: 'FI',
  france: 'FR',
  germany: 'DE',
  deutschland: 'DE',
  almanya: 'DE',
  greece: 'GR',
  hellas: 'GR',
  hungary: 'HU',
  ireland: 'IE',
  italy: 'IT',
  italia: 'IT',
  latvia: 'LV',
  lithuania: 'LT',
  luxembourg: 'LU',
  malta: 'MT',
  netherlands: 'NL',
  nederland: 'NL',
  thenetherlands: 'NL',
  hollanda: 'NL',
  poland: 'PL',
  polska: 'PL',
  portugal: 'PT',
  romania: 'RO',
  slovakia: 'SK',
  slovenia: 'SI',
  spain: 'ES',
  espana: 'ES',
  sweden: 'SE',
  sverige: 'SE',
  turkey: 'TR',
  turkiye: 'TR',
  unitedkingdom: 'GB',
  uk: 'GB',
  greatbritain: 'GB',
  england: 'GB',
  switzerland: 'CH',
  schweiz: 'CH',
  suisse: 'CH',
  norway: 'NO',
  norge: 'NO',
  unitedstates: 'US',
  usa: 'US',
  unitedstatesofamerica: 'US',
  el: 'GR',
};

/** Countries that write 1.234,56 rather than 1,234.56. */
const COMMA_DECIMAL = new Set(
  'AT BE BG HR CZ DK EE FI FR DE GR HU IT LV LT LU NL PL PT RO SK SI ES SE TR NO'.split(' '),
);

export function countryCode(input: unknown): string | undefined {
  if (typeof input !== 'string' || !input.trim()) return undefined;
  const t = input.trim();
  if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase() === 'EL' ? 'GR' : t.toUpperCase();
  const key = keyOf(t);
  return COUNTRY_NAMES[key] ?? (key.includes('turk') ? 'TR' : undefined);
}

// ——— Provider formats ———

/** Azure AI Document Intelligence: { type, valueString | valueNumber | valueCurrency | valueArray | valueObject, content }. */
function unwrapAzure(v: Json): Json {
  if (Array.isArray(v)) return v.map(unwrapAzure);
  if (!isObj(v)) return v;
  if ('valueArray' in v) return (v.valueArray as Json[]).map(unwrapAzure);
  if ('valueObject' in v) return unwrapAzure(v.valueObject as Json);
  if ('valueCurrency' in v && isObj(v.valueCurrency)) {
    const c = v.valueCurrency;
    return c.currencyCode ? { amount: c.amount, currency: c.currencyCode } : (c.amount ?? null);
  }
  for (const k of [
    'valueNumber',
    'valueInteger',
    'valueDate',
    'valueString',
    'valueCountryRegion',
    'valuePhoneNumber',
    'valueBoolean',
  ])
    if (k in v) return v[k] as Json;
  if ('valueAddress' in v || ('content' in v && 'type' in v)) return (v.content as Json) ?? null;
  const out: Obj = {};
  for (const [k, x] of Object.entries(v)) if (!IGNORED.has(keyOf(k))) out[k] = unwrapAzure(x);
  return out;
}

/** Google Document AI: entities [{ type, mentionText, normalizedValue, properties }]. */
function fromGoogle(entities: Json[]): Obj {
  const out: Obj = {};
  const lines: Obj[] = [];
  const taxes: Obj[] = [];
  const value = (e: Obj): Json => {
    const n = e.normalizedValue;
    if (isObj(n)) {
      if (isObj(n.moneyValue)) {
        const units = Number(n.moneyValue.units ?? 0);
        const nanos = Number(n.moneyValue.nanos ?? 0);
        return units + nanos / 1e9;
      }
      if (isObj(n.dateValue)) {
        const d = n.dateValue;
        return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
      }
      if (typeof n.text === 'string') return n.text;
    }
    return (e.mentionText as Json) ?? null;
  };
  for (const e of entities) {
    if (!isObj(e) || typeof e.type !== 'string') continue;
    const props = Array.isArray(e.properties) ? (e.properties as Obj[]) : [];
    const sub = () => {
      const o: Obj = {};
      for (const p of props) if (typeof p.type === 'string') o[p.type.split('/').pop()!] = value(p);
      return o;
    };
    if (e.type === 'line_item') lines.push(props.length ? sub() : { description: value(e) });
    else if (e.type === 'vat' && props.length) taxes.push(sub());
    else if (!(e.type in out)) out[e.type] = value(e);
  }
  if (lines.length) out.line_items = lines;
  if (taxes.length) out.tax_breakdown = taxes;
  return out;
}

function detectFormat(input: Json): { body: Obj; format: Mapped['format']; prefix: string } {
  if (isObj(input)) {
    const result = isObj(input.analyzeResult) ? input.analyzeResult : input;
    if (Array.isArray(result.documents) && isObj(result.documents[0]) && isObj(result.documents[0].fields))
      return {
        body: unwrapAzure(result.documents[0].fields) as Obj,
        format: 'azure',
        prefix: '$.documents[0].fields',
      };
    if (isObj(input.fields) && Object.values(input.fields).some((f) => isObj(f) && 'type' in f))
      return { body: unwrapAzure(input.fields) as Obj, format: 'azure', prefix: '$.fields' };
    const doc = isObj(input.document) ? input.document : input;
    if (
      Array.isArray(doc.entities) &&
      doc.entities.some((e) => isObj(e) && typeof e.type === 'string' && 'mentionText' in e)
    )
      return { body: fromGoogle(doc.entities), format: 'google', prefix: '$.entities' };
    // { "invoice": { … } } and similar single wrappers.
    const keys = Object.keys(input);
    if (keys.length === 1 && isObj(input[keys[0]]) && CONTAINERS.has(keyOf(keys[0])))
      return { body: input[keys[0]] as Obj, format: 'generic', prefix: `$.${keys[0]}` };
    return { body: input, format: 'generic', prefix: '$' };
  }
  return { body: {}, format: 'generic', prefix: '$' };
}

/** Guesses the decimal separator from the strings in the document, then from the country. */
function inferDecimal(body: Json, country?: string, currency?: string): '.' | ',' {
  let comma = 0;
  let dot = 0;
  const visit = (v: Json) => {
    if (typeof v === 'string') {
      const t = v.replace(/[^\d.,]/g, '');
      if (!/\d/.test(t) || /[a-z]{3,}/i.test(v.replace(/EUR|USD|GBP|TRY|CHF/gi, ''))) return;
      if (/\d,\d{2}$/.test(t) || /\.\d{3},\d+$/.test(t)) comma++;
      if (/\d\.\d{2}$/.test(t) || /,\d{3}\.\d+$/.test(t)) dot++;
    } else if (Array.isArray(v)) v.forEach(visit);
    else if (isObj(v)) Object.values(v).forEach(visit);
  };
  visit(body);
  if (comma !== dot) return comma > dot ? ',' : '.';
  if (country && COMMA_DECIMAL.has(country)) return ',';
  if (currency === 'TRY') return ',';
  return '.';
}

// ——— Mapping ———

export function mapInvoice(input: unknown, options: MapOptions = {}): Mapped {
  const { body, format, prefix } = detectFormat(input as Json);
  const invoice: Invoice = { seller: {}, buyer: {}, lines: [], taxes: [] };
  const sources: Record<string, string> = {};
  const raw: Record<string, string> = {};
  const notes: Note[] = [];
  const used = new Set<string>();
  const all: string[] = [];

  // First pass: collect document-level scalars (flattening containers) and structures.
  type Slot = { path: string; key: string; value: Json };
  const scalars: Slot[] = [];
  let sellerObj: Slot | undefined;
  let buyerObj: Slot | undefined;
  let linesArr: Slot | undefined;
  let taxesArr: Slot | undefined;
  const sellerFlat: Slot[] = [];
  const buyerFlat: Slot[] = [];

  const walk = (obj: Obj, path: string) => {
    for (const [k, v] of Object.entries(obj)) {
      const key = keyOf(k);
      const p = `${path}.${k}`;
      if (IGNORED.has(key)) continue;
      if (SELLER_KEYS.has(key) && isObj(v)) sellerObj ??= { path: p, key, value: v };
      else if (BUYER_KEYS.has(key) && isObj(v)) buyerObj ??= { path: p, key, value: v };
      else if (LINE_KEYS.has(key) && Array.isArray(v)) linesArr ??= { path: p, key, value: v };
      else if (TAX_KEYS.has(key) && Array.isArray(v)) taxesArr ??= { path: p, key, value: v };
      else if ((key === 'withholding' || key === 'tevkifat') && isObj(v)) {
        for (const [wk, wv] of Object.entries(v)) {
          const wkey = keyOf(wk);
          scalars.push({
            path: `${p}.${wk}`,
            key: wkey.includes('amount') || wkey.includes('tutar') ? 'withholdingamount' : 'withholdingrate',
            value: wv,
          });
        }
      } else if (CONTAINERS.has(key) && isObj(v)) walk(v, p);
      else if (CONTAINERS.has(key) && Array.isArray(v) && isObj(v[0])) walk(v[0] as Obj, `${p}[0]`);
      else if (isObj(v) && ('amount' in v || 'value' in v) && !Array.isArray(v)) {
        // { "total": { "amount": 12, "currency": "EUR" } }
        const amount = (v.amount ?? v.value) as Json;
        scalars.push({ path: `${p}.${'amount' in v ? 'amount' : 'value'}`, key, value: amount });
        if (typeof v.currency === 'string' || typeof v.currencyCode === 'string')
          scalars.push({
            path: `${p}.currency`,
            key: 'currency',
            value: (v.currency ?? v.currencyCode) as Json,
          });
      } else {
        const sellerPrefix = [...SELLER_KEYS].find(
          (s) => key.startsWith(s) && key.length > s.length && PARTY.has(key.slice(s.length)),
        );
        const buyerPrefix = [...BUYER_KEYS].find(
          (s) => key.startsWith(s) && key.length > s.length && PARTY.has(key.slice(s.length)),
        );
        if (sellerPrefix) sellerFlat.push({ path: p, key: key.slice(sellerPrefix.length), value: v });
        else if (buyerPrefix) buyerFlat.push({ path: p, key: key.slice(buyerPrefix.length), value: v });
        else scalars.push({ path: p, key, value: v });
      }
    }
  };
  walk(body, prefix);

  const collect = (v: Json, p: string) => {
    if (isObj(v)) for (const [k, x] of Object.entries(v)) collect(x, `${p}.${k}`);
    else if (Array.isArray(v)) v.forEach((x, i) => collect(x, `${p}[${i}]`));
    else all.push(p);
  };
  collect(body, prefix);
  const markUsed = (p: string) => used.add(p);

  // Country and currency first: they decide how numbers and identifiers are read.
  const sellerCountryRaw =
    (sellerObj &&
      isObj(sellerObj.value) &&
      Object.entries(sellerObj.value).find(([k]) => PARTY.get(keyOf(k)) === 'country')?.[1]) ??
    sellerFlat.find((s) => PARTY.get(s.key) === 'country')?.value;
  const currencySlot = scalars.find((s) => DOC.get(s.key) === 'currency');
  const currency = normalizeCurrency(currencySlot?.value, notes);
  const decimal: '.' | ',' = options.decimal ?? inferDecimal(body, countryCode(sellerCountryRaw), currency);
  const hint: DecimalHint = decimal;
  const order = countryCode(sellerCountryRaw) === 'US' ? 'mdy' : 'dmy';

  const setNumber = (
    target: Record<string, unknown>,
    field: string,
    canonical: string,
    value: Json,
    path: string,
    kind: 'amount' | 'rate' = 'amount',
  ) => {
    const parsed = kind === 'rate' ? parseRate(value, hint) : parseAmount(value, hint);
    markUsed(path);
    sources[canonical] = path;
    if (parsed.raw !== undefined) raw[canonical] = parsed.raw;
    if (parsed.error) notes.push({ field: canonical, level: 'error', message: `${parsed.error}.` });
    if (parsed.ambiguous)
      notes.push({
        field: canonical,
        level: 'warning',
        message: `${parsed.ambiguous}; read as ${parsed.value} (decimal separator "${decimal}").`,
      });
    if (parsed.value !== undefined) target[field] = parsed.value;
  };
  const setDate = (
    field: 'issueDate' | 'dueDate' | 'deliveryDate' | 'periodStart' | 'periodEnd',
    value: Json,
    path: string,
  ) => {
    const parsed = parseDate(typeof value === 'number' ? String(value) : value, order);
    markUsed(path);
    sources[field] = path;
    if (parsed.raw !== undefined) raw[field] = parsed.raw;
    if (parsed.error) notes.push({ field, level: 'error', message: `${parsed.error}.` });
    if (parsed.ambiguous)
      notes.push({ field, level: 'warning', message: `${parsed.ambiguous}; read as ${parsed.iso}.` });
    if (parsed.iso) invoice[field] = parsed.iso;
  };
  const text = (v: Json) =>
    v === null || v === undefined
      ? undefined
      : isObj(v)
        ? Object.values(v)
            .filter((x) => typeof x === 'string' || typeof x === 'number')
            .join(', ')
        : String(v).trim() || undefined;

  // Document-level fields.
  for (const s of scalars) {
    let canonical = DOC.get(s.key);
    if (!canonical) continue;
    if (
      (s.key === 'tax' || s.key === 'vat' || s.key === 'kdv') &&
      typeof s.value === 'string' &&
      s.value.includes('%')
    )
      canonical = 'vatRate';
    if (
      canonical in invoice &&
      (invoice as unknown as Record<string, unknown>)[canonical] !== undefined &&
      canonical !== 'currency'
    )
      continue;
    switch (canonical) {
      case 'number':
      case 'uuid':
        if (text(s.value)) {
          invoice[canonical] = text(s.value);
          sources[canonical] = s.path;
          markUsed(s.path);
        }
        break;
      case 'currency':
        if (currency) {
          invoice.currency = currency;
          sources.currency = s.path;
          markUsed(s.path);
        }
        break;
      case 'issueDate':
      case 'dueDate':
      case 'deliveryDate':
      case 'periodStart':
      case 'periodEnd':
        setDate(canonical, s.value, s.path);
        break;
      case 'vatRate':
        setNumber(
          invoice as unknown as Record<string, unknown>,
          'vatRate',
          'vatRate',
          s.value,
          s.path,
          'rate',
        );
        break;
      case 'withholdingRate': {
        const f = parseFraction(s.value);
        markUsed(s.path);
        sources.withholdingRate = s.path;
        if (f !== undefined) invoice.withholdingRate = f;
        else
          notes.push({
            field: 'withholdingRate',
            level: 'error',
            message: `"${String(s.value)}" is not a withholding rate such as 5/10.`,
          });
        break;
      }
      case 'pricesIncludeVat':
        markUsed(s.path);
        invoice.pricesIncludeVat = s.value === true || /^(true|yes|evet|ja|1)$/i.test(String(s.value));
        break;
      case 'iban':
        if (text(s.value)) {
          invoice.iban = text(s.value);
          sources.iban = s.path;
          markUsed(s.path);
        }
        break;
      default:
        setNumber(invoice as unknown as Record<string, unknown>, canonical, canonical, s.value, s.path);
    }
  }

  // Parties.
  const mapParty = (
    party: Party,
    role: 'seller' | 'buyer',
    obj: Obj | undefined,
    base: string | undefined,
    flat: Slot[],
  ) => {
    const entries: Slot[] = [
      ...(obj
        ? Object.entries(obj).map(([k, v]) => ({ path: `${base}.${k}`, key: keyOf(k), value: v }))
        : []),
      ...flat,
    ];
    for (const e of entries) {
      let field = PARTY.get(e.key);
      if (!field && isObj(e.value) && (e.key === 'address' || e.key === 'postaladdress')) field = 'address';
      if (!field) {
        // Nested { taxScheme: { companyId } } and similar: look one level down.
        if (isObj(e.value))
          for (const [k2, v2] of Object.entries(e.value)) {
            const f2 = PARTY.get(keyOf(k2));
            if (f2 && f2 !== 'address' && party[f2 as keyof Party] === undefined && text(v2)) {
              (party as Record<string, string>)[f2] = text(v2)!;
              sources[`${role}.${f2}`] = `${e.path}.${k2}`;
              markUsed(`${e.path}.${k2}`);
            }
          }
        continue;
      }
      if (party[field as keyof Party] !== undefined) continue;
      const t = text(e.value);
      if (!t) continue;
      if (field === 'country') {
        const code = countryCode(t);
        if (code) party.country = code;
        else
          notes.push({
            field: `${role}.country`,
            level: 'info',
            message: `Country "${t}" was not recognised.`,
          });
      } else (party as Record<string, string>)[field] = t;
      sources[`${role}.${field}`] = e.path;
      if (isObj(e.value)) collectUsed(e.value, e.path);
      else markUsed(e.path);
      // An "address" object may carry the country.
      if (field === 'address' && isObj(e.value) && !party.country) {
        const c = Object.entries(e.value).find(([k]) => PARTY.get(keyOf(k)) === 'country');
        if (c && countryCode(c[1])) party.country = countryCode(c[1]);
      }
    }
    if (obj && base) markUsed(base);
  };
  const collectUsed = (v: Json, p: string) => {
    if (isObj(v)) for (const [k, x] of Object.entries(v)) collectUsed(x, `${p}.${k}`);
    else markUsed(p);
  };
  mapParty(invoice.seller, 'seller', sellerObj?.value as Obj | undefined, sellerObj?.path, sellerFlat);
  mapParty(invoice.buyer, 'buyer', buyerObj?.value as Obj | undefined, buyerObj?.path, buyerFlat);

  // Lines.
  if (linesArr) {
    (linesArr.value as Json[]).forEach((item, i) => {
      const line: Line = {};
      const base = `${linesArr!.path}[${i}]`;
      if (!isObj(item)) return;
      for (const [k, v] of Object.entries(item)) {
        const key = keyOf(k);
        const path = `${base}.${k}`;
        let field = LINE.get(key);
        if (!field && (key === 'tax' || key === 'vat' || key === 'kdv' || key === 'mwst'))
          field = looksLikeRate(v, hint) ? 'vatRate' : 'vatAmount';
        if (!field && isObj(v) && ('amount' in v || 'value' in v)) {
          field = LINE.get(key);
        }
        if (!field) continue;
        const canonical = `lines[${i}].${field}`;
        if (line[field as keyof Line] !== undefined) continue;
        if (field === 'description') {
          if (text(v)) line.description = text(v);
          sources[canonical] = path;
          markUsed(path);
        } else {
          const value = isObj(v) ? ((v.amount ?? v.value) as Json) : v;
          setNumber(
            line as Record<string, unknown>,
            field,
            canonical,
            value,
            isObj(v) ? `${path}.${'amount' in v ? 'amount' : 'value'}` : path,
            field === 'vatRate' ? 'rate' : 'amount',
          );
        }
      }
      invoice.lines.push(line);
    });
    markUsed(linesArr.path);
  }

  // Tax breakdown.
  if (taxesArr) {
    (taxesArr.value as Json[]).forEach((item, i) => {
      if (!isObj(item)) return;
      const row: TaxRow = {};
      for (const [k, v] of Object.entries(item)) {
        const field = TAX_ROW.get(keyOf(k));
        if (!field || row[field as keyof TaxRow] !== undefined) continue;
        setNumber(
          row as Record<string, unknown>,
          field,
          `taxes[${i}].${field}`,
          v,
          `${taxesArr!.path}[${i}].${k}`,
          field === 'rate' ? 'rate' : 'amount',
        );
      }
      invoice.taxes.push(row);
    });
  }

  // Fill in what can be derived.
  for (const p of [invoice.seller, invoice.buyer]) {
    const prefixed = [p.vatId, p.taxId].find((x) => x && /^[A-Z]{2}[\dA-Z]/i.test(x.trim()) && /\d/.test(x));
    if (!p.country && prefixed) {
      const c = prefixed.trim().slice(0, 2).toUpperCase();
      if (c !== 'XI' && countryCode(c)) p.country = c === 'EL' ? 'GR' : c;
    }
    if (!p.country && p.iban && /^[A-Z]{2}\d/i.test(p.iban.trim()))
      p.country = p.iban.trim().slice(0, 2).toUpperCase();
  }
  if (!invoice.currency && invoice.seller.country === 'TR' && /TL|₺/.test(JSON.stringify(body)))
    invoice.currency = 'TRY';

  const unused = all.filter(
    (p) => ![...used].some((u) => p === u || p.startsWith(`${u}.`) || p.startsWith(`${u}[`)),
  );
  return { invoice, sources, raw, notes, unused, format, decimal };
}

function looksLikeRate(v: Json, hint: DecimalHint): boolean {
  if (typeof v === 'string' && v.includes('%')) return true;
  const n = parseAmount(v, hint).value;
  return n !== undefined && ((n > 0 && n < 1) || COMMON_RATES.has(n));
}

function normalizeCurrency(value: Json | undefined, notes: Note[]): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const t = value.trim().toUpperCase();
  if (ISO_CURRENCIES.has(t)) return t;
  const alias = CURRENCY_ALIASES[t];
  if (alias) {
    notes.push({
      field: 'currency',
      level: 'warning',
      message:
        t === '$'
          ? `Currency given as "$"; assumed USD, but several currencies use the dollar sign.`
          : `Currency given as "${value.trim()}"; the ISO 4217 code is ${alias}.`,
    });
    return alias;
  }
  notes.push({
    field: 'currency',
    level: 'warning',
    message: `"${value.trim()}" is not an ISO 4217 currency code.`,
  });
  return undefined;
}

/** Splits input text into one or more invoice objects: a JSON object, a JSON array, { invoices: [...] } or JSON Lines. */
export function splitInput(textInput: string): { items: unknown[]; error?: string } {
  const t = textInput.trim();
  if (!t) return { items: [], error: 'The input is empty.' };
  try {
    const parsed = JSON.parse(t) as Json;
    if (Array.isArray(parsed)) return { items: parsed };
    if (isObj(parsed)) {
      const key = Object.keys(parsed).find((k) =>
        ['invoices', 'documents', 'results', 'data'].includes(keyOf(k)),
      );
      if (
        key &&
        Array.isArray(parsed[key]) &&
        !(
          keyOf(key) === 'documents' &&
          isObj((parsed[key] as Json[])[0]) &&
          'fields' in ((parsed[key] as Json[])[0] as Obj)
        )
      )
        return { items: parsed[key] as Json[] };
      return { items: [parsed] };
    }
    return { items: [], error: 'The JSON must be an object or an array of objects.' };
  } catch (error) {
    const lines = t.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length > 1) {
      try {
        return { items: lines.map((l) => JSON.parse(l)) };
      } catch {
        /* fall through */
      }
    }
    return { items: [], error: `This is not valid JSON: ${(error as Error).message}` };
  }
}
