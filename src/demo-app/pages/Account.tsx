import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { serverLogin, serverRegister, confirmRegistration, serverCheckout, googleLogin, verificationStatus, resendEmailCode, verifyEmailCode, resendPhoneCode, verifyPhoneCode, type License } from "../lib/accountApi";
import { PhoneField } from "../components/PhoneField";
import { LanguageSelect } from "../components/LanguageSelect";
import DevTerminal, { writeFrontendDevLog } from "../components/DevTerminal";
import { translateMessage, useI18n, T } from "../lib/i18n";

const wrap: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "var(--bg)", color: "var(--text)", fontFamily: "var(--font-body)", padding: 24 };
const card: React.CSSProperties = { width: 400, maxWidth: "100%", padding: "22px 26px 26px" };
const lbl: React.CSSProperties = { fontSize: 12, color: "var(--muted)", fontWeight: 600, display: "block", marginBottom: 10 };
const errBox: React.CSSProperties = { border: "1px solid color-mix(in srgb, #f4515b 40%, transparent)", background: "color-mix(in srgb, #f4515b 12%, transparent)", color: "#f4515b", fontSize: 12, padding: "9px 12px", borderRadius: "var(--radius-md)", marginBottom: 10 };
const cta = (disabled: boolean): React.CSSProperties => ({ width: "100%", background: disabled ? "var(--border)" : "var(--accent)", color: disabled ? "var(--muted2)" : "#fff", border: "none", borderRadius: "var(--radius-md)", padding: "11px 16px", fontSize: 14, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer", marginTop: 4 });
const linkBtn: React.CSSProperties = { border: "none", background: "none", color: "var(--accent)", fontWeight: 600, cursor: "pointer", fontSize: 12 };

function msgBox(m: { text: string; ok: boolean }): React.CSSProperties {
  return { fontSize: 12, padding: "9px 12px", borderRadius: "var(--radius-md)", border: "1px solid var(--color-divider)", background: "color-mix(in srgb, var(--color-text) 4%, transparent)", color: m.ok ? "#16a34a" : "#f4515b" };
}

// ─── EKRAN LOGOWANIA / REJESTRACJI ───────────────────────────────────────────
export function AuthScreen({ onAuthed, notice }: { onAuthed: () => void; notice?: string }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [surname, setSurname] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [registrationToken, setRegistrationToken] = useState("");
  const [registrationEmailCode, setRegistrationEmailCode] = useState("");
  const [registrationPhoneCode, setRegistrationPhoneCode] = useState("");

  async function submit() {
    setBusy(true);
    setErr("");
    try {
      if (mode === "register") {
        const pending = await serverRegister(email.trim(), password, name.trim(), surname.trim(), phone.trim(), company.trim() || undefined);
        if (!pending.registrationToken) throw new Error(T.err_registration_token_missing);
        setRegistrationToken(pending.registrationToken);
        return;
      } else {
        await serverLogin(email.trim(), password);
      }
      localStorage.setItem("userEmail", email.trim());
      onAuthed();
    } catch (e) {
      setErr(translateMessage(e, t));
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setBusy(true);
    setErr("");
    try {
      writeFrontendDevLog("INFO", "auth.google", "start");
      await googleLogin();
      writeFrontendDevLog("INFO", "auth.google", "success");
      onAuthed();
    } catch (e) {
      const translated = translateMessage(e, t);
      writeFrontendDevLog("ERROR", "auth.google", {
        raw: e,
        translated,
      });
      setErr(translated);
    } finally {
      setBusy(false);
    }
  }

  async function confirmPendingRegistration() {
    setBusy(true);
    setErr("");
    try {
      await confirmRegistration(registrationToken, registrationEmailCode.trim(), registrationPhoneCode.trim(), email.trim());
      localStorage.setItem("userEmail", email.trim());
      onAuthed();
    } catch (e) {
      setErr(translateMessage(e, t));
    } finally {
      setBusy(false);
    }
  }

  if (registrationToken) return (
    <>
      <div style={wrap}>
        <div className="card elev-sm" style={card}>
          <h2 style={{ marginTop: 0 }}>{t(T.auth_confirm_title)}</h2>
          <p className="text-muted" style={{ fontSize: 13 }}>{t(T.auth_confirm_desc)}</p>
          <label style={lbl}>{t(T.auth_email_code)}<input className="input" value={registrationEmailCode} onChange={(e) => setRegistrationEmailCode(e.target.value.replace(/\D/g, "").slice(0, 6))} style={{ marginTop: 4 }} inputMode="numeric" required /></label>
          <label style={lbl}>{t(T.auth_sms_code)}<input className="input" value={registrationPhoneCode} onChange={(e) => setRegistrationPhoneCode(e.target.value.replace(/\D/g, "").slice(0, 10))} style={{ marginTop: 4 }} inputMode="numeric" required /></label>
          {err && <div style={errBox}>{err}</div>}
          <button onClick={confirmPendingRegistration} disabled={busy || registrationEmailCode.length !== 6 || registrationPhoneCode.length < 4} style={cta(busy || registrationEmailCode.length !== 6 || registrationPhoneCode.length < 4)}>{busy ? t(T.auth_confirming) : t(T.auth_confirm_create)}</button>
          <button onClick={() => { setRegistrationToken(""); setErr(""); }} disabled={busy} style={{ width: "100%", marginTop: 10, border: "none", background: "transparent", color: "var(--muted)", cursor: "pointer" }}>{t(T.auth_back_to_form)}</button>
        </div>
      </div>
      <DevTerminal defaultOpen />
    </>
  );

  return (
    <>
      <div style={wrap}>
        <div className="card elev-sm" style={card}>
          <div style={{ textAlign: "center", marginBottom: 16, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <img src="/logos/logo150.png" alt="Paczkowo" width={84} height={84} style={{ display: "block" }} />
            <div style={{ fontWeight: 800, fontSize: 22, color: "#ff2a2a", letterSpacing: "-0.03em" }}>Paczkowo</div>
            <div className="text-muted" style={{ fontSize: 12 }}>{t(T.auth_tagline)}</div>
            <div style={{ marginTop: 8 }}><LanguageSelect size="sm" /></div>
          </div>

        {notice && (
          <div style={{ ...errBox, color: "var(--text2)", background: "color-mix(in srgb, var(--accent2) 12%, transparent)", borderColor: "color-mix(in srgb, var(--accent2) 40%, transparent)", textAlign: "center" }}>{notice}</div>
        )}

        <div className="seg" role="radiogroup" aria-label={t(T.auth_tab_login)} style={{ display: "flex", width: "100%", marginBottom: 18 }}>
          {(["login", "register"] as const).map((m) => (
            <label key={m} className="seg-opt" style={{ flex: 1, justifyContent: "center" }}>
              <input type="radio" name="authmode" checked={mode === m} onChange={() => { setMode(m); setErr(""); }} />
              {m === "login" ? t(T.auth_tab_login) : t(T.auth_tab_register)}
            </label>
          ))}
        </div>

        <form onSubmit={(e) => { e.preventDefault(); if (!busy) submit(); }}>
          {mode === "register" && (
            <div style={{ display: "flex", gap: 10 }}>
              <label style={lbl}>{t(T.auth_first_name)}<input className="input" value={name} onChange={(e) => setName(e.target.value)} style={{ marginTop: 4 }} required /></label>
              <label style={lbl}>{t(T.auth_last_name)}<input className="input" value={surname} onChange={(e) => setSurname(e.target.value)} style={{ marginTop: 4 }} required /></label>
            </div>
          )}
          <label style={lbl}>{t(T.auth_email)}<input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ marginTop: 4 }} required /></label>
          <label style={lbl}>{t(T.auth_password)}<input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ marginTop: 4 }} required minLength={mode === "register" ? 10 : 6} maxLength={72} /></label>
          {mode === "register" && (
            <>
              <label style={lbl}>{t(T.auth_phone)}<PhoneField value={phone} onChange={setPhone} required /></label>
              <label style={lbl}>{t(T.auth_company)} <span className="text-muted">{t(T.common_optional)}</span><input className="input" value={company} onChange={(e) => setCompany(e.target.value)} style={{ marginTop: 4 }} /></label>
            </>
          )}

          {err && <div style={errBox}>{err}</div>}

          <button type="submit" disabled={busy} style={cta(busy)}>
            {busy ? t(T.common_please_wait) : mode === "login" ? t(T.auth_btn_login) : t(T.auth_btn_register)}
          </button>
        </form>

        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "16px 0" }}>
          <div style={{ flex: 1, height: 1, background: "var(--color-divider)" }} />
          <span className="text-muted" style={{ fontSize: 11 }}>{t(T.common_or)}</span>
          <div style={{ flex: 1, height: 1, background: "var(--color-divider)" }} />
        </div>
        <button onClick={google} disabled={busy} className="btn btn-secondary btn-block" style={{ gap: 10 }}>
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.5 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.5 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.1-11.3-7.6l-6.5 5C9.6 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.1 5.6l6.2 5.2C39.9 36 44 30.6 44 24c0-1.3-.1-2.3-.4-3.5z"/></svg>
          {t(T.auth_google)}
        </button>

        <div className="text-muted" style={{ textAlign: "center", fontSize: 12, marginTop: 14 }}>
          {mode === "login" ? t(T.auth_no_account) : t(T.auth_have_account)}{" "}
          <button onClick={() => { setMode(mode === "login" ? "register" : "login"); setErr(""); }} style={linkBtn}>
            {mode === "login" ? t(T.auth_go_register) : t(T.auth_go_login)}
          </button>
        </div>
        </div>
      </div>
      <DevTerminal defaultOpen />
    </>
  );
}

