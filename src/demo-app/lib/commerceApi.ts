import { invoke } from "./serverStatus";
import type { Order } from "./types";

export type OfferStatus = "DRAFT" | "READY" | "ACTIVE" | "PAUSED" | "ENDED" | "ERROR";
export type OfferSyncStatus = "LOCAL_ONLY" | "PENDING" | "SYNCED" | "ERROR" | "CONFLICT";
export type Offer = {
  id: number; sourcePlatform: string; accountName?: string; externalOfferId?: string;
  marketplace?: string; title: string; sku: string; ean?: string; status: OfferStatus;
  syncStatus: OfferSyncStatus; priceAmount: number; currency: string;
  availableQuantity: number; taxRate: string; category?: string; brand?: string;
  conditionCode: string; description?: string; validationIssues: { code: string; severity: string; messageKey: string; path?: string }[];
  primaryImageUrl?: string; revision: number; createdAt: string; updatedAt: string;
  externalUpdatedAt?: string; detailsLoadedAt?: string;
};
export type OfferListQuery = {
  page: number; pageSize: number; search: string; status: OfferStatus | null;
  platforms: string[]; accounts: string[];
};
export type OfferFacet = { key: string; count: number; label?: string; platforms?: string[] };
export type OfferListResponse = {
  offers: Offer[]; total: number; page: number; pageSize: number;
  platformFacets: OfferFacet[]; accountFacets: OfferFacet[];
  statusCounts: Partial<Record<OfferStatus, number>>;
  activeStockValues: { currency: string; amount: number }[];
};
export type OfferSyncResult = {
  accountsSynced: number; fetched: number; saved: number; conflicts: number; failedPlatforms: string[];
};
export type SaveOffer = {
  id?: number; expectedRevision?: number; title: string; sku: string; ean?: string;
  priceAmount: number; currency: string; availableQuantity: number; taxRate: string;
  category?: string; brand?: string; conditionCode: string; description?: string;
};
export type JsonObject = Record<string, unknown>;
export type OfferDetails = { offer: Offer; sourcePayload: JsonObject; editablePayload: JsonObject };
export type OfferEditorContext = JsonObject;
export type SaveMarketplaceOfferDetails = {
  id: number; expectedRevision: number; editablePayload: JsonObject;
};
export type CreateMarketplaceOfferDraftInput = {
  platform: string; accountName: string;
};
export type UploadMarketplaceOfferImage = {
  id: number; fileName: string; contentType: string; bytes: number[];
};
export type UploadMarketplaceOfferAttachment = {
  id: number; fileName: string; contentType: string; bytes: number[];
};
export type SaveMarketplaceGpsrParty = {
  id: number; kind: "PERSON" | "PRODUCER"; value: JsonObject;
};
export type SaveMarketplaceSizeTable = {
  id: number; value: JsonObject;
};

