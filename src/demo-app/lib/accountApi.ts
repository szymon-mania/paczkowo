// Klient serwera licencji/kont — wrappery na komendy Rust (server::account).
// Cała komunikacja idzie przez Rust (omija CORS, tokeny w app_settings).
import { invoke } from "@tauri-apps/api/core";

export type LicenseStatus = "TRIAL" | "PREMIUM" | "EXPIRED";
export type License = {
  status: LicenseStatus;
  plan: string; // trial | premium | none
  daysLeft: number;
  validUntil?: string;
  userId?: string; // sub z JWT — właściciel danych lokalnych
};

export type Integration = {
  id: string;
  platform: string;
  accountName: string;
  accountKey?: string;
  collectOrders?: boolean;
  status?: string | null;
  errorAction?: string | null;
  errorMessage?: string | null;
};

export function normalizePhone(phone: string) {
  return phone.trim().replace(/\u00A0/g, "").replace(/[\s().-]/g, "").replace(/＋/g, "+");
}

function requireInternationalPhone(phone: string) {
  const normalized = normalizePhone(phone);
  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
    throw new Error("err_phone_international_required");
  }
  return normalized;
}

export function setCurrentUser(userId: string, email?: string) {
  return invoke<void>("set_current_user", { userId, email: email || null });
}

export function getIntegrations() {
  return invoke<Integration[]>("get_integrations");
}

// Wymusza odświeżenie z serwera (pomija throttle) — do oczekiwania na koniec OAuth.
export function refreshIntegrations() {
  return invoke<Integration[]>("refresh_integrations");
}

export function disconnectIntegration(integrationId: string, purgeOrders = false, purgeStock = false) {
  return invoke<void>("disconnect_integration", { integrationId, purgeOrders, purgeStock });
}

export type AccountOptions = { login: string; collectOrders: boolean; orders: number; offers: number; products: number };
export function getAccountOptions(integrationId: string) {
  return invoke<AccountOptions>("get_account_options", { integrationId });
}
export function setCollectOrders(integrationId: string, enabled: boolean) {
  return invoke<void>("set_account_collect_orders", { integrationId, enabled });
}
export function purgeAccountOrders(integrationId: string) {
  return invoke<number>("purge_account_orders", { integrationId });
}
export function purgeAccountStock(integrationId: string) {
  return invoke<number>("purge_account_stock", { integrationId });
}

export function getCurrentUser() {
  return invoke<{ email: string; userId: string }>("get_current_user");
}

export function changePassword(oldPassword: string, newPassword: string) {
  return invoke<{ status?: string; message?: string }>("server_change_password", { oldPassword, newPassword });
}

export function serverRegister(email: string, password: string, name: string, surname: string, phone: string, companyName?: string) {
  return invoke<{ message: string; status: string; registrationToken: string; expiresInSeconds: number }>("server_register", { email, password, name, surname, phone: requireInternationalPhone(phone), companyName: companyName || null });
}

export function confirmRegistration(registrationToken: string, emailCode: string, phoneCode: string, email: string) {
  return invoke<{ status: string }>("server_confirm_registration", { registrationToken, emailCode, phoneCode, email });
}

export function serverLogin(email: string, password: string) {
  return invoke<{ status: string }>("server_login", { email, password });
}

// Logowanie Google (desktop OAuth w Rust). Zwraca m.in. requiresPhoneVerification.
export function googleLogin() {
  return invoke<{ requiresPhoneVerification?: boolean; isNewUser?: boolean; status?: string }>("google_login");
}

export type VerificationStatus = {
  emailVerified: boolean;
  phoneVerified: boolean;
  active?: boolean;
  licenseActive?: boolean;
  trialActive?: boolean;
  status?: string;
  plan?: string;
  daysLeft?: number;
  validUntil?: string;
};
export function verificationStatus() {
  return invoke<VerificationStatus>("server_verification_status");
}
export function resendEmailCode() {
  return invoke("server_resend_email");
}
export function verifyEmailCode(code: string) {
  return invoke("server_verify_email", { code });
}
export function resendPhoneCode(phone: string) {
  return invoke("server_resend_phone", { phone: requireInternationalPhone(phone) });
}
export function verifyPhoneCode(phone: string, code: string) {
  return invoke("server_verify_phone", { phone: requireInternationalPhone(phone), code });
}

export function serverLogout() {
  return invoke<void>("server_logout");
}

export function serverIsLoggedIn() {
  return invoke<boolean>("server_is_logged_in");
}

export function serverCheckout() {
  return invoke<string>("server_checkout");
}

export type UpdateManifest = {
  currentVersion: string;
  latestVersion: string;
  minimumRequiredVersion: string;
  downloadUrl: string;
  updateAvailable: boolean; // jest nowsza wersja (miękka zachęta)
  updateRequired: boolean;  // wersja poniżej minimum (twarda blokada)
};
export function checkUpdate() {
  return invoke<UpdateManifest>("check_update");
}

// Zgłoszenie z formularza pomocy (błąd / pytanie / prośba o integrację).
// Wysyłka przez Web3Forms (warstwa Rust) — patrz src-tauri/src/support.rs.
export type SupportRequest = { category: string; subject: string; message: string; user: string; email: string };
// Web3Forms blocks server-side requests on the free plan, so this goes from WebView.
const WEB3FORMS_ACCESS_KEY = "867d978c-740c-454a-ba07-80f58f3e6984";
const WEB3FORMS_ENDPOINT = "https://api.web3forms.com/submit";

export async function submitSupportRequest(input: SupportRequest) {
  const message = input.message.trim();
  if (!message) {
    throw new Error("err_support_empty");
  }

  const subject = input.subject.trim();
  const res = await fetch(WEB3FORMS_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      access_key: WEB3FORMS_ACCESS_KEY,
      subject: subject ? `[Paczkowo] ${input.category} - ${subject}` : `[Paczkowo] ${input.category}`,
      from_name: "Paczkowo - zgloszenie",
      replyto: input.email,
      Kategoria: input.category,
      Temat: subject,
      Tresc: message,
      Uzytkownik: input.user,
      "E-mail": input.email,
    }),
  }).catch(() => {
    throw new Error("err_server_unavailable");
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.success !== true) {
    throw new Error(data?.message || "err_support_failed");
  }
}

// Pobiera podpisany token licencji i dekoduje payload (do wyświetlenia statusu).
// Egzekwowanie i tak jest po stronie serwera (brak tokenów bez ważnej licencji).
export async function serverLicense(): Promise<License> {
  const token = await invoke<string>("server_license");
  const part = token.split(".")[1]?.replace(/-/g, "+").replace(/_/g, "/") ?? "";
  const json = JSON.parse(atob(part));
  return { status: json.status, plan: json.plan, daysLeft: json.daysLeft, validUntil: json.validUntil, userId: json.sub != null ? String(json.sub) : undefined };
}
