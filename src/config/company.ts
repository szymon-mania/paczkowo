/** Dane operatora: jedno źródło prawdy dla dokumentów prawnych. */
export const company = {
  legalName: "Katarzyna Mania",
  address: "ul. Skrajna 1, 64-610 Rogoźno",
  email: "paczkowo.net@gmail.com",
  /** Pusty NIP nie jest renderowany. Uzupełnij, a pojawi się w obu dokumentach. */
  nip: "",
  site: "paczkowo.net",
  hosting: "OVH Sp. z o.o. (ovh.pl)",
  /** Data widoczna jako „Ostatnia aktualizacja" w obu dokumentach. */
  updated: "25 lipca 2026",
} as const;

/** „Katarzyna Mania, ul. Skrajna 1, 64-610 Rogoźno, NIP: …", NIP tylko gdy uzupełniony. */
export const companyLine = [company.legalName, company.address, company.nip && `NIP: ${company.nip}`]
  .filter(Boolean)
  .join(", ");