// ─── EKRAN WERYFIKACJI E-MAIL + TELEFON (start triala) ───────────────────────
export function VerificationScreen({ onVerified, onLogout }: { onVerified: () => void; onLogout: () => void }) {
  const { t } = useI18n();
  const [emailVerified, setEmailVerified] = useState(false);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [emailCode, setEmailCode] = useState("");
  const [phoneNum, setPhoneNum] = useState("");
  const [phoneCode, setPhoneCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  async function refresh() {
    try {
      const s = await verificationStatus();
      setEmailVerified(!!s.emailVerified);
      setPhoneVerified(!!s.phoneVerified);
      if (s.active || s.licenseActive || (s.emailVerified && s.phoneVerified)) onVerified();
    } catch { /* ignore */ }
  }
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, []);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg({ text: ok, ok: true }); await refresh(); }
    catch (e) { setMsg({ text: translateMessage(e, t), ok: false }); }
    finally { setBusy(false); }
  }

  return (
    <div style={wrap}>
      <div className="card elev-sm" style={card}>
        <div style={{ textAlign: "center", marginBottom: 14 }}>
          <h2 style={{ margin: 0 }}>{t(T.verify_title)}</h2>
          <div className="text-muted" style={{ fontSize: 13, marginTop: 6 }}>{t(T.verify_desc)}</div>
        </div>

        <div style={{ border: "1px solid var(--color-divider)", borderRadius: "var(--radius-md)", padding: 14, marginBottom: 12 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>{emailVerified ? t(T.verify_email_done) : t(T.verify_email)}</div>
          {!emailVerified && (
            <>
              <div style={{ display: "flex", gap: 8 }}>
                <input className="input" value={emailCode} onChange={(e) => setEmailCode(e.target.value)} placeholder={t(T.auth_email_code)} />
                <button disabled={busy || !emailCode} onClick={() => run(() => verifyEmailCode(emailCode.trim()), t(T.verify_email_done))} style={cta(busy || !emailCode)}>{t(T.common_confirm)}</button>
              </div>
              <button disabled={busy} onClick={() => run(() => resendEmailCode(), t(T.verify_sent_email))} style={{ ...linkBtn, marginTop: 8 }}>{t(T.verify_resend_email)}</button>
            </>
          )}
        </div>

        <div style={{ border: "1px solid var(--color-divider)", borderRadius: "var(--radius-md)", padding: 14, marginBottom: 12 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>{phoneVerified ? t(T.verify_phone_done) : t(T.verify_phone)}</div>
          {!phoneVerified && (
            <>
              <PhoneField value={phoneNum} onChange={setPhoneNum} />
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <input className="input" value={phoneCode} onChange={(e) => setPhoneCode(e.target.value)} placeholder={t(T.auth_sms_code)} />
                <button disabled={busy || !phoneCode || !phoneNum} onClick={() => run(() => verifyPhoneCode(phoneNum.trim(), phoneCode.trim()), t(T.verify_phone_done))} style={cta(busy || !phoneCode || !phoneNum)}>{t(T.common_confirm)}</button>
              </div>
              <button disabled={busy || !phoneNum} onClick={() => run(() => resendPhoneCode(phoneNum.trim()), t(T.verify_sent_sms))} style={{ ...linkBtn, marginTop: 8, cursor: busy || !phoneNum ? "not-allowed" : "pointer" }}>{t(T.verify_resend_sms)}</button>
            </>
          )}
        </div>

        {msg && <div style={msgBox(msg)}>{msg.text}</div>}

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14 }}>
          <button onClick={refresh} style={{ ...linkBtn, color: "var(--muted)" }}>{t(T.verify_refresh)}</button>
          <button onClick={onLogout} style={{ ...linkBtn, color: "var(--muted2)" }}>{t(T.menu_logout)}</button>
        </div>
      </div>
    </div>
  );
}

// ─── EKRAN WYGASŁEJ LICENCJI / WYBÓR PLANU ───────────────────────────────────
export function UpgradeScreen({ license, onRefresh, onLogout }: { license: License | null; onRefresh: () => void; onLogout: () => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(onRefresh, 4000);
    return () => clearInterval(timer);
  }, [waiting, onRefresh]);

  async function buy() {
    setBusy(true);
    setMsg("");
    try {
      const url = await serverCheckout();
      await invoke("open_url", { url });
      setWaiting(true);
      setMsg(t(T.upgrade_payment_opened));
    } catch (e) {
      setMsg(translateMessage(e, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={wrap}>
      <div className="card elev-sm" style={card}>
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <h2 style={{ margin: "6px 0 0" }}>{license?.status === "EXPIRED" ? t(T.upgrade_expired_title) : t(T.upgrade_choose_title)}</h2>
          <div className="text-muted" style={{ fontSize: 13, marginTop: 6 }}>{t(T.upgrade_desc)}</div>
        </div>

        <button onClick={buy} disabled={busy} style={cta(busy)}>{busy ? t(T.upgrade_opening) : t(T.acct_buy_premium)}</button>
        <button onClick={onRefresh} className="btn btn-secondary btn-block">{t(T.upgrade_check_again)}</button>

        {msg && <div style={{ fontSize: 12, padding: "9px 12px", borderRadius: "var(--radius-md)", border: "1px solid var(--color-divider)", background: "color-mix(in srgb, var(--color-text) 4%, transparent)", color: "var(--text2)", marginTop: 12 }}>{msg}</div>}

        <div style={{ textAlign: "center", marginTop: 16 }}>
          <button onClick={onLogout} style={{ ...linkBtn, color: "var(--muted2)" }}>{t(T.menu_logout)}</button>
        </div>
      </div>
    </div>
  );
}

// ─── EKRAN „USŁUGI NIEDOSTĘPNE" (serwer offline) ─────────────────────────────
export function ServerDownScreen({ onRetry, onLogout }: { onRetry: () => void; onLogout: () => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  return (
    <div style={wrap}>
      <div className="card elev-sm" style={{ ...card, textAlign: "center" }}>
        <h2 style={{ margin: "6px 0 0" }}>{t(T.down_title)}</h2>
        <div className="text-muted" style={{ fontSize: 13, marginTop: 8, lineHeight: 1.5 }}>{t(T.down_desc)}</div>
        <button
          onClick={async () => { setBusy(true); try { await onRetry(); } finally { setBusy(false); } }}
          disabled={busy}
          style={cta(busy)}
        >
          {busy ? t(T.down_connecting) : t(T.down_retry)}
        </button>
        <div style={{ marginTop: 16 }}>
          <button onClick={onLogout} style={{ ...linkBtn, color: "var(--muted2)" }}>{t(T.menu_logout)}</button>
        </div>
      </div>
    </div>
  );
}