export type InvoiceStatus = "DRAFT" | "ISSUED" | "PAID" | "CANCELLED";
export type KsefStatus = "NOT_SENT" | "PENDING" | "ACCEPTED" | "REJECTED" | "OFFLINE" | "NOT_REQUIRED";
export type InvoiceDocumentType = "INVOICE" | "CORRECTION";
export type Fa3InvoiceKind = "VAT" | "KOR" | "ZAL" | "ROZ" | "UPR" | "KOR_ZAL" | "KOR_ROZ";
export type TaxTreatment = "DOMESTIC" | "EU_B2B" | "OSS" | "EXPORT" | "EXEMPT";
export type InvoiceItem = {
  id?: number; position?: number; name: string; sku?: string; quantity: number; unit: string;
  unitNet: number; taxRate: string; netAmount?: number; taxAmount?: number; grossAmount?: number;
  ean?: string; pkwiu?: string; cn?: string; pkob?: string; gtu?: string; discount?: number;
};
export type Invoice = {
  id: number; invoiceNumber?: string; documentType: InvoiceDocumentType; invoiceKind: Fa3InvoiceKind;
  sellerProfileId?: string; status: InvoiceStatus;
  ksefStatus: KsefStatus; ksefNumber?: string; orderDbId?: number; externalOrderId?: string;
  correctedInvoiceId?: number; correctionReason?: string; issueDate: string; issuePlace?: string; saleDate: string;
  periodFrom?: string; periodTo?: string;
  dueDate?: string; sellerName: string; sellerTaxId?: string; sellerAddress: string;
  sellerStreet?: string; sellerPostCode?: string; sellerCity?: string; sellerEmail?: string; sellerPhone?: string;
  sellerCountry: string; buyerName: string; buyerTaxId?: string; buyerAddress: string;
  buyerStreet?: string; buyerPostCode?: string; buyerCity?: string; buyerEmail?: string; buyerPhone?: string;
  buyerCompany: boolean; buyerTaxNoKind?: string;
  buyerCountry: string; currency: string; currencyRate?: number; currencyRateDate?: string;
  paymentMethod: string; paymentState: "UNPAID" | "PARTIAL" | "PAID";
  paymentDate?: string; bankAccount?: string; bankSwift?: string; splitPayment: boolean;
  cashAccounting: boolean; selfBilling: boolean; reverseCharge: boolean; marginScheme?: string;
  correctionEffect?: number; fa3PayloadJson: string; fa3XmlHash?: string; ksefEnvironment?: KsefEnvironment;
  ksefSubmissionId?: string; ksefSessionReference?: string; ksefInvoiceReference?: string;
  ksefErrorCode?: string; ksefOfflineMode: boolean; ksefOfflineDeadline?: string;
  taxTreatment: TaxTreatment;
  exemptTaxKind?: string; npTaxKind?: string;
  netTotal: number; taxTotal: number; grossTotal: number; paidAmount: number; notes?: string;
  providerAccountId?: number; provider?: string; providerDocumentId?: string; providerStatus: string;
  providerViewUrl?: string; providerPdfUrl?: string; providerError?: string;
  revision: number; createdAt: string; updatedAt: string; issuedAt?: string; items: InvoiceItem[];
};
export type SaveInvoice = Omit<Invoice, "id" | "invoiceNumber" | "status" | "ksefStatus" | "ksefNumber" | "fa3XmlHash" | "ksefEnvironment" | "ksefSubmissionId" | "ksefSessionReference" | "ksefInvoiceReference" | "ksefErrorCode" | "ksefOfflineDeadline" | "netTotal" | "taxTotal" | "grossTotal" | "paidAmount" | "revision" | "createdAt" | "updatedAt" | "issuedAt" | "providerAccountId" | "provider" | "providerDocumentId" | "providerStatus" | "providerViewUrl" | "providerPdfUrl" | "providerError"> & {
  id?: number; expectedRevision?: number;
};
export type IssueInvoiceResult = { invoiceNumber: string; provider?: string; providerStatus: string; ksefStatus: string; warningCode?: string };
export type InvoiceProviderAccount = {
  id: number; provider: "fakturownia" | "fakturowo"; displayName: string; apiBaseUrl: string;
  active: boolean; ksefMode: "AUTO" | "MANUAL"; configured: boolean;
};
export type SaveInvoiceProviderAccount = {
  id?: number; provider: InvoiceProviderAccount["provider"]; displayName: string; apiBaseUrl: string;
  apiToken: string; active: boolean; ksefMode?: InvoiceProviderAccount["ksefMode"];
};
export type KsefEnvironment = "TEST" | "DEMO" | "PRODUCTION";
export type InvoiceSellerProfile = {
  id: string; displayName: string; legalName: string; nip: string; street: string; postCode: string;
  city: string; country: string; email?: string; phone?: string; bankAccount?: string; bankSwift?: string;
  krs?: string; regon?: string; bdo?: string; issuePlace?: string; numberingPrefix: string; active: boolean;
  ksefConnectionId?: string; ksefEnvironment: KsefEnvironment;
  ksefConnectionStatus: "NOT_CONFIGURED" | "CONFIGURED" | "VERIFIED" | "EXPIRED" | "ERROR";
  createdAt: string; updatedAt: string;
};
export type SaveInvoiceSellerProfile = Omit<InvoiceSellerProfile, "id" | "ksefConnectionStatus" | "createdAt" | "updatedAt"> & { id?: string };
export type KsefConnection = {
  id: string; localProfileId: string; displayName: string; nip: string; environment: KsefEnvironment;
  status: string;
  localCertificateStored?: boolean;
  certificateSerialNumber?: string; certificateValidTo?: string; lastVerifiedAt?: string; lastErrorCode?: string;
};
export type KsefCertificateMetadata = {
  serialNumber: string; validFrom: string; validTo: string; subject: string;
};
export type SaveKsefConnection = {
  localProfileId: string; displayName: string; nip: string; environment: KsefEnvironment;
};
export type KsefSubmission = {
  id: string; localDocumentId: string; status: "QUEUED" | "PROCESSING" | "SENT" | "ACCEPTED" | "REJECTED" | "RETRY";
  offlineMode: boolean; sessionReferenceNumber?: string; invoiceReferenceNumber?: string;
  ksefNumber?: string; lastErrorCode?: string;
};

