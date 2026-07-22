// Mock backendu Tauri do podglądu UI w przeglądarce (bez desktopu i serwera).
// Aktywny WYŁĄCZNIE w dev (vite) i tylko z parametrem ?mock w adresie —
// main.tsx importuje ten moduł dynamicznie, więc nie trafia do builda produkcyjnego.
import type { Order, OrderItem } from "./types";
import type { CreateMarketplaceOfferDraftInput, Invoice, InvoiceItem, InvoiceProviderAccount, InvoiceSellerProfile, JsonObject, KsefConnection, Offer, ReturnCase, SaveInvoice, SaveInvoiceProviderAccount, SaveInvoiceSellerProfile, SaveKsefConnection, SaveMarketplaceOfferDetails, SaveOffer, SaveReturn } from "./commerceApi";
import type { StockProduct, WarehouseNode } from "./stockApi";

// Deterministyczny PRNG — te same dane przy każdym odświeżeniu (stabilne zrzuty).
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const IMG = (id: string) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=200&q=70`;
const PRODUCTS: { name: string; sku: string; price: number; img: string }[] = [
  { name: "Etui silikonowe iPhone 15 Pro", sku: "ETUI-IP15P-BLK", price: 34.99, img: IMG("photo-1592286927505-1def25115558") },
  { name: "Kabel USB-C 2m 100W", sku: "KAB-USBC-2M", price: 24.5, img: IMG("photo-1600490722773-35753aea6332") },
  { name: "Szkło hartowane Galaxy S24", sku: "SZK-S24", price: 19.99, img: IMG("photo-1601784551446-20c9e07cdbdb") },
  { name: "Ładowarka GaN 65W", sku: "LAD-GAN65", price: 89.0, img: IMG("photo-1583863788434-e58a36330cf0") },
  { name: "Uchwyt samochodowy MagSafe", sku: "UCH-MAGSAFE", price: 59.9, img: IMG("photo-1617997455403-41f333d44d5b") },
  { name: "Powerbank 20000 mAh", sku: "PB-20K", price: 119.0, img: IMG("photo-1609592806596-b43bada2f4bb") },
  { name: "Słuchawki BT dokanałowe", sku: "SLU-BT-IN", price: 149.0, img: IMG("photo-1590658268037-6bf12165a8df") },
];
const CARRIERS = ["inpost", "dpd", "dhl", "orlen"];
const MARKETS: { mkt: string; account: string; cur?: string }[] = [
  { mkt: "allegro", account: "moj_sklep_pl" },
  { mkt: "allegro", account: "outlet_gsm" },
  { mkt: "erli", account: "moj_sklep_erli" },
  { mkt: "ebay", account: "ebay_de", cur: "EUR" },
];

function makeOrders(): Order[] {
  const rnd = mulberry32(42);
  const orders: Order[] = [];
  const now = Date.now();
  let id = 1;
  // ~200 dni wstecz — pokrywa zakres 90 dni + poprzedni okres do delty.
  for (let day = 0; day < 200; day++) {
    // Lekki trend wzrostowy + weekendowe dołki (jak prawdziwa sprzedaż).
    const date = new Date(now - day * 86400000);
    const weekend = date.getDay() === 0 || date.getDay() === 6;
    const base = 3 + (200 - day) / 60;
    const count = Math.max(0, Math.round(base * (weekend ? 0.55 : 1) + (rnd() - 0.5) * 4));
    for (let i = 0; i < count; i++) {
      const m = MARKETS[Math.floor(rnd() * MARKETS.length)];
      const curr = m.cur ?? "PLN";
      const mul = curr === "EUR" ? 0.23 : 1;
      const items: OrderItem[] = [];
      const nItems = 1 + (rnd() < 0.5 ? 1 : 0) + (rnd() < 0.3 ? 1 : 0) + (rnd() < 0.16 ? 1 : 0) + (rnd() < 0.08 ? 1 : 0);
      let total = 0;
      for (let j = 0; j < nItems; j++) {
        const p = PRODUCTS[Math.floor(rnd() * PRODUCTS.length)];
        const qty = 1 + (rnd() < 0.2 ? 1 : 0);
        const productUrl = m.mkt === "allegro" ? `https://allegro.pl/oferta/${p.sku}` : m.mkt === "erli" ? `https://erli.pl/i/${p.sku}` : undefined;
        items.push({ externalOfferId: p.sku, productName: p.name, quantity: qty, price: (p.price * mul).toFixed(2), currency: curr, imageUrl: p.img, productUrl });
        total += p.price * mul * qty;
      }
      total += 12.99 * mul; // dostawa
      const r = rnd();
      const derivedStatus = r < 0.72 ? "wyslane" : r < 0.86 ? "do_wyslania" : r < 0.95 ? "nieoplacone" : "anulowane";
      const created = new Date(date.getTime() - Math.floor(rnd() * 86000000));
      const invoiceRequired = id % 7 === 1;
      orders.push({
        id: id++,
        accountName: m.account,
        externalOrderId: `ord-${id.toString(16)}`,
        marketplace: m.mkt,
        totalToPay: total.toFixed(2),
        currency: curr,
        derivedStatus,
        carrier: CARRIERS[Math.floor(rnd() * CARRIERS.length)],
        shipments: [],
        orderCreatedAt: created.toISOString(),
        buyerLogin: `klient_${id}`,
        buyerEmail: `klient_${id}@example.pl`,
        buyerFirstName: "Jan",
        buyerLastName: "Nowak",
        buyerStreet: "ul. Przykładowa 10",
        buyerZipCode: "00-001",
        buyerCity: "Warszawa",
        buyerCountry: "PL",
        invoiceRequired,
        invoiceFirstName: invoiceRequired ? "Jan" : undefined,
        invoiceLastName: invoiceRequired ? "Nowak" : undefined,
        invoiceStreet: invoiceRequired ? "ul. Przykładowa 10" : undefined,
        invoiceZipCode: invoiceRequired ? "00-001" : undefined,
        invoiceCity: invoiceRequired ? "Warszawa" : undefined,
        invoiceCountry: invoiceRequired ? "PL" : undefined,
        deliveryMethodName: undefined,
        items,
      } as Order);
    }
  }
  return orders;
}

const isoAt = (daysFromToday: number) => new Date(Date.now() + daysFromToday * 86400000).toISOString();
const dateAt = (daysFromToday: number) => isoAt(daysFromToday).slice(0, 10);

function makeOffers(): Offer[] {
  const base = { sourcePlatform: "manual", syncStatus: "LOCAL_ONLY" as const, currency: "PLN", taxRate: "23", conditionCode: "NEW", validationIssues: [], revision: 1, createdAt: isoAt(-35) };
  return [
    { ...base, id: 1, sourcePlatform: "allegro", accountName: "moj_sklep_pl", externalOfferId: "15800000001", syncStatus: "SYNCED", externalUpdatedAt: isoAt(-1), title: "Ładowarka GaN 65W USB-C", sku: "LAD-GAN65", ean: "5901234567001", status: "ACTIVE", priceAmount: 89, availableQuantity: 42, category: "Elektronika > Ładowarki", brand: "Voltio", description: "Kompaktowa ładowarka z dwoma portami USB-C.", primaryImageUrl: "https://images.unsplash.com/photo-1583863788434-e58a36330cf0?auto=format&fit=crop&w=600&q=80", updatedAt: isoAt(-1) },
    { ...base, id: 2, title: "Powerbank 20000 mAh PD", sku: "PB-20K", ean: "5901234567002", status: "READY", priceAmount: 119, availableQuantity: 18, category: "Elektronika > Powerbanki", brand: "Voltio", updatedAt: isoAt(-2) },
    { ...base, id: 3, title: "Uchwyt samochodowy MagSafe", sku: "UCH-MAGSAFE", ean: "5901234567003", status: "PAUSED", priceAmount: 59.9, availableQuantity: 0, category: "Motoryzacja > Uchwyty", brand: "Roadly", updatedAt: isoAt(-4) },
    { ...base, id: 4, title: "Kabel USB-C 2 m 100W", sku: "KAB-USBC-2M", status: "DRAFT", priceAmount: 24.5, availableQuantity: 120, category: "Elektronika > Kable", brand: "Voltio", updatedAt: isoAt(-6) },
    { ...base, id: 5, title: "Szkło hartowane Galaxy S24", sku: "SZK-S24", status: "ERROR", priceAmount: 19.99, availableQuantity: 64, category: "Telefony > Ochrona ekranu", brand: "Clearly", validationIssues: [{ code: "MISSING_GTIN", severity: "ERROR", messageKey: "offer_gtin_required", path: "ean" }], updatedAt: isoAt(-1) },
    { ...base, id: 6, sourcePlatform: "inpost_merchant", accountName: "org-demo-2026", externalOfferId: "inpost-offer-42", syncStatus: "SYNCED", externalUpdatedAt: isoAt(-1), title: "Powerbank 20000 mAh PD", sku: "PB-20K", ean: "5901234567002", status: "ACTIVE", priceAmount: 119, availableQuantity: 18, category: "mobile-accessories", brand: "Voltio", description: "Powerbank z szybkim ładowaniem USB-C Power Delivery.", primaryImageUrl: "https://images.unsplash.com/photo-1583863788434-e58a36330cf0?auto=format&fit=crop&w=600&q=80", updatedAt: isoAt(-1) },
    { ...base, id: 7, sourcePlatform: "erli", accountName: "moj_sklep_erli", externalOfferId: "ERLI-1001", syncStatus: "SYNCED", externalUpdatedAt: isoAt(-1), title: "Uchwyt samochodowy MagSafe", sku: "UCH-MAGSAFE", ean: "5901234567003", status: "ACTIVE", priceAmount: 59.9, availableQuantity: 24, taxRate: "UNKNOWN", description: "Magnetyczny uchwyt samochodowy z obsługą MagSafe.", primaryImageUrl: "https://images.unsplash.com/photo-1617997455403-41f333d44d5b?auto=format&fit=crop&w=600&q=80", updatedAt: isoAt(-1) },
  ];
}

