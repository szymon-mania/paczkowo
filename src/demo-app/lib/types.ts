// Wspólne typy danych zwracane przez backend (get_orders).

export type OrderItem = {
  externalOfferId?: string;
  productName?: string;
  quantity?: number;
  price?: string;
  currency?: string;
  boughtAt?: string;
  productUrl?: string;
  imageUrl?: string;
};

export type DerivedStatus =
  | "nieoplacone"
  | "do_wyslania"
  | "anulowane"
  | "wyslane"
  | "archiwum";

export type Shipment = {
  id: string;
  provider: string;
  marketplace: string;
  trackingNumber?: string;
  carrier?: string;
  service?: string;
  labelPath?: string;
  status: string;
  externalStatus?: string;
  createdAt?: string;
};

export type Order = {
  id: number;
  accountName: string;
  accountDisplayName?: string;
  externalOrderId: string;
  marketplace: string;
  messageToSeller?: string;
  deliveryCost?: string;
  deliveryCurrency?: string;
  externalOrderStatus?: string;
  externalFulfillmentStatus?: string;
  totalToPay?: string;
  currency?: string;
  externalUpdatedAt?: string;
  derivedStatus: DerivedStatus;
  carrier: string;
  shipments: Shipment[];
  orderCreatedAt?: string;

  buyerLogin?: string;
  buyerEmail?: string;
  buyerFirstName?: string;
  buyerLastName?: string;
  buyerCompanyName?: string;
  buyerStreet?: string;
  buyerCity?: string;
  buyerZipCode?: string;
  buyerCountry?: string;
  buyerPhone?: string;

  deliveryMethodId?: string;
  deliveryMethodName?: string;
  deliveryFirstName?: string;
  deliveryLastName?: string;
  deliveryStreet?: string;
  deliveryCity?: string;
  deliveryZipCode?: string;
  deliveryCountry?: string;
  deliveryCompany?: string;
  deliveryPhone?: string;

  pickupPointId?: string;
  pickupPointName?: string;
  pickupDescription?: string;
  pickupStreet?: string;
  pickupZipCode?: string;
  pickupCity?: string;
  pickupCountry?: string;

  paymentId?: string;
  paymentType?: string;
  paymentProvider?: string;
  paymentFinishedAt?: string;
  paymentAmount?: string;
  paymentCurrency?: string;

  invoiceRequired?: boolean;
  invoiceStreet?: string;
  invoiceCity?: string;
  invoiceZipCode?: string;
  invoiceCountry?: string;
  invoiceCompany?: string;
  invoiceCompanyIdType?: string;
  invoiceCompanyIdValue?: string;
  invoiceVatPayerStatus?: string;
  invoiceTaxId?: string;
  invoiceFirstName?: string;
  invoiceLastName?: string;
  invoiceDueDate?: string;

  items: OrderItem[];
};

export type Account = {
  integrationId: string;
  allegroId?: string;
  login: string;
  firstName?: string;
  lastName?: string;
  email?: string;
};