export type ReturnType = "WITHDRAWAL" | "COMPLAINT" | "MARKETPLACE_RETURN";
export type ReturnStatus = "REQUESTED" | "AUTHORIZED" | "IN_TRANSIT" | "RECEIVED" | "INSPECTING" | "ACCEPTED" | "REJECTED" | "REFUNDED" | "CLOSED";
export type ReturnResolution = "PENDING" | "REFUND" | "PARTIAL_REFUND" | "REPLACEMENT" | "REPAIR" | "STORE_CREDIT";
export type RefundStatus = "NOT_REQUIRED" | "PENDING" | "COMPLETED" | "FAILED";
export type RestockPolicy = "INSPECT" | "RESTOCK" | "QUARANTINE" | "DISPOSE" | "RETURN_TO_SUPPLIER";
export type ReturnItem = { id?: number; orderItemId?: string; sku?: string; name: string; imageUrl?: string; quantity: number; itemCondition: string; resolution: ReturnResolution };
/** Konto kupującego — przy pobraniu/przelewie zwrot idzie przelewem, nie przez API. */
export type RefundBankAccount = { owner?: string; accountNumber?: string; iban?: string; swift?: string; address?: string };
export type CommissionClaimStatus = "IN_PROGRESS" | "GRANTED" | "REJECTED" | "CANCELLED";
export type ReturnCase = {
  id: number; sourcePlatform: string; accountName?: string; externalReturnId?: string;
  externalStatus?: string; paymentId?: string; refundId?: string; refundError?: string;
  refundBankAccount?: RefundBankAccount; rejectionCode?: string; rejectionReason?: string;
  commissionClaimIds?: string; commissionClaimStatus?: CommissionClaimStatus;
  returnLabelPath?: string; returnLabelTracking?: string; returnLabelCarrier?: string;
  orderDbId?: number; externalOrderId?: string; customerName: string; customerEmail?: string;
  returnType: ReturnType; status: ReturnStatus; resolution: ReturnResolution; reasonCode: string;
  reasonDetails?: string; requestedAt: string; refundDueAt?: string; receivedAt?: string;
  refundedAt?: string; refundStatus: RefundStatus; refundAmount: number; currency: string;
  returnCarrier?: string; trackingNumber?: string; restockPolicy: RestockPolicy; notes?: string;
  revision: number; createdAt: string; updatedAt: string; items: ReturnItem[];
};
export type ReturnSyncResult = { accountsSynced: number; fetched: number; saved: number; pendingRefunds: number };
export type ReturnLabelAddress = {
  name?: string; companyName?: string; email?: string; phone?: string;
  street?: string; city?: string; postCode?: string; countryCode?: string; targetPoint?: string;
};
export type CreateReturnLabelInput = {
  returnId: number; receiver: ReturnLabelAddress; sender?: ReturnLabelAddress;
  template?: string; lengthCm?: number; widthCm?: number; heightCm?: number; weightKg?: number; comments?: string;
};
export type SaveReturn = Omit<ReturnCase, "id" | "sourcePlatform" | "accountName" | "externalReturnId" | "status" | "refundStatus" | "receivedAt" | "refundedAt" | "revision" | "createdAt" | "updatedAt"> & {
  id?: number; expectedRevision?: number;
};