// Payload produktu Erli (jak z GET /products/{externalId}) — do edytora ofert Erli.
// Opis jako zwykły string (częsty przypadek u Erli) — edytor rozwija go do sekcji.
function mockErliOfferPayload(offer: Offer): JsonObject {
  const primary = offer.primaryImageUrl ?? "https://images.unsplash.com/photo-1617997455403-41f333d44d5b?auto=format&fit=crop&w=600&q=80";
  const secondary = "https://images.unsplash.com/photo-1600490722773-35753aea6332?auto=format&fit=crop&w=600&q=80";
  return {
    externalId: offer.externalOfferId ?? `ERLI-${offer.id}`,
    marketplaceId: 300000000 + offer.id,
    slug: offer.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    name: offer.title,
    price: Math.round(offer.priceAmount * 100),
    stock: offer.availableQuantity,
    ean: offer.ean ?? "",
    sku: offer.sku,
    status: offer.status === "ACTIVE" ? "active" : "inactive",
    description: offer.description ?? "",
    images: [
      { url: primary, internalUrl: primary },
      { url: secondary, internalUrl: secondary },
    ],
  };
}

function mockAllegroOfferPayload(offer: Offer): JsonObject {
  const image = offer.primaryImageUrl ?? "https://images.unsplash.com/photo-1583863788434-e58a36330cf0?auto=format&fit=crop&w=600&q=80";
  return {
    id: offer.externalOfferId,
    name: offer.title,
    category: { id: "257139" },
    language: "pl-PL",
    external: { id: offer.sku },
    images: [image],
    description: { sections: [{ items: [
      { type: "TEXT", content: "<h2>Ładowarka GaN 65W</h2><p>Kompaktowa ładowarka z dwoma portami USB-C, zabezpieczeniem termicznym i obsługą Power Delivery.</p>" },
      { type: "IMAGE", url: image },
    ] }] },
    productSet: [{
      quantity: { value: 1 },
      product: {
        id: offer.ean,
        idType: "GTIN",
        name: offer.title,
        category: { id: "257139" },
        images: [image],
        parameters: [
          { id: "248811", name: "Marka", values: [offer.brand ?? "Voltio"] },
          { id: "225693", name: "Kod producenta", values: [offer.sku] },
        ],
      },
      responsiblePerson: { id: "responsible-person-demo" },
      responsibleProducer: { id: "producer-demo" },
      safetyInformation: { type: "TEXT", description: "Używać zgodnie z instrukcją. Chronić przed wilgocią." },
      marketedBeforeGPSRObligation: false,
      deposits: [],
    }],
    parameters: [{ id: "11323", name: "Stan", values: ["Nowy"], valuesIds: ["11323_1"] }],
    sellingMode: { format: "BUY_NOW", price: { amount: offer.priceAmount.toFixed(2), currency: offer.currency } },
    stock: { available: offer.availableQuantity, unit: "UNIT" },
    publication: { status: "ACTIVE", duration: null, startingAt: null, republish: false, marketplaces: { base: { id: "allegro-pl" }, additional: [] } },
    delivery: { handlingTime: "PT24H", shippingRates: { id: "shipping-rate-demo" }, shipmentDate: null },
    location: { city: "Warszawa", countryCode: "PL", postCode: "00-001", province: "MAZOWIECKIE" },
    payments: { invoice: "VAT" },
    afterSalesServices: {
      returnPolicy: { id: "return-policy-demo" },
      impliedWarranty: { id: "implied-warranty-demo" },
      warranty: { id: "warranty-demo" },
    },
    taxSettings: { subject: "GOODS", exemption: null, rates: [{ rate: "23.00", countryCode: "PL" }] },
    additionalMarketplaces: { "allegro-cz": { sellingMode: { price: { amount: "520.00", currency: "CZK" } }, publication: { state: "APPROVED" } } },
    b2b: { buyableOnlyByBusiness: false },
    compatibilityList: { type: "MANUAL", items: [] },
    attachments: [],
    fundraisingCampaign: null,
    additionalServices: null,
    sizeTable: null,
    messageToSellerSettings: { mode: "OPTIONAL" },
    contact: null,
    discounts: { wholesalePriceList: null },
    aiCoCreatedContent: { paths: [] },
    validation: { errors: [], warnings: [], validatedAt: isoAt(0) },
    warnings: [],
    createdAt: offer.createdAt,
    updatedAt: offer.externalUpdatedAt ?? offer.updatedAt,
  };
}

function mockAllegroDraftPayload(offer: Offer): JsonObject {
  return {
    name: offer.title,
    category: { id: "" },
    language: "pl-PL",
    external: { id: offer.sku },
    images: [],
    description: { sections: [{ items: [{ type: "TEXT", content: "<p></p>" }] }] },
    productSet: [{
      quantity: { value: 1 },
      product: { name: "Nowy produkt", category: { id: "" }, images: [], parameters: [] },
      safetyInformation: { type: "TEXT", description: "" },
      marketedBeforeGPSRObligation: false,
      deposits: [],
    }],
    parameters: [],
    sellingMode: { format: "BUY_NOW", price: { amount: "0.00", currency: "PLN" } },
    stock: { available: 0, unit: "UNIT" },
    publication: { status: "INACTIVE", duration: null, startingAt: null, republish: false, marketplaces: { base: { id: "allegro-pl" }, additional: [] } },
    delivery: { handlingTime: "PT24H", shippingRates: null, shipmentDate: null },
    location: { city: "", countryCode: "PL", postCode: "", province: "" },
    payments: { invoice: "VAT" },
    afterSalesServices: {},
    taxSettings: { subject: "GOODS", exemption: null, rates: [{ rate: "23.00", countryCode: "PL" }] },
    additionalMarketplaces: {},
    b2b: { buyableOnlyByBusiness: false },
    compatibilityList: { type: "MANUAL", items: [] },
    attachments: [],
    messageToSellerSettings: { mode: "OPTIONAL" },
    discounts: { wholesalePriceList: null },
    aiCoCreatedContent: { paths: [] },
  };
}

function mockInpostOfferPayload(offer: Offer): JsonObject {
  const image = offer.primaryImageUrl ?? "https://images.unsplash.com/photo-1583863788434-e58a36330cf0?auto=format&fit=crop&w=600&q=80";
  return {
    id: offer.externalOfferId,
    externalId: offer.sku,
    status: "PUBLISHED",
    product: {
      name: offer.title,
      description: offer.description,
      brand: offer.brand,
      categoryId: offer.category,
      model: "Power 20",
      superModel: "Power Series",
      sku: offer.sku,
      manufacturerProductNumber: "VLT-PB20-PD",
      ean: offer.ean,
    },
    stock: { quantity: offer.availableQuantity, unit: "UNIT" },
    price: { grossPrice: { amount: offer.priceAmount, currency: offer.currency }, taxRateInfo: { taxRate: "23" } },
    gpsr: {
      doesNotRequireGpsrInfo: false,
      ceMarking: true,
      batchNumber: "2026-07-A",
      manufacturer: { name: "Voltio Europe", email: "safety@example.com", phone: "+48123456789" },
      safetyInformation: "Chronić przed wilgocią i wysoką temperaturą.",
    },
    shippingTime: "P2D",
    affiliationProductUrl: "https://example.com/products/pb-20k",
    images: [{ fileName: "powerbank-main.jpg", fileUrl: image, priority: 1 }],
    postSale: {},
    createdAt: offer.createdAt,
    updatedAt: offer.externalUpdatedAt ?? offer.updatedAt,
  };
}

function invoiceItem(id: number, name: string, sku: string, quantity: number, unitNet: number, taxRate = "23"): InvoiceItem {
  const netAmount = Number((quantity * unitNet).toFixed(2));
  const taxAmount = Number((netAmount * (Number(taxRate) || 0) / 100).toFixed(2));
  return { id, position: 1, name, sku, quantity, unit: "szt.", unitNet, taxRate, netAmount, taxAmount, grossAmount: Number((netAmount + taxAmount).toFixed(2)) };
}

function makeInvoices(): Invoice[] {
  const common = { invoiceKind: "VAT" as const, sellerProfileId: "demo-profile", buyerCompany: false, providerStatus: "LOCAL", sellerName: "Mania Commerce sp. z o.o.", sellerTaxId: "5265877635", sellerAddress: "ul. Handlowa 12, 00-001 Warszawa", sellerStreet: "ul. Handlowa 12", sellerPostCode: "00-001", sellerCity: "Warszawa", sellerCountry: "PL", buyerCountry: "PL", currency: "PLN", paymentMethod: "TRANSFER", paymentState: "UNPAID" as const, splitPayment: false, cashAccounting: false, selfBilling: false, reverseCharge: false, fa3PayloadJson: "{}", ksefOfflineMode: false, taxTreatment: "DOMESTIC" as const, revision: 1, createdAt: isoAt(-28) };
  const paidItem = invoiceItem(1, "Ładowarka GaN 65W USB-C", "LAD-GAN65", 2, 72.36);
  const pendingItem = invoiceItem(2, "Powerbank 20000 mAh PD", "PB-20K", 1, 96.75);
  const draftItem = invoiceItem(3, "Kabel USB-C 2 m 100W", "KAB-USBC-2M", 4, 19.92);
  return [
    { ...common, id: 1, invoiceNumber: "FV/2026/07/0001", documentType: "INVOICE", status: "PAID", ksefStatus: "ACCEPTED", ksefNumber: "KSeF-202607-000001", providerAccountId: 1, provider: "fakturownia", providerDocumentId: "101", providerStatus: "KSEF_ACCEPTED", externalOrderId: "AL-10482", issueDate: dateAt(-18), saleDate: dateAt(-18), dueDate: dateAt(-11), buyerName: "Studio Północ sp. z o.o.", buyerTaxId: "7010456789", buyerAddress: "ul. Leśna 8, 80-001 Gdańsk", netTotal: paidItem.netAmount!, taxTotal: paidItem.taxAmount!, grossTotal: paidItem.grossAmount!, paidAmount: paidItem.grossAmount!, updatedAt: isoAt(-16), issuedAt: isoAt(-18), items: [paidItem] },
    { ...common, id: 2, invoiceNumber: "FV/2026/07/0002", documentType: "INVOICE", status: "ISSUED", ksefStatus: "NOT_SENT", providerAccountId: 1, provider: "fakturownia", providerStatus: "ERROR", providerError: "Nie udało się potwierdzić odpowiedzi operatora.", externalOrderId: "AMZ-71936", issueDate: dateAt(-5), saleDate: dateAt(-5), dueDate: dateAt(9), buyerName: "Anna Kowalska", buyerAddress: "ul. Polna 4, 30-001 Kraków", netTotal: pendingItem.netAmount!, taxTotal: pendingItem.taxAmount!, grossTotal: pendingItem.grossAmount!, paidAmount: 0, updatedAt: isoAt(-5), issuedAt: isoAt(-5), items: [pendingItem] },
    { ...common, id: 3, documentType: "INVOICE", status: "DRAFT", ksefStatus: "NOT_SENT", externalOrderId: "WEB-20267", issueDate: dateAt(0), saleDate: dateAt(0), dueDate: dateAt(14), buyerName: "Biuro Forma sp. z o.o.", buyerTaxId: "6762345678", buyerAddress: "ul. Długa 21, 31-001 Kraków", netTotal: draftItem.netAmount!, taxTotal: draftItem.taxAmount!, grossTotal: draftItem.grossAmount!, paidAmount: 0, updatedAt: isoAt(-1), items: [draftItem] },
  ];
}

function makeReturns(): ReturnCase[] {
  const common = { sourcePlatform: "manual", currency: "PLN", revision: 1, createdAt: isoAt(-20), refundStatus: "PENDING" as const };
  return [
    { ...common, id: 1, sourcePlatform: "allegro", accountName: "moj_sklep_pl", externalReturnId: "return-10482", externalStatus: "IN_TRANSIT", paymentId: "payment-10482", externalOrderId: "AL-10482", customerName: "Marek Nowak", customerEmail: "marek@example.pl", returnType: "WITHDRAWAL", status: "REQUESTED", resolution: "REFUND", reasonCode: "CHANGED_MIND", requestedAt: dateAt(-2), refundDueAt: dateAt(12), refundAmount: 89, restockPolicy: "INSPECT", notes: "", updatedAt: isoAt(-2), items: [{ id: 1, sku: "LAD-GAN65", imageUrl: PRODUCTS[3].img, name: "Ładowarka GaN 65W USB-C", quantity: 1, itemCondition: "UNKNOWN", resolution: "REFUND" }] },
    { ...common, id: 2, sourcePlatform: "allegro", accountName: "moj_sklep_pl", externalReturnId: "return-71811", externalStatus: "DELIVERED", paymentId: "payment-71811", externalOrderId: "AMZ-71811", customerName: "Joanna Lis", customerEmail: "joanna@example.pl", returnType: "MARKETPLACE_RETURN", status: "ACCEPTED", resolution: "REFUND", reasonCode: "NOT_AS_DESCRIBED", reasonDetails: "Kolor inny niż na zdjęciu.", requestedAt: dateAt(-10), refundDueAt: dateAt(4), receivedAt: isoAt(-1), refundAmount: 59.9, returnCarrier: "InPost", trackingNumber: "123456789012345678901234", restockPolicy: "INSPECT", updatedAt: isoAt(-1), items: [{ id: 2, sku: "UCH-MAGSAFE", imageUrl: PRODUCTS[4].img, name: "Uchwyt samochodowy MagSafe", quantity: 1, itemCondition: "OPENED", resolution: "REFUND" }] },
    { ...common, id: 3, externalOrderId: "WEB-19832", customerName: "Piotr Zieliński", customerEmail: "piotr@example.pl", returnType: "COMPLAINT", status: "ACCEPTED", resolution: "REPLACEMENT", reasonCode: "DAMAGED", requestedAt: dateAt(-18), receivedAt: isoAt(-12), refundStatus: "NOT_REQUIRED", refundAmount: 0, restockPolicy: "QUARANTINE", updatedAt: isoAt(-3), items: [{ id: 3, sku: "PB-20K", imageUrl: PRODUCTS[5].img, name: "Powerbank 20000 mAh PD", quantity: 1, itemCondition: "DAMAGED", resolution: "REPLACEMENT" }] },
    { ...common, id: 4, externalOrderId: "AL-9920", customerName: "Katarzyna Wójcik", returnType: "WITHDRAWAL", status: "REFUNDED", resolution: "REFUND", reasonCode: "CHANGED_MIND", requestedAt: dateAt(-16), refundDueAt: dateAt(-2), receivedAt: isoAt(-11), refundedAt: isoAt(-8), refundStatus: "COMPLETED", refundAmount: 24.5, restockPolicy: "RESTOCK", updatedAt: isoAt(-8), items: [{ id: 4, sku: "KAB-USBC-2M", imageUrl: PRODUCTS[1].img, name: "Kabel USB-C 2 m 100W", quantity: 1, itemCondition: "NEW", resolution: "REFUND" }] },
  ];
}

function calculateItems(items: InvoiceItem[]) {
  return items.map((item, position) => {
    const netAmount = Number((item.quantity * item.unitNet).toFixed(2));
    const taxAmount = Number((netAmount * (Number(item.taxRate) || 0) / 100).toFixed(2));
    return { ...item, position: position + 1, netAmount, taxAmount, grossAmount: Number((netAmount + taxAmount).toFixed(2)) };
  });
}

function mockInvoiceDraft(): SaveInvoice {
  return {
    documentType: "INVOICE", invoiceKind: "VAT", sellerProfileId: "demo-profile", issueDate: dateAt(0), saleDate: dateAt(0), dueDate: dateAt(14),
    sellerName: "Mania Commerce sp. z o.o.", sellerTaxId: "5265877635",
    sellerAddress: "ul. Handlowa 12, 00-001 Warszawa", sellerStreet: "ul. Handlowa 12", sellerPostCode: "00-001",
    sellerCity: "Warszawa", sellerEmail: "biuro@example.pl", sellerPhone: "", sellerCountry: "PL",
    buyerName: "", buyerTaxId: "", buyerAddress: "", buyerStreet: "", buyerPostCode: "",
    buyerCity: "", buyerEmail: "", buyerPhone: "", buyerCompany: false, buyerTaxNoKind: "NIP",
    buyerCountry: "PL", currency: "PLN", paymentMethod: "MARKETPLACE", paymentState: "UNPAID",
    issuePlace: "Warszawa", bankAccount: "61109010140000071219812874",
    splitPayment: false, cashAccounting: false, selfBilling: false, reverseCharge: false,
    fa3PayloadJson: "{}", ksefOfflineMode: false, taxTreatment: "DOMESTIC",
    exemptTaxKind: "", npTaxKind: "", notes: "", items: [],
  };
}