export const listOffers = (query: OfferListQuery) => invoke<OfferListResponse>("list_offers", { query });
export const listOrders = () => invoke<{ orders: Order[] }>("get_orders").then((result) => result.orders);
export const saveOffer = (input: SaveOffer) => invoke<number>("save_offer", { input });
export const changeOfferStatus = (id: number, status: OfferStatus) => invoke<void>("change_offer_status", { id, status });
export const deleteOffer = (id: number) => invoke<void>("delete_offer", { id });
export const syncMarketplaceOffers = (account?: string) => invoke<OfferSyncResult>("sync_marketplace_offers", { account });
export const syncMarketplaceOfferPlatform = (platform: string, account?: string) => invoke<OfferSyncResult>("sync_marketplace_offer_platform", { platform, account });
export const createMarketplaceOfferDraft = (input: CreateMarketplaceOfferDraftInput) => invoke<OfferDetails>("create_marketplace_offer_draft", { input });
export const pushMarketplaceOffer = (id: number) => invoke<void>("push_marketplace_offer", { id });
export const getMarketplaceOfferDetails = (id: number) => invoke<OfferDetails>("get_marketplace_offer_details", { id });
export const getMarketplaceOfferEditorContext = (id: number, categoryId?: string, categoryQuery?: string, categoryParentId?: string) => invoke<OfferEditorContext>("get_marketplace_offer_editor_context", { id, categoryId: categoryId || null, categoryQuery: categoryQuery || null, categoryParentId: categoryParentId || null });
export const getMarketplaceOfferCategories = (id: number, parentId?: string, query?: string) => invoke<JsonObject[]>("get_marketplace_offer_categories", { id, parentId: parentId || null, query: query || null });
export const saveMarketplaceOfferDetails = (input: SaveMarketplaceOfferDetails) => invoke<void>("save_marketplace_offer_details", { input });
export const uploadMarketplaceOfferImage = (input: UploadMarketplaceOfferImage) => invoke<string>("upload_marketplace_offer_image", { input });
export const uploadMarketplaceOfferAttachment = (input: UploadMarketplaceOfferAttachment) => invoke<{ id: string; name: string }>("upload_marketplace_offer_attachment", { input });
export const saveMarketplaceGpsrParty = (input: SaveMarketplaceGpsrParty) => invoke<JsonObject>("save_marketplace_gpsr_party", { input });
export const saveMarketplaceSizeTable = (input: SaveMarketplaceSizeTable) => invoke<JsonObject>("save_marketplace_size_table", { input });