/** Podmienia most Tauri na kanned odpowiedzi. Wołaj PRZED renderem aplikacji. */
export function installDevMock() {
  if ((window as unknown as Record<string, boolean>).__PACZKOWO_DEMO_MOCK__) return;
  (window as unknown as Record<string, boolean>).__PACZKOWO_DEMO_MOCK__ = true;

  const orders = makeOrders().slice(0, 10);
  let offers = makeOffers();
  const devLogs: { timestamp: string; level: string; target: string; message: string }[] = [];
  const devLog = (level: string, message: string) => {
    devLogs.push({ timestamp: new Date().toISOString(), level, target: "offers.sync", message });
    if (devLogs.length > 1000) devLogs.splice(0, devLogs.length - 1000);
  };
  const offerSourcePayloads = new Map<number, JsonObject>();
  const offerDraftPayloads = new Map<number, JsonObject>();
  let invoices = makeInvoices();
  let returns = makeReturns();
  let sellerProfiles: InvoiceSellerProfile[] = [{
    id: "demo-profile", displayName: "Mania Commerce", legalName: "Mania Commerce sp. z o.o.",
    nip: "5265877635", street: "ul. Handlowa 12", postCode: "00-001", city: "Warszawa",
    country: "PL", email: "biuro@example.pl", bankAccount: "61109010140000071219812874",
    issuePlace: "Warszawa", numberingPrefix: "FV", active: true, ksefEnvironment: "TEST",
    ksefConnectionStatus: "NOT_CONFIGURED", createdAt: isoAt(-30), updatedAt: isoAt(-1),
  }];
  let ksefConnections: KsefConnection[] = [];
  let invoiceProviders: InvoiceProviderAccount[] = [
    { id: 1, provider: "fakturownia", displayName: "Fakturownia Demo", apiBaseUrl: "https://demo.fakturownia.pl", active: true, ksefMode: "AUTO", configured: true },
  ];
  // Integracje mutowalne — obsługa zmiany nazwy / przełącznika zbierania zamówień w podglądzie.
  let integrations = MARKETS.map((m, i) => ({ id: `int-${i + 1}`, platform: m.mkt, accountName: m.account, collectOrders: true }));
  let stockProducts: StockProduct[] = PRODUCTS.map((p, index) => {
    const qty = [128, 246, 74, 42, 9, 18, 0][index];
    const locations = ["H1-R01", "H1-R02", "H1-R03", "H1-P01", "H1-R01", null, null];
    return { id: index + 1, sku: p.sku, ean: `59012345670${String(index + 1).padStart(2, "0")}`, name: p.name, imageUrl: p.img, unitValue: String(p.price), currency: "PLN", qty, minQty: index === 4 ? 12 : 5, location: locations[index], archived: false, low: qty > 0 && qty <= (index === 4 ? 12 : 5), out: qty <= 0 };
  });
  // Współrzędne mapy w PIKSELACH świata (nieskończone płótno, kratka 32 px) —
  // takie same wartości jak starter w Rust (stock_create_starter_layout).
  const wh = (o: Partial<WarehouseNode> & Pick<WarehouseNode, "id" | "parentId" | "kind" | "name" | "code">): WarehouseNode => ({
    color:"#6c5fc7",shape:"rect",rotation:0,meta:null,capacity:0,pickable:false,priority:10,x:0,y:0,width:96,height:96,productCount:0,units:0,...o,
  });
  let warehouseNodes: WarehouseNode[] = [
    wh({ id:1,parentId:null,kind:"warehouse",name:"Magazyn centralny",code:"MAG",width:100,height:100 }),
    // budynki = karty po lewej
    wh({ id:2,parentId:1,kind:"building",name:"Hala A",code:"H1",width:100,height:100 }),
    wh({ id:3,parentId:1,kind:"building",name:"Hala B",code:"H2",color:"#b4794b",priority:20,width:100,height:100 }),
    // ── Hala A: strefy (obwódki) + ściana + regały + palety (płasko) ──
    wh({ id:4,parentId:2,kind:"zone",name:"Strefa składowania",code:"H1-S01",color:"#6c5fc7",priority:5,x:104,y:104,width:336,height:560 }),
    wh({ id:5,parentId:2,kind:"zone",name:"Kompletacja",code:"H1-S02",color:"#2f9e73",priority:6,x:584,y:104,width:336,height:240 }),
    wh({ id:6,parentId:2,kind:"zone",name:"Ściana",code:"H1-W01",color:"#3a4250",shape:"wall",priority:4,x:440,y:96,width:56,height:560,meta:{pts:[[496,96],[496,560],[440,656]]} }),
    // regały: zwarty blok 3×2 po 96×256, podzielone na 4 półki (meta.shelves)
    wh({ id:7,parentId:4,kind:"rack",name:"Regał 1",code:"H1-R01",capacity:40,pickable:true,priority:10,x:128,y:128,width:96,height:256,meta:{shelves:4} }),
    wh({ id:8,parentId:4,kind:"rack",name:"Regał 2",code:"H1-R02",capacity:40,pickable:true,priority:11,x:224,y:128,width:96,height:256,meta:{shelves:4} }),
    wh({ id:9,parentId:4,kind:"rack",name:"Regał 3",code:"H1-R03",capacity:40,pickable:true,priority:12,x:320,y:128,width:96,height:256,meta:{shelves:4} }),
    wh({ id:10,parentId:4,kind:"rack",name:"Regał 4",code:"H1-R04",capacity:40,pickable:true,priority:13,x:128,y:384,width:96,height:256,meta:{shelves:5} }),
    wh({ id:11,parentId:4,kind:"rack",name:"Regał 5",code:"H1-R05",capacity:40,pickable:true,priority:14,x:224,y:384,width:96,height:256,meta:{shelves:4} }),
    wh({ id:12,parentId:4,kind:"rack",name:"Regał 6",code:"H1-R06",capacity:40,pickable:true,priority:15,x:320,y:384,width:96,height:256,meta:{shelves:4} }),
    // palety: zwarty blok 3×2, część spiętrowana (meta.tiers)
    wh({ id:13,parentId:5,kind:"bin",name:"Paleta 1",code:"H1-P01",color:"#4b82d0",capacity:1,pickable:true,priority:30,x:608,y:128,meta:{tiers:3} }),
    wh({ id:14,parentId:5,kind:"bin",name:"Paleta 2",code:"H1-P02",color:"#4b82d0",capacity:1,pickable:true,priority:31,x:704,y:128,meta:{tiers:2} }),
    wh({ id:15,parentId:5,kind:"bin",name:"Paleta 3",code:"H1-P03",color:"#4b82d0",capacity:1,pickable:true,priority:32,x:800,y:128 }),
    wh({ id:16,parentId:5,kind:"bin",name:"Paleta 4",code:"H1-P04",color:"#4b82d0",capacity:1,pickable:true,priority:33,x:608,y:224 }),
    wh({ id:17,parentId:5,kind:"bin",name:"Paleta 5",code:"H1-P05",color:"#4b82d0",capacity:1,pickable:true,priority:34,x:704,y:224 }),
    wh({ id:18,parentId:5,kind:"bin",name:"Paleta 6",code:"H1-P06",color:"#4b82d0",capacity:1,pickable:true,priority:35,x:800,y:224 }),
    // ── Hala B ──
    wh({ id:19,parentId:3,kind:"zone",name:"Magazyn palet",code:"H2-S01",color:"#b4794b",priority:5,x:104,y:104,width:336,height:336 }),
    wh({ id:20,parentId:19,kind:"rack",name:"Regał 1",code:"H2-R01",color:"#b4794b",capacity:40,pickable:true,priority:10,x:128,y:128,width:96,height:288 }),
    wh({ id:21,parentId:19,kind:"rack",name:"Regał 2",code:"H2-R02",color:"#b4794b",capacity:40,pickable:true,priority:11,x:224,y:128,width:96,height:288 }),
    wh({ id:22,parentId:19,kind:"rack",name:"Regał 3",code:"H2-R03",color:"#b4794b",capacity:40,pickable:true,priority:12,x:320,y:128,width:96,height:288 }),
    wh({ id:23,parentId:3,kind:"bin",name:"Paleta 1",code:"H2-P01",color:"#4b82d0",capacity:1,pickable:true,priority:30,x:128,y:480 }),
    wh({ id:24,parentId:3,kind:"bin",name:"Paleta 2",code:"H2-P02",color:"#4b82d0",capacity:1,pickable:true,priority:31,x:224,y:480 }),
  ];
  const warehouseMap = () => {
    const nodes = warehouseNodes.map((n) => ({ ...n, productCount: 0, units: 0 }));
    const byCode = new Map(nodes.map((n) => [n.code.toUpperCase(), n]));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    let unassignedProducts = 0, unassignedUnits = 0;
    stockProducts.forEach((product) => {
      const loc = product.location?.toUpperCase();
      // adres półki (`REGAŁ-N`) doliczamy do regału-rodzica — jak w backendzie
      let node = loc ? (byCode.get(loc) ?? byCode.get((loc.match(/^(.*)-\d+$/) ?? [])[1] ?? "")) : undefined;
      if (!node) { unassignedProducts += 1; unassignedUnits += Math.max(0, product.qty); return; }
      while (node) { node.productCount += 1; node.units += Math.max(0, product.qty); node = node.parentId ? byId.get(node.parentId) : undefined; }
    });
    return { nodes, unassignedProducts, unassignedUnits };
  };
  // ── Zamów kuriera: przesyłki gotowe do odbioru + historia zleceń ──
  const CARRIER_NAMES: Record<string, string> = { inpost: "InPost", dpd: "DPD", dhl: "DHL", orlen: "ORLEN Paczka" };
  const pickupAddress = { name: "Sklep Demo sp. z o.o.", street: "ul. Przykładowa 12/3", postalCode: "00-001", city: "Warszawa", countryCode: "PL" };
  const pickedShipments = new Set<string>();
  let pickupLog: Record<string, unknown>[] = [
    { login: "moj_sklep_pl", pickupId: "PU-2026-0713-001", date: dateAt(-3), minTime: "10:00", maxTime: "14:00", count: 6, createdAt: isoAt(-3) },
    { login: "outlet_gsm", pickupId: "PU-2026-0710-004", date: dateAt(-6), minTime: "12:00", maxTime: "16:00", count: 2, createdAt: isoAt(-6) },
  ];
  const courierShipments = (login: string) =>
    orders
      .filter((o) => o.marketplace === "allegro" && o.accountName === login && ["wyslane", "do_wyslania"].includes(o.derivedStatus ?? ""))
      .slice(0, 11)
      .map((o, i) => {
        const carrier = CARRIER_NAMES[o.carrier ?? "inpost"] ?? "InPost";
        const program = i % 4 === 0 ? "Allegro One" : "Allegro Delivery";
        const waybill = o.derivedStatus === "wyslane" ? `${carrier.slice(0, 2).toUpperCase()}${String(100000000 + o.id * 7)}` : undefined;
        return {
          orderId: o.externalOrderId, shipmentId: `shp-${o.id}`, carrier, program, waybill,
          createdDate: o.orderCreatedAt, canceled: false, pickupAvailable: o.derivedStatus !== "anulowane",
          status: `${waybill ? "Zarejestrowana u kuriera" : "Przesyłka utworzona"} (${program}, ${carrier})`,
        };
      });
  const courierData = (login: string) => {
    const created = courierShipments(login);
    const byKey = new Map<string, { carrier: string; program: string; shipmentIds: string[] }>();
    created.forEach((s) => {
      if (!s.pickupAvailable || s.canceled || pickedShipments.has(s.shipmentId)) return;
      const key = `${s.program}|${s.carrier}`;
      const group = byKey.get(key) ?? { carrier: s.carrier, program: s.program, shipmentIds: [] };
      group.shipmentIds.push(s.shipmentId);
      byKey.set(key, group);
    });
    const groups = Array.from(byKey.values()).map((g) => ({ ...g, label: `${g.carrier} · ${g.program}`, count: g.shipmentIds.length }));
    return { created, prep: { groups, carriers: ["InPost", "DPD", "DHL", "ORLEN Paczka", "Poczta Polska", "UPS"], address: pickupAddress } };
  };

  const responses: Record<string, unknown> = {
    server_is_logged_in: true,
    // serverLicense() dekoduje JWT — payload w base64 wystarczy (podpis nieweryfikowany w UI).
    server_license: `x.${btoa(JSON.stringify({ status: "PREMIUM", plan: "premium", daysLeft: 23, validUntil: new Date(Date.now() + 23 * 86400000).toISOString(), sub: "dev-user" }))}.x`,
    server_verification_status: { emailVerified: true, phoneVerified: true, active: true, licenseActive: true },
    set_current_user: null,
    sync_account_tokens: null,
    get_orders: { orders },
    sync_allegro_orders: { accountsSynced: 2, totalFetched: orders.length, totalSaved: orders.length },
    sync_erli_orders: { fetched: 0, saved: 0 },
    sync_inpost_merchant_orders: { fetched: 0, saved: 0 },
    get_allegro_accounts: { accounts: MARKETS.filter((m) => m.mkt === "allegro").map((m, i) => ({ integrationId: `int-${i + 1}`, login: m.account })) },
    get_erli_integration: { connected: false },
    get_inpost_integration: { connected: false },
    get_inpost_merchant_integration: { connected: false },
    stock_dashboard: {
      stockValue: "1466383.59", currency: "PLN", products: 390, units: 34186, low: 30, out: 8, sold30: 310,
      topSellers: [
        { name: "Kabel USB-C 2m 100W", sku: "KAB-USBC-2M", sold: 113 },
        { name: "Etui silikonowe iPhone 15 Pro", sku: "ETUI-IP15P-BLK", sold: 98 },
      ],
      series: [
        { date: dateAt(-14), inbound: 0, outbound: 140 },
        { date: dateAt(-4), inbound: 28, outbound: 15 },
        { date: dateAt(-3), inbound: 0, outbound: 113 },
        { date: dateAt(-2), inbound: 12, outbound: 42 },
      ],
    },
    stock_alerts: { counts: { out: 1, low: 3, unmatched: 0 }, out: [], low: [], unmatched: [] },
    list_printers: [],
    get_default_printer: null,
    check_update: { updateAvailable: false, updateRequired: false, current: "dev", latest: "dev" },
    get_current_user: "dev-user",
    // Statyczne kursy (PLN per 1 jedn.) — do testu przelicznika waluty w podglądzie.
    get_fx_rates: { base: "PLN", date: "2026-07-17", rates: { PLN: 1, EUR: 4.31, USD: 3.66, GBP: 4.98, CZK: 0.173, SEK: 0.38, NOK: 0.36, DKK: 0.58, HUF: 0.0108, RON: 0.85, BGN: 2.2, CHF: 4.6, UAH: 0.088 } },
  };
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
    invoke: async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "open_url") return null;
      if (cmd === "start_allegro_auth") {
        const number = integrations.filter((item) => item.platform === "allegro").length + 1;
        integrations.push({ id: `demo-allegro-${number}`, platform: "allegro", accountName: `allegro_demo_${number}`, collectOrders: true });
        return "demo";
      }
      if (cmd === "start_inpost_merchant_auth") {
        integrations.push({ id: "demo-inpost-merchant", platform: "inpost_merchant", accountName: "inpost_demo", collectOrders: true });
        return "demo";
      }
      if (cmd === "get_dev_logs") return structuredClone(devLogs);
      if (cmd === "clear_dev_logs") { devLogs.length = 0; return null; }
      if (cmd === "sync_allegro_orders") {
        const account = String(args?.account ?? "");
        const scoped = account ? orders.filter((order) => order.marketplace === "allegro" && order.accountName === account) : orders.filter((order) => order.marketplace === "allegro");
        return { accountsSynced: account ? 1 : MARKETS.filter((market) => market.mkt === "allegro").length, totalFetched: scoped.length, totalSaved: scoped.length };
      }
      if (cmd === "sync_erli_orders") {
        const account = String(args?.account ?? "");
        const scoped = account ? orders.filter((order) => order.marketplace === "erli" && order.accountName === account) : orders.filter((order) => order.marketplace === "erli");
        return { fetched: scoped.length, saved: scoped.length };
      }
      if (cmd === "sync_inpost_merchant_orders") {
        const account = String(args?.account ?? "");
        const scoped = account ? orders.filter((order) => order.marketplace === "inpost_merchant" && order.accountName === account) : orders.filter((order) => order.marketplace === "inpost_merchant");
        return { fetched: scoped.length, saved: scoped.length };
      }
      if (cmd === "stock_list_products") return structuredClone(stockProducts);
      if (cmd === "stock_location_map") return structuredClone(warehouseMap());
      if (cmd === "stock_upsert_location") {
        const input = args?.input as Omit<WarehouseNode, "productCount" | "units"> & { id?: number | null };
        const id = input.id ?? Math.max(0, ...warehouseNodes.map((n) => n.id)) + 1;
        const saved = { ...input, id, productCount: 0, units: 0 } as WarehouseNode;
        warehouseNodes = warehouseNodes.some((n) => n.id === id) ? warehouseNodes.map((n) => n.id === id ? saved : n) : [...warehouseNodes, saved];
        return id;
      }
      if (cmd === "stock_delete_location") { warehouseNodes = warehouseNodes.filter((n) => n.id !== Number(args?.id)); return null; }
      if (cmd === "stock_create_starter_layout") return null;
      if (cmd === "stock_upsert_product") {
        const a = (args ?? {}) as Record<string, unknown>;
        const ex = a.id ? stockProducts.find((x) => x.id === Number(a.id)) : null;
        if (ex) {
          ex.sku = String(a.sku ?? ex.sku); ex.ean = (a.ean as string) ?? null; ex.name = String(a.name ?? ex.name);
          ex.imageUrl = (a.imageUrl as string) ?? null; ex.unitValue = (a.unitValue as string) ?? null;
          ex.minQty = Number(a.minQty ?? 0); ex.location = (a.location as string) ?? null;
          ex.low = ex.qty > 0 && ex.qty <= ex.minQty; ex.out = ex.qty <= 0;
          return ex.id;
        }
        const id = Math.max(0, ...stockProducts.map((x) => x.id)) + 1;
        const qty = Number(a.initialQty ?? 0);
        stockProducts.push({
          id, sku: String(a.sku ?? ""), ean: (a.ean as string) ?? null, name: String(a.name ?? ""),
          imageUrl: (a.imageUrl as string) ?? null, unitValue: (a.unitValue as string) ?? null, currency: "PLN",
          qty, minQty: Number(a.minQty ?? 0), location: (a.location as string) ?? null,
          archived: false, low: qty > 0 && qty <= Number(a.minQty ?? 0), out: qty <= 0,
        });
        return id;
      }
      if (cmd === "stock_bulk_receive") {
        const items = (args?.items ?? []) as { sku: string; qty: number; location?: string | null }[];
        const applied: unknown[] = [], notFound: string[] = [], badLocations: string[] = [];
        for (const it of items) {
          const p = stockProducts.find((x) => x.sku.toUpperCase() === it.sku.toUpperCase() || x.ean?.toUpperCase() === it.sku.toUpperCase());
          if (!p) { notFound.push(it.sku); continue; }
          p.qty += it.qty;
          const wanted = (it.location ?? "").trim();
          if (wanted) {
            const up = wanted.toUpperCase();
            const exact = warehouseNodes.find((n) => n.code.toUpperCase() === up && n.pickable);
            // adres półki regału: KOD-N (N ≤ meta.shelves) — jak w backendzie
            const m = !exact ? up.match(/^(.*)-(\d+)$/) : null;
            const rack = m ? warehouseNodes.find((n) => n.code.toUpperCase() === m[1] && n.kind === "rack" && n.pickable) : null;
            const shelfOk = rack && Number(m![2]) >= 1 && Number(m![2]) <= (rack.meta?.shelves ?? 0);
            if (exact) p.location = exact.code;
            else if (shelfOk) p.location = `${rack!.code}-${Number(m![2])}`;
            else if (!badLocations.includes(wanted)) badLocations.push(wanted);
          }
          p.out = p.qty <= 0; p.low = p.qty > 0 && p.qty <= p.minQty;
          applied.push({ sku: p.sku, productId: p.id, name: p.name, qty: p.qty, added: it.qty, location: p.location ?? null });
        }
        return { applied, notFound, badLocations, pushed: applied.length };
      }
      if (cmd === "stock_scan_receive") {
        const code = String(args?.productCode ?? "").toUpperCase();
        const locationCode = String(args?.locationCode ?? "").toUpperCase();
        const qty = Number(args?.qty ?? 0);
        const product = stockProducts.find((p) => p.sku.toUpperCase() === code || p.ean?.toUpperCase() === code);
        const place = warehouseNodes.find((n) => n.code.toUpperCase() === locationCode && n.pickable);
        if (!product) throw new Error("Nie znaleziono produktu o tym SKU/EAN");
        if (!place) throw new Error("Nie znaleziono miejsca o tym kodzie");
        product.qty += qty; product.location = place.code; product.out = product.qty <= 0; product.low = product.qty > 0 && product.qty <= product.minQty;
        return { productId: product.id, sku: product.sku, name: product.name, location: place.code, qty: product.qty, added: qty };
      }
      if (cmd === "stock_get_product") {
        const product = stockProducts.find((p) => p.id === Number(args?.id));
        return product ? { ...product, createdAt: isoAt(-60), history: [] } : null;
      }
      if (cmd === "stock_sync") return { products: 0, pushed: 0, errors: 0, lastError: null };
      if (cmd === "list_offers") {
        const query = (args?.query ?? {}) as { page?: number; pageSize?: number; search?: string; status?: string | null; platforms?: string[]; accounts?: string[] };
        const search = String(query.search ?? "").trim().toLowerCase();
        const filtered = offers.filter((offer) => (!search || `${offer.title} ${offer.sku} ${offer.ean ?? ""} ${offer.brand ?? ""}`.toLowerCase().includes(search))
          && (!query.status || offer.status === query.status)
          && (!query.platforms?.length || query.platforms.includes(offer.sourcePlatform))
          && (!query.accounts?.length || query.accounts.includes(offer.accountName ?? "")));
        const pageSize = query.pageSize === 50 || query.pageSize === 100 ? query.pageSize : 20;
        const page = Math.max(1, Number(query.page ?? 1));
        const statusCounts = Object.fromEntries(offers.map((offer) => offer.status).map((status) => [status, offers.filter((offer) => offer.status === status).length]));
        const facets = (key: (offer: Offer) => string) => Object.entries(offers.reduce<Record<string, number>>((map, offer) => { const value = key(offer); map[value] = (map[value] ?? 0) + 1; return map; }, {})).map(([key, count]) => ({ key, count }));
        const values = Object.entries(offers.filter((offer) => offer.status === "ACTIVE").reduce<Record<string, number>>((map, offer) => { map[offer.currency] = (map[offer.currency] ?? 0) + offer.priceAmount * offer.availableQuantity; return map; }, {})).map(([currency, amount]) => ({ currency, amount }));
        return { offers: structuredClone(filtered.slice((page - 1) * pageSize, page * pageSize)), total: filtered.length, page, pageSize, platformFacets: facets((offer) => offer.sourcePlatform), accountFacets: facets((offer) => offer.accountName ?? ""), statusCounts, activeStockValues: values };
      }
      if (cmd === "save_offer") {
        const input = args?.input as SaveOffer;
        const current = input.id ? offers.find((item) => item.id === input.id) : undefined;
        const id = current?.id ?? Math.max(0, ...offers.map((item) => item.id)) + 1;
        const now = new Date().toISOString();
        const saved: Offer = {
          ...current,
          ...input,
          id,
          sourcePlatform: current?.sourcePlatform ?? "manual",
          status: current?.status ?? "DRAFT",
          syncStatus: "LOCAL_ONLY",
          validationIssues: [],
          revision: (current?.revision ?? 0) + 1,
          createdAt: current?.createdAt ?? now,
          updatedAt: now,
        };
        offers = current ? offers.map((item) => item.id === id ? saved : item) : [saved, ...offers];
        return id;
      }
      if (cmd === "change_offer_status") {
        const id = args?.id as number;
        const status = args?.status as Offer["status"];
        offers = offers.map((item) => item.id === id ? { ...item, status, revision: item.revision + 1, updatedAt: new Date().toISOString() } : item);
        return null;
      }
      if (cmd === "delete_offer") {
        offers = offers.filter((item) => item.id !== args?.id);
        return null;
      }
      if (cmd === "sync_marketplace_offers") {
        devLog("INFO", "start platform=allegro");
        devLog("INFO", `done platform=allegro accounts=1 fetched=${offers.length} saved=${offers.length} conflicts=0`);
        devLog("INFO", "start platform=erli");
        devLog("INFO", "done platform=erli accounts=0 fetched=0 saved=0 conflicts=0");
        devLog("INFO", "start platform=inpost_merchant");
        devLog("INFO", "done platform=inpost_merchant accounts=1 fetched=1 saved=1 conflicts=0");
        return { accountsSynced: 2, fetched: offers.length, saved: offers.length, conflicts: 0, failedPlatforms: [] };
      }
      if (cmd === "sync_marketplace_offer_platform") {
        const platform = args?.platform === "inpost" ? "inpost_merchant" : String(args?.platform ?? "");
        const account = String(args?.account ?? "");
        const scoped = offers.filter((offer) => offer.sourcePlatform === platform && (!account || offer.accountName === account));
        const saved = scoped.length;
        devLog("INFO", `start_single platform=${platform} account_filter=${account || "all"}`);
        devLog("INFO", `done_single platform=${platform} accounts=${saved > 0 ? 1 : 0} fetched=${saved} saved=${saved} conflicts=0`);
        return { accountsSynced: saved > 0 ? 1 : 0, fetched: saved, saved, conflicts: 0, failedPlatforms: [] };
      }
      if (cmd === "create_marketplace_offer_draft") {
        const input = args?.input as CreateMarketplaceOfferDraftInput;
        if (input.platform !== "allegro") throw new Error("i18n:err_integration_operation");
        const id = Math.max(0, ...offers.map((item) => item.id)) + 1;
        const now = new Date().toISOString();
        const offer: Offer = {
          id,
          sourcePlatform: "allegro",
          accountName: input.accountName,
          externalOfferId: undefined,
          marketplace: "allegro-pl",
          title: "Nowa oferta Allegro",
          sku: `ALG-DRAFT-${id}`,
          status: "DRAFT",
          syncStatus: "LOCAL_ONLY",
          priceAmount: 0,
          currency: "PLN",
          availableQuantity: 0,
          taxRate: "23",
          category: "",
          conditionCode: "NEW",
          validationIssues: [],
          revision: 1,
          createdAt: now,
          updatedAt: now,
        };
        const payload = mockAllegroDraftPayload(offer);
        offers = [offer, ...offers];
        offerSourcePayloads.set(id, structuredClone(payload));
        offerDraftPayloads.set(id, structuredClone(payload));
        return { offer: structuredClone(offer), sourcePayload: structuredClone(payload), editablePayload: structuredClone(payload) };
      }
      if (cmd === "get_marketplace_offer_details") {
        const id = Number(args?.id);
        const current = offers.find((item) => item.id === id);
        if (!current) throw new Error("i18n:err_not_found");
        const source = offerSourcePayloads.get(id) ?? (current.sourcePlatform === "inpost_merchant" ? mockInpostOfferPayload(current) : current.sourcePlatform === "erli" ? mockErliOfferPayload(current) : mockAllegroOfferPayload(current));
        offerSourcePayloads.set(id, structuredClone(source));
        const now = new Date().toISOString();
        const loaded = { ...current, detailsLoadedAt: now, revision: current.detailsLoadedAt ? current.revision : current.revision + 1 };
        offers = offers.map((item) => item.id === id ? loaded : item);
        return {
          offer: structuredClone(loaded),
          sourcePayload: structuredClone(source),
          editablePayload: structuredClone(offerDraftPayloads.get(id) ?? source),
        };
      }
      if (cmd === "get_marketplace_offer_categories") {
        const categoryQuery = String(args?.query ?? "").trim();
        const categoryParentId = String(args?.parentId ?? "").trim();
        const rootCategories = [
          { id: "5", name: "Dom i ogrod", path: "", leaf: false },
          { id: "10", name: "Uroda", path: "", leaf: false },
          { id: "15", name: "Elektronika", path: "", leaf: false },
        ];
        const childCategories: Record<string, JsonObject[]> = {
          "5": [
            { id: "257139", name: "Karmy dla kotow", path: "Dom i ogrod / Zwierzeta / Koty", leaf: true },
            { id: "257138", name: "Akcesoria dla kotow", path: "Dom i ogrod / Zwierzeta / Koty", leaf: true },
          ],
          "10": [
            { id: "50926", name: "Kosmetyki do opalania", path: "Uroda / Opalanie / Samoopalacze", leaf: true },
            { id: "50927", name: "Pielegnacja twarzy", path: "Uroda / Twarz", leaf: true },
          ],
          "15": [
            { id: "260626", name: "Ladowarki sieciowe", path: "Elektronika / Telefony / Akcesoria", leaf: true },
          ],
        };
        const searchedCategories = Object.values(childCategories)
          .flat()
          .filter((item) => `${item.name} ${item.path}`.toLocaleLowerCase("pl-PL").includes(categoryQuery.toLocaleLowerCase("pl-PL")));
        return categoryQuery ? searchedCategories : (childCategories[categoryParentId] ?? rootCategories);
      }
      if (cmd === "get_marketplace_offer_editor_context") {
        const categoryId = String(args?.categoryId ?? "").trim();
        const categoryQuery = String(args?.categoryQuery ?? "").trim();
        const categoryParentId = String(args?.categoryParentId ?? "").trim();
        const rootCategories = [
          { id: "5", name: "Dom i ogrod", path: "", leaf: false },
          { id: "10", name: "Uroda", path: "", leaf: false },
          { id: "15", name: "Elektronika", path: "", leaf: false },
        ];
        const childCategories: Record<string, JsonObject[]> = {
          "5": [
            { id: "257139", name: "Karmy dla kotow", path: "Dom i ogrod / Zwierzeta / Koty", leaf: true },
            { id: "257138", name: "Akcesoria dla kotow", path: "Dom i ogrod / Zwierzeta / Koty", leaf: true },
          ],
          "10": [
            { id: "50926", name: "Kosmetyki do opalania", path: "Uroda / Opalanie / Samoopalacze", leaf: true },
            { id: "50927", name: "Pielegnacja twarzy", path: "Uroda / Twarz", leaf: true },
          ],
          "15": [
            { id: "260626", name: "Ladowarki sieciowe", path: "Elektronika / Telefony / Akcesoria", leaf: true },
          ],
        };
        const searchedCategories = Object.values(childCategories)
          .flat()
          .filter((item) => `${item.name} ${item.path}`.toLocaleLowerCase("pl-PL").includes(categoryQuery.toLocaleLowerCase("pl-PL")));
        const categorySuggestionItems = categoryQuery
          ? searchedCategories
          : (childCategories[categoryParentId] ?? rootCategories);
        return {
          marketplaces: [
            { id: "allegro-cz", label: "Allegro Czechy", currency: "CZK" },
            { id: "allegro-sk", label: "Allegro Słowacja", currency: "EUR" },
            { id: "allegro-hu", label: "Allegro Węgry", currency: "HUF" },
            { id: "allegro-business-pl", label: "Allegro Business Polska", currency: "PLN" },
            { id: "allegro-business-cz", label: "Allegro Business Czechy", currency: "CZK" },
            { id: "allegro-business-sk", label: "Allegro Business Słowacja", currency: "EUR" },
          ],
          shippingRates: [
            { id: "shipping-standard", name: "Kurier / odbiór w punkcie" },
            { id: "shipping-smart", name: "Cennik Smart!" },
          ],
          returnPolicies: [
            { id: "returns-14", name: "Zwrot 14 dni" },
            { id: "returns-30", name: "Zwrot 30 dni" },
          ],
          warranties: [
            { id: "warranty-standard", name: "Gwarancja sprzedawcy" },
          ],
          impliedWarranties: [
            { id: "complaints-standard", name: "Standardowe reklamacje" },
          ],
          sizeTables: [
            { id: "size-table-shirts", name: "Koszulki - tabela podstawowa", template: { id: "template-clothes" }, headers: [{ name: "Rozmiar" }, { name: "Klatka piersiowa" }], values: [{ cells: ["S", "88-92"] }, { cells: ["M", "93-97"] }] },
            { id: "size-table-shoes", name: "Obuwie - EU", template: { id: "template-shoes" }, headers: [{ name: "EU" }, { name: "Długość wkładki" }], values: [{ cells: ["39", "25 cm"] }, { cells: ["40", "25,5 cm"] }] },
          ],
          sizeTableTemplates: [
            { id: "template-clothes", name: "Odzież", headers: [{ name: "Rozmiar" }, { name: "Klatka piersiowa" }], values: [{ cells: ["S", ""] }, { cells: ["M", ""] }] },
            { id: "template-shoes", name: "Obuwie", headers: [{ name: "EU" }, { name: "Długość wkładki" }], values: [{ cells: ["39", ""] }, { cells: ["40", ""] }] },
          ],
          responsiblePersons: [
            { id: "gpsr-person-1", name: "Mania Commerce - GPSR", personalData: { name: "Mania Commerce sp. z o.o.", address: { countryCode: "PL", street: "ul. Handlowa 12", postalCode: "00-001", city: "Warszawa" }, contact: { email: "gpsr@mania.example", phoneNumber: "+48221234567", formUrl: "https://mania.example/kontakt" } } },
          ],
          responsibleProducers: [
            { id: "gpsr-producer-1", name: "Asther Cosmetics", producerData: { name: "Asther Cosmetics sp. z o.o.", address: { countryCode: "PL", street: "ul. Kosmetyczna 3", postalCode: "30-001", city: "Kraków" }, contact: { email: "safety@asther.example", phoneNumber: "+48123456789", formUrl: "https://asther.example/contact" } } },
          ],
          selectedCategory: categoryId ? { id: categoryId, name: categoryId === "257139" ? "Karmy dla kotów" : "Wybrana kategoria", path: "", leaf: true } : null,
          categorySuggestions: categorySuggestionItems,
          categoryParameters: categoryId ? [
            { id: "11323", name: "Stan", type: "dictionary", required: true, options: { describesProduct: false }, restrictions: { multipleChoices: false }, dictionary: [{ id: "11323_1", value: "Nowy" }, { id: "11323_2", value: "Używany" }, { id: "11323_246514", value: "Po zwrocie" }] },
            { id: "207682", name: "Rodzaj karmy", type: "dictionary", required: false, options: { describesProduct: true }, restrictions: { multipleChoices: true }, dictionary: [{ id: "207682_1", value: "bezzbożowa" }, { id: "207682_2", value: "monobiałkowa" }, { id: "207682_3", value: "hipoalergiczna" }] },
            { id: "222637", name: "Liczba sztuk w opakowaniu", type: "integer", required: false, options: { describesProduct: true }, restrictions: { min: 1, max: 1000 } },
            { id: "248811", name: "Marka", type: "string", required: true, options: { describesProduct: true, customValuesEnabled: true } },
            { id: "225693", name: "Kod producenta", type: "string", required: false, options: { describesProduct: true } },
          ] : [],
        };
      }
      if (cmd === "save_marketplace_offer_details") {
        const input = args?.input as SaveMarketplaceOfferDetails;
        const current = offers.find((item) => item.id === input.id);
        if (!current) throw new Error("i18n:err_not_found");
        if (input.expectedRevision !== current.revision) throw new Error("i18n:err_conflict");
        const payload = structuredClone(input.editablePayload);
        offerDraftPayloads.set(input.id, payload);
        const sellingMode = payload.sellingMode as JsonObject | undefined;
        const inpostPrice = (payload.price as JsonObject | undefined)?.grossPrice as JsonObject | undefined;
        const price = sellingMode?.price as JsonObject | undefined ?? inpostPrice;
        const stock = payload.stock as JsonObject | undefined;
        const external = payload.external as JsonObject | undefined;
        const images = Array.isArray(payload.images) ? payload.images : [];
        const product = payload.product as JsonObject | undefined;
        const firstObject = images[0] as JsonObject | undefined;
        const firstImage = typeof images[0] === "string" ? images[0] : (firstObject?.fileUrl ?? firstObject?.url);
        // Erli ma płaski model: price (grosze) i stock jako liczby, sku/name jako stringi.
        const erliPriceGrosze = typeof payload.price === "number" ? payload.price : undefined;
        const erliStock = typeof payload.stock === "number" ? payload.stock : undefined;
        const saved: Offer = {
          ...current,
          title: typeof payload.name === "string" ? payload.name : typeof product?.name === "string" ? product.name : current.title,
          sku: typeof external?.id === "string" ? external.id : typeof product?.sku === "string" ? product.sku : typeof payload.sku === "string" ? payload.sku : current.sku,
          priceAmount: erliPriceGrosze !== undefined ? erliPriceGrosze / 100 : Number(price?.amount ?? current.priceAmount),
          currency: typeof price?.currency === "string" ? price.currency : current.currency,
          availableQuantity: erliStock !== undefined ? erliStock : Number(stock?.available ?? stock?.quantity ?? current.availableQuantity),
          primaryImageUrl: typeof firstImage === "string" ? firstImage : undefined,
          syncStatus: "PENDING",
          revision: current.revision + 1,
          updatedAt: new Date().toISOString(),
        };
        offers = offers.map((item) => item.id === input.id ? saved : item);
        return null;
      }
      if (cmd === "push_marketplace_offer") {
        const id = Number(args?.id);
        const draft = offerDraftPayloads.get(id);
        if (draft) offerSourcePayloads.set(id, structuredClone(draft));
        offerDraftPayloads.delete(id);
        offers = offers.map((item) => item.id === id ? { ...item, externalOfferId: item.externalOfferId ?? `1580000${String(id).padStart(5, "0")}`, syncStatus: "SYNCED", externalUpdatedAt: new Date().toISOString() } : item);
        return null;
      }
      if (cmd === "upload_marketplace_offer_image") return "https://images.unsplash.com/photo-1587033411391-5d9e51cce126?auto=format&fit=crop&w=900&q=85";
      if (cmd === "upload_marketplace_offer_attachment") return { id: `attachment-${Date.now()}`, name: "safety-document.pdf" };
      if (cmd === "save_marketplace_gpsr_party") {
        const input = args?.input as { kind: string; value: JsonObject };
        return { ...input.value, id: String(input.value.id ?? `${input.kind.toLowerCase()}-${Date.now()}`) };
      }
      if (cmd === "save_marketplace_size_table") {
        const input = args?.input as { value: JsonObject };
        return { ...input.value, id: String(input.value.id ?? `size-table-${Date.now()}`) };
      }

      if (cmd === "list_invoices") return structuredClone(invoices);
      if (cmd === "save_invoice") {
        const input = args?.input as SaveInvoice;
        const current = input.id ? invoices.find((item) => item.id === input.id) : undefined;
        const id = current?.id ?? Math.max(0, ...invoices.map((item) => item.id)) + 1;
        const items = calculateItems(input.items);
        const netTotal = Number(items.reduce((sum, item) => sum + (item.netAmount ?? 0), 0).toFixed(2));
        const taxTotal = Number(items.reduce((sum, item) => sum + (item.taxAmount ?? 0), 0).toFixed(2));
        const now = new Date().toISOString();
        const saved: Invoice = {
          ...current,
          ...input,
          id,
          status: current?.status ?? "DRAFT",
          ksefStatus: current?.ksefStatus ?? "NOT_SENT",
          providerStatus: current?.providerStatus ?? "LOCAL",
          netTotal,
          taxTotal,
          grossTotal: Number((netTotal + taxTotal).toFixed(2)),
          paidAmount: current?.paidAmount ?? 0,
          revision: (current?.revision ?? 0) + 1,
          createdAt: current?.createdAt ?? now,
          updatedAt: now,
          items,
        };
        invoices = current ? invoices.map((item) => item.id === id ? saved : item) : [saved, ...invoices];
        return id;
      }
      if (cmd === "issue_invoice") {
        const id = args?.id as number;
        const current = invoices.find((item) => item.id === id);
        const number = current?.invoiceNumber ?? `FV/2026/07/${String(id).padStart(4, "0")}`;
        invoices = invoices.map((item) => item.id === id ? { ...item, invoiceNumber: number, status: "ISSUED", ksefStatus: "PENDING", issuedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), revision: item.revision + 1 } : item);
        return { invoiceNumber: number, providerStatus: "LOCAL", ksefStatus: "PENDING" };
      }
      if (cmd === "mark_invoice_paid") {
        invoices = invoices.map((item) => item.id === args?.id ? { ...item, status: "PAID", paidAmount: item.grossTotal, updatedAt: new Date().toISOString(), revision: item.revision + 1 } : item);
        return null;
      }
      if (cmd === "create_invoice_correction") {
        const originalId = args?.originalId as number;
        const original = invoices.find((item) => item.id === originalId);
        if (!original) throw new Error("Invoice not found");
        const id = Math.max(0, ...invoices.map((item) => item.id)) + 1;
        const now = new Date().toISOString();
        const items = calculateItems(original.items.map((item) => ({ ...item, id: undefined, quantity: -Math.abs(item.quantity) })));
        const netTotal = Number(items.reduce((sum, item) => sum + (item.netAmount ?? 0), 0).toFixed(2));
        const taxTotal = Number(items.reduce((sum, item) => sum + (item.taxAmount ?? 0), 0).toFixed(2));
        invoices = [{ ...original, id, invoiceNumber: undefined, documentType: "CORRECTION", status: "DRAFT", ksefStatus: "NOT_SENT", ksefNumber: undefined, correctedInvoiceId: originalId, correctionReason: String(args?.reason ?? ""), issueDate: dateAt(0), dueDate: undefined, netTotal, taxTotal, grossTotal: Number((netTotal + taxTotal).toFixed(2)), paidAmount: 0, revision: 1, createdAt: now, updatedAt: now, issuedAt: undefined, items }, ...invoices];
        return id;
      }
      if (cmd === "delete_invoice_draft") {
        invoices = invoices.filter((item) => item.id !== args?.id);
        return null;
      }
      if (cmd === "invoice_draft_from_order") {
        const order = orders.find((item) => item.id === args?.orderId);
        if (!order) throw new Error("Order not found");
        const street = order.invoiceStreet ?? order.buyerStreet ?? "";
        const postCode = order.invoiceZipCode ?? order.buyerZipCode ?? "";
        const city = order.invoiceCity ?? order.buyerCity ?? "";
        return {
          ...mockInvoiceDraft(), orderDbId: order.id, externalOrderId: order.externalOrderId,
          buyerName: order.invoiceCompany || `${order.invoiceFirstName ?? order.buyerFirstName ?? ""} ${order.invoiceLastName ?? order.buyerLastName ?? ""}`.trim(),
          buyerTaxId: order.invoiceTaxId ?? order.invoiceCompanyIdValue ?? "", buyerCompany: Boolean(order.invoiceCompany),
          buyerStreet: street, buyerPostCode: postCode, buyerCity: city, buyerAddress: [street, [postCode, city].filter(Boolean).join(" ")].filter(Boolean).join(", "),
          buyerEmail: order.buyerEmail, buyerPhone: order.buyerPhone, buyerCountry: order.invoiceCountry ?? order.buyerCountry ?? "PL",
          currency: order.currency ?? "PLN",
          items: order.items.map((item) => ({ name: item.productName ?? "Produkt", sku: item.externalOfferId, quantity: item.quantity ?? 1, unit: "szt.", unitNet: Number((Number(item.price ?? 0) / 1.23).toFixed(2)), taxRate: "23" })),
        } satisfies SaveInvoice;
      }
      if (cmd === "list_invoice_seller_profiles") return structuredClone(sellerProfiles);
      if (cmd === "save_invoice_seller_profile") {
        const input = args?.input as SaveInvoiceSellerProfile;
        const id = input.id ?? `demo-profile-${sellerProfiles.length + 1}`;
        if (input.active) sellerProfiles = sellerProfiles.map((item) => ({ ...item, active: false }));
        const previous = sellerProfiles.find((item) => item.id === id);
        const saved: InvoiceSellerProfile = {
          ...input, id, ksefConnectionStatus: previous?.ksefConnectionStatus ?? "NOT_CONFIGURED",
          createdAt: previous?.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString(),
        };
        sellerProfiles = previous ? sellerProfiles.map((item) => item.id === id ? saved : item) : [...sellerProfiles, saved];
        return id;
      }
      if (cmd === "delete_invoice_seller_profile") {
        sellerProfiles = sellerProfiles.filter((item) => item.id !== args?.id);
        return null;
      }
      if (cmd === "list_ksef_connections") return structuredClone(ksefConnections);
      if (cmd === "save_ksef_connection") {
        const input = args?.input as SaveKsefConnection;
        const id = `10000000-0000-4000-8000-${String(ksefConnections.length + 1).padStart(12, "0")}`;
        const saved: KsefConnection = {
          id, localProfileId: input.localProfileId, displayName: input.displayName, nip: input.nip,
          environment: input.environment, status: "CONFIGURED",
          localCertificateStored: false,
        };
        ksefConnections = [...ksefConnections.filter((item) => !(item.localProfileId === input.localProfileId && item.environment === input.environment)), saved];
        sellerProfiles = sellerProfiles.map((item) => item.id === input.localProfileId ? { ...item, ksefConnectionId: id, ksefEnvironment: input.environment, ksefConnectionStatus: "CONFIGURED" } : item);
        return { id, status: "CONFIGURED" };
      }
      if (cmd === "import_ksef_certificate") {
        ksefConnections = ksefConnections.map((item) => item.id === args?.id ? { ...item, localCertificateStored: true } : item);
        return { serialNumber: "0123456789ABCDEF", validFrom: new Date().toISOString(), validTo: isoAt(730), subject: "CN=Paczkowo KSeF Test" };
      }
      if (cmd === "verify_ksef_certificate_connection") {
        ksefConnections = ksefConnections.map((item) => item.id === args?.id ? { ...item, status: "VERIFIED", localCertificateStored: true, certificateSerialNumber: "0123456789ABCDEF", certificateValidTo: isoAt(730), lastVerifiedAt: new Date().toISOString() } : item);
        sellerProfiles = sellerProfiles.map((item) => item.id === args?.localProfileId ? { ...item, ksefConnectionStatus: "VERIFIED" } : item);
        return { status: "VERIFIED", accessValidTo: isoAt(1), certificateSerialNumber: "0123456789ABCDEF", certificateValidTo: isoAt(730) };
      }
      if (cmd === "delete_ksef_connection") {
        ksefConnections = ksefConnections.filter((item) => item.id !== args?.id);
        sellerProfiles = sellerProfiles.map((item) => item.id === args?.localProfileId ? { ...item, ksefConnectionId: undefined, ksefConnectionStatus: "NOT_CONFIGURED" } : item);
        return null;
      }
      if (cmd === "list_ksef_submissions") return [];
      if (cmd === "queue_invoice_to_ksef") {
        invoices = invoices.map((item) => item.id === args?.id ? { ...item, ksefStatus: "PENDING", updatedAt: new Date().toISOString() } : item);
        return true;
      }
      if (cmd === "archive_ksef_upo") return null;
      if (cmd === "list_invoice_provider_accounts") return structuredClone(invoiceProviders);
      if (cmd === "save_invoice_provider_account") {
        const input = args?.input as SaveInvoiceProviderAccount;
        const id = input.id ?? Math.max(0, ...invoiceProviders.map((item) => item.id)) + 1;
        if (input.active) invoiceProviders = invoiceProviders.map((item) => ({ ...item, active: false }));
        const saved: InvoiceProviderAccount = { id, provider: input.provider, displayName: input.displayName, apiBaseUrl: input.apiBaseUrl, active: input.active, ksefMode: input.provider === "fakturowo" ? "MANUAL" : input.ksefMode ?? "AUTO", configured: true };
        invoiceProviders = invoiceProviders.some((item) => item.id === id) ? invoiceProviders.map((item) => item.id === id ? saved : item) : [...invoiceProviders, saved];
        return id;
      }
      if (cmd === "set_active_invoice_provider_account") { invoiceProviders = invoiceProviders.map((item) => ({ ...item, active: item.id === args?.id })); return null; }
      if (cmd === "delete_invoice_provider_account") { invoiceProviders = invoiceProviders.filter((item) => item.id !== args?.id); return null; }
      if (cmd === "refresh_invoice_provider_status") { invoices = invoices.map((item) => item.id === args?.id ? { ...item, ksefStatus: "ACCEPTED", providerStatus: "KSEF_ACCEPTED" } : item); return null; }
      if (cmd === "recover_invoice_provider_issue") { invoices = invoices.map((item) => item.id === args?.id ? { ...item, providerDocumentId: `recovered-${item.id}`, providerStatus: "CREATED", providerError: undefined } : item); return { invoiceNumber: invoices.find((item) => item.id === args?.id)?.invoiceNumber ?? "", provider: "fakturownia", providerStatus: "CREATED", ksefStatus: "NOT_SENT" }; }

      if (cmd === "list_returns") return structuredClone(returns);
      if (cmd === "save_return") {
        const input = args?.input as SaveReturn;
        const current = input.id ? returns.find((item) => item.id === input.id) : undefined;
        const id = current?.id ?? Math.max(0, ...returns.map((item) => item.id)) + 1;
        const now = new Date().toISOString();
        const needsRefund = ["REFUND", "PARTIAL_REFUND"].includes(input.resolution);
        const saved: ReturnCase = {
          ...current,
          ...input,
          id,
          sourcePlatform: current?.sourcePlatform ?? "manual",
          status: current?.status ?? "REQUESTED",
          refundStatus: current?.refundStatus ?? (needsRefund ? "PENDING" : "NOT_REQUIRED"),
          refundDueAt: input.refundDueAt ?? new Date(`${input.requestedAt}T12:00:00Z`).toISOString().slice(0, 10),
          revision: (current?.revision ?? 0) + 1,
          createdAt: current?.createdAt ?? now,
          updatedAt: now,
        };
        if (!input.refundDueAt) saved.refundDueAt = new Date(new Date(`${input.requestedAt}T12:00:00Z`).getTime() + 14 * 86400000).toISOString().slice(0, 10);
        returns = current ? returns.map((item) => item.id === id ? saved : item) : [saved, ...returns];
        return id;
      }
      if (cmd === "transition_return") {
        const id = args?.id as number;
        const status = args?.status as ReturnCase["status"];
        const now = new Date().toISOString();
        returns = returns.map((item) => item.id === id ? {
          ...item,
          status,
          receivedAt: status === "RECEIVED" ? now : item.receivedAt,
          refundedAt: status === "REFUNDED" ? now : item.refundedAt,
          refundStatus: status === "REFUNDED" ? "COMPLETED" : status === "REJECTED" ? "NOT_REQUIRED" : item.refundStatus,
          revision: item.revision + 1,
          updatedAt: now,
        } : item);
        return null;
      }
      if (cmd === "delete_return") {
        returns = returns.filter((item) => item.id !== args?.id);
        return null;
      }
      if (cmd === "sync_marketplace_returns") return { accountsSynced: 1, fetched: returns.length, saved: returns.length, pendingRefunds: returns.filter((item) => item.refundStatus === "PENDING").length };
      if (cmd === "execute_return_refund") { returns = returns.map((item) => item.id === args?.id ? { ...item, refundStatus: "PENDING", refundId: `refund-${item.id}` } : item); return `refund-${args?.id}`; }
      if (cmd === "reject_marketplace_return") { const input = args?.input as { id: number }; returns = returns.map((item) => item.id === input.id ? { ...item, status: "REJECTED", refundStatus: "NOT_REQUIRED" } : item); return null; }

      if (cmd === "get_courier_data") return courierData(String(args?.login ?? ""));
      if (cmd === "get_pickups") return structuredClone(pickupLog);
      if (cmd === "get_delivery_services") {
        return [
          { deliveryMethodId: "dm-1", name: "Allegro Delivery — InPost Kurier", carrierId: "ALLEGRO", realCarrier: "InPost", owner: "ALLEGRO" },
          { deliveryMethodId: "dm-2", name: "Allegro Delivery — DPD Kurier", carrierId: "ALLEGRO", realCarrier: "DPD", owner: "ALLEGRO" },
          { deliveryMethodId: "dm-3", name: "Allegro Delivery — DHL Kurier", carrierId: "ALLEGRO", realCarrier: "DHL", owner: "ALLEGRO" },
          { deliveryMethodId: "dm-4", name: "Allegro One Kurier", carrierId: "ALLEGRO_ONE", realCarrier: "ORLEN Paczka", owner: "ALLEGRO" },
          { deliveryMethodId: "dm-5", name: "Poczta Polska Kurier", carrierId: "POCZTA_POLSKA", realCarrier: "Poczta Polska", owner: "SELLER" },
        ];
      }
      if (cmd === "get_pickup_times") {
        const ids = (args?.shipmentIds as string[] | undefined) ?? [];
        if (ids.length === 0) return [];
        return [1, 2, 3].flatMap((day) => [
          { date: dateAt(day), minTime: "10:00", maxTime: "14:00" },
          { date: dateAt(day), minTime: "12:00", maxTime: "16:00" },
          { date: dateAt(day), minTime: "14:00", maxTime: "18:00" },
        ]);
      }
      if (cmd === "create_pickup") {
        const req = (args?.request ?? {}) as { login?: string; shipmentIds?: string[]; date?: string; minTime?: string; maxTime?: string };
        const ids = req.shipmentIds ?? [];
        ids.forEach((id) => pickedShipments.add(id));
        const pickupId = `PU-${Date.now().toString().slice(-10)}`;
        pickupLog = [{ login: req.login ?? "", pickupId, date: req.date, minTime: req.minTime, maxTime: req.maxTime, count: ids.length, createdAt: new Date().toISOString() }, ...pickupLog];
        return { pickupId, pickups: 1 };
      }

      if (cmd === "get_integrations" || cmd === "refresh_integrations") {
        return integrations.map((it) => ({
          id: it.id,
          platform: it.platform,
          accountKey: it.accountName,
          accountName: it.accountName,
          collectOrders: it.collectOrders,
        }));
      }
      if (cmd === "get_account_options") {
        const it = integrations.find((x) => x.id === args?.integrationId);
        if (!it) throw new Error("i18n:err_account_not_found");
        const orderCount = orders.filter((o) => o.accountName === it.accountName).length;
        return { login: it.accountName, collectOrders: it.collectOrders, orders: orderCount, products: 0 };
      }
      if (cmd === "set_account_collect_orders") {
        integrations = integrations.map((it) => it.id === args?.integrationId ? { ...it, collectOrders: Boolean(args?.enabled) } : it);
        return null;
      }
      if (cmd === "purge_account_orders" || cmd === "purge_account_stock") return 0;
      if (cmd === "disconnect_integration") {
        integrations = integrations.filter((it) => it.id !== args?.integrationId);
        return null;
      }

      if (cmd in responses) return Promise.resolve(responses[cmd]);
      console.warn("[devMock] nieobsłużona komenda:", cmd);
      return null;
    },
  };
  console.info("[devMock] Zamockowany backend Tauri (?mock) — dane przykładowe.");
}