export const listInvoices = () => invoke<Invoice[]>("list_invoices");
export const getInvoiceForOrder = (orderId: number) => invoke<Invoice | null>("get_invoice_for_order", { orderId });
export const saveInvoice = (input: SaveInvoice) => invoke<number>("save_invoice", { input });
export const issueInvoice = (id: number) => invoke<IssueInvoiceResult>("issue_invoice", { id });
export const markInvoicePaid = (id: number) => invoke<void>("mark_invoice_paid", { id });
export const createInvoiceCorrection = (originalId: number, reason: string) => invoke<number>("create_invoice_correction", { originalId, reason });
export const deleteInvoiceDraft = (id: number) => invoke<void>("delete_invoice_draft", { id });
export const getInvoiceFa3Xml = (id: number) => invoke<string>("get_invoice_fa3_xml", { id });
export const queueInvoiceToKsef = (id: number) => invoke<boolean>("queue_invoice_to_ksef", { id });
export const invoiceDraftFromOrder = (orderId: number) => invoke<SaveInvoice>("invoice_draft_from_order", { orderId });
export const listInvoiceSellerProfiles = () => invoke<InvoiceSellerProfile[]>("list_invoice_seller_profiles");
export const saveInvoiceSellerProfile = (input: SaveInvoiceSellerProfile) => invoke<string>("save_invoice_seller_profile", { input });
export const deleteInvoiceSellerProfile = (id: string) => invoke<void>("delete_invoice_seller_profile", { id });
export const listKsefConnections = () => invoke<KsefConnection[]>("list_ksef_connections");
export const saveKsefConnection = (input: SaveKsefConnection) => invoke<{ id: string; status: string }>("save_ksef_connection", { input });
export const importKsefCertificate = (id: string, password: string) => invoke<KsefCertificateMetadata>("import_ksef_certificate", { id, password });
export const verifyKsefCertificateConnection = (id: string, localProfileId: string) => invoke<{ status: string; accessValidTo?: string; certificateSerialNumber?: string; certificateValidTo?: string }>("verify_ksef_certificate_connection", { id, localProfileId });
export const deleteKsefConnection = (id: string, localProfileId: string) => invoke<void>("delete_ksef_connection", { id, localProfileId });
export const listKsefSubmissions = () => invoke<KsefSubmission[]>("list_ksef_submissions");
export const archiveKsefUpo = (submissionId: string, invoiceId: number) => invoke<void>("archive_ksef_upo", { submissionId, invoiceId });
export const listInvoiceProviderAccounts = () => invoke<InvoiceProviderAccount[]>("list_invoice_provider_accounts");
export const connectFakturowniaInvoiceProvider = (input: { apiToken: string; accountDomain: string; accountName?: string }) =>
  invoke<InvoiceProviderAccount>("connect_fakturownia_invoice_provider", { apiToken: input.apiToken, accountDomain: input.accountDomain, accountName: input.accountName || null });
export const connectFakturowoInvoiceProvider = (input: { apiId: string; accountName?: string; apiUrl?: string }) =>
  invoke<InvoiceProviderAccount>("connect_fakturowo_invoice_provider", { apiId: input.apiId, accountName: input.accountName || null, apiUrl: input.apiUrl || null });
export const saveInvoiceProviderAccount = (input: SaveInvoiceProviderAccount) => invoke<number>("save_invoice_provider_account", { input });
export const setActiveInvoiceProviderAccount = (id: number) => invoke<void>("set_active_invoice_provider_account", { id });
export const deleteInvoiceProviderAccount = (id: number) => invoke<void>("delete_invoice_provider_account", { id });
export const refreshInvoiceProviderStatus = (id: number) => invoke<void>("refresh_invoice_provider_status", { id });
export const recoverInvoiceProviderIssue = (id: number) => invoke<IssueInvoiceResult>("recover_invoice_provider_issue", { id });

export const listReturns = () => invoke<ReturnCase[]>("list_returns");
export const saveReturn = (input: SaveReturn) => invoke<number>("save_return", { input });
export const transitionReturn = (id: number, status: ReturnStatus) => invoke<void>("transition_return", { id, status });
export const deleteReturn = (id: number) => invoke<void>("delete_return", { id });
export const syncMarketplaceReturns = () => invoke<ReturnSyncResult>("sync_marketplace_returns");
export const syncMarketplaceReturnPlatform = (platform: string, account?: string) => invoke<ReturnSyncResult>("sync_marketplace_return_platform", { platform, account });
export const executeReturnRefund = (id: number) => invoke<string>("execute_return_refund", { id });
export const rejectMarketplaceReturn = (id: number, code: string, reason?: string) => invoke<void>("reject_marketplace_return", { input: { id, code, reason } });
/** Rabat transakcyjny — wniosek o zwrot prowizji za zwrócone pozycje (Allegro, 45 dni). */
export const claimReturnCommission = (id: number) => invoke<string>("claim_return_commission", { id });
export const refreshReturnCommission = (id: number) => invoke<CommissionClaimStatus>("refresh_return_commission", { id });
/** Etykieta zwrotna z własnej umowy InPost (ShipX) — kupujący nadaje, sprzedawca płaci. */
export const createReturnLabel = (input: CreateReturnLabelInput) => invoke<{ trackingNumber: string; labelPath: string; carrier: string }>("create_return_label", { request: input });
