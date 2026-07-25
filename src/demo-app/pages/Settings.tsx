import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { changePassword, type License, type UpdateManifest } from "../lib/accountApi";
import { installUpdateOrOpen } from "../lib/updater";
import { LanguageSelect } from "../components/LanguageSelect";
import { translateMessage, useI18n, T } from "../lib/i18n";

type Theme = "light" | "dark";

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card elev-sm" style={{ marginBottom: 14 }}>
      <div className="card-kicker">{title}</div>
      <div style={{ marginTop: 4 }}>{children}</div>
    </div>
  );
}
function Row({ label, value, color }: { label: string; value: React.ReactNode; color?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: "1px solid var(--color-divider)", fontSize: 13 }}>
      <span className="text-muted">{label}</span>
      <span style={{ fontWeight: 600, color: color ?? "var(--text)" }}>{value}</span>
    </div>
  );
}

export default function Settings({ license, email, integrationsCount, theme, setTheme, syncIntervalMin, setSyncIntervalMin, onSyncNow, syncing, onUpgrade, onLogout, update, updateChecking, onCheckUpdate }: {
  license: License | null;
  email: string;
  integrationsCount: number;
  theme: Theme;
  setTheme: (t: Theme) => void;
  syncIntervalMin: number;
  setSyncIntervalMin: (m: number) => void;
  onSyncNow: () => void;
  syncing: boolean;
  onUpgrade: () => void;
  onLogout: () => void;
  update: UpdateManifest | null;
  updateChecking: boolean;
  onCheckUpdate: () => void | Promise<void>;
}) {
  const { t, lang } = useI18n();
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installPct, setInstallPct] = useState(0);
  const [installErr, setInstallErr] = useState<string | null>(null);
  const [installMsg, setInstallMsg] = useState<string | null>(null);
  const [checkMsg, setCheckMsg] = useState<{ text: string; ok: boolean } | null>(null);

  async function onInstall() {
    setInstalling(true);
    setInstallErr(null);
    setInstallMsg(t(T.set_install_checking));
    setInstallPct(0);
    try {
      const outcome = await installUpdateOrOpen((p) => {
        setInstallPct(p.percent);
        setInstallMsg(t(T.set_install_downloading, { p: p.percent }));
      });
      if (outcome === "none") setInstallMsg(t(T.set_install_none));
    } catch (e) {
      setInstallErr(`${t(T.set_install_failed)}: ${translateMessage(e, t)}`);
      setInstallMsg(null);
    } finally {
      setInstalling(false);
    }
  }

  async function handleCheckUpdate() {
    setCheckMsg(null);
    setInstallErr(null);
    setInstallMsg(null);
    try {
      await onCheckUpdate();
      setCheckMsg({ text: t(T.set_check_done), ok: true });
    } catch (e) {
      setCheckMsg({ text: `${t(T.set_check_fail)}: ${translateMessage(e, t)}`, ok: false });
    }
  }

  async function submitPw() {
    if (newPw.length < 10) { setPwMsg({ text: t(T.set_pw_min), ok: false }); return; }
    if (newPw !== newPw2) { setPwMsg({ text: t(T.set_pw_mismatch), ok: false }); return; }
    setPwBusy(true);
    setPwMsg(null);
    try {
      await changePassword(oldPw, newPw);
      setOldPw(""); setNewPw(""); setNewPw2("");
      setPwMsg({ text: t(T.set_pw_changed), ok: true });
    } catch (e) {
      setPwMsg({ text: translateMessage(e, t), ok: false });
    } finally {
      setPwBusy(false);
    }
  }

  const premium = license?.status === "PREMIUM";
  const planText = license ? t(license.status === "PREMIUM" ? T.plan_premium : license.status === "EXPIRED" ? T.plan_expired : T.plan_trial) : t(T.common_none_dash);
  const lbl: React.CSSProperties = { fontSize: 12, color: "var(--muted)", fontWeight: 600, display: "block", marginBottom: 8 };

  return (
    <main style={{ flex: 1, overflow: "auto", padding: "28px 32px 60px" }}>
      <div style={{ maxWidth: 680, margin: "0 auto" }}>
        <h2 style={{ margin: "0 0 4px" }}>{t(T.menu_settings)}</h2>
        <p className="text-muted" style={{ margin: "0 0 20px", fontSize: 13 }}>{t(T.set_subtitle)}</p>

        <Card title={t(T.set_hints)}>
          <div style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.55 }}>{t(T.set_hints_body)}</div>
        </Card>

        <Card title={t(T.set_account)}>
          <Row label={t(T.auth_email)} value={email || t(T.common_none_dash)} />
          <Row label={t(T.set_plan)} value={planText} color={premium ? "var(--accent)" : license?.status === "EXPIRED" ? "#dc2626" : "var(--text)"} />
          <Row label={premium ? t(T.set_days_renew) : t(T.set_days_left)} value={license?.daysLeft ?? 0} color={(license?.daysLeft ?? 0) <= 3 && !premium ? "#dc2626" : "var(--text)"} />
          <Row label={t(T.set_valid_until)} value={license?.validUntil ? new Date(license.validUntil).toLocaleDateString(lang === "en" ? "en-GB" : "pl-PL") : t(T.common_none_dash)} />
          <Row label={t(T.set_connected_accounts)} value={integrationsCount} />
          <button type="button" onClick={onUpgrade} className="btn btn-primary" style={{ marginTop: 12 }}>
            {premium ? t(T.set_manage_sub) : t(T.acct_buy_premium)}
          </button>
        </Card>

        <Card title={t(T.set_updates)}>
          <Row label={t(T.set_current_version)} value={update?.currentVersion ?? t(T.common_none_dash)} />
          <Row label={t(T.set_latest_version)} value={update?.latestVersion ?? t(T.common_none_dash)} />
          {update && !update.updateAvailable && !update.updateRequired && (
            <div style={{ marginTop: 12, fontSize: 13, color: "#16a34a", fontWeight: 600 }}>{t(T.set_up_to_date)}</div>
          )}
          {update?.updateAvailable && !update.updateRequired && (
            <div style={{ marginTop: 12, background: "var(--accent-soft)", border: "1px solid var(--accent)", borderRadius: "var(--radius-md)", padding: "12px 14px" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--accent)", marginBottom: 4 }}>{t(T.set_new_version, { v: update.latestVersion })}</div>
              <div className="text-muted" style={{ fontSize: 12, marginBottom: 10 }}>{t(T.set_update_optional)}</div>
              <button type="button" onClick={onInstall} disabled={installing} className="btn btn-primary">
                {installing ? (installPct > 0 ? `${t(T.set_installing)} ${installPct}%` : t(T.set_installing)) : t(T.set_install_update)}
              </button>
              {installMsg && <div style={{ fontSize: 12, color: installing ? "var(--text2)" : "#16a34a", marginTop: 8 }}>{installMsg}</div>}
              {installErr && <div style={{ fontSize: 12, color: "#f4515b", marginTop: 8 }}>{installErr}</div>}
            </div>
          )}
          <button type="button" onClick={handleCheckUpdate} disabled={updateChecking} className="btn btn-secondary" style={{ marginTop: 12, fontSize: 13 }}>
            <RefreshCw size={14} style={{ animation: updateChecking ? "spin 1s linear infinite" : "none" }} />
            {updateChecking ? t(T.set_checking) : t(T.set_check_updates)}
          </button>
          {checkMsg && <div style={{ fontSize: 12, color: checkMsg.ok ? "#16a34a" : "#f4515b", marginTop: 8 }}>{checkMsg.text}</div>}
        </Card>

        <Card title={t(T.set_language)}>
          <div style={{ marginTop: 6 }}><LanguageSelect /></div>
        </Card>

        <Card title={t(T.set_appearance)}>
          <div style={{ marginTop: 6 }}>
            <div className="seg" role="radiogroup" aria-label={t(T.set_appearance)}>
              {(["light", "dark"] as const).map((th) => (
                <label key={th} className="seg-opt">
                  <input type="radio" name="theme" checked={theme === th} onChange={() => setTheme(th)} />{th === "light" ? t(T.set_theme_light) : t(T.set_theme_dark)}
                </label>
              ))}
            </div>
          </div>
        </Card>

        <Card title={t(T.set_sync)}>
          <div className="text-muted" style={{ fontSize: 13, marginBottom: 10 }}>{t(T.set_sync_desc)}</div>
          <div className="seg" role="radiogroup" aria-label={t(T.set_sync)}>
            {[5, 10, 15].map((m) => (
              <label key={m} className="seg-opt">
                <input type="radio" name="syncint" checked={syncIntervalMin === m} onChange={() => setSyncIntervalMin(m)} />{m} min
              </label>
            ))}
          </div>
          {import.meta.env.DEV && (
            <div style={{ marginTop: 14 }}>
              <button type="button" onClick={onSyncNow} disabled={syncing} className="btn btn-primary" style={{ fontSize: 13 }}>
                <RefreshCw size={14} style={{ animation: syncing ? "spin 1s linear infinite" : "none" }} />
                {syncing ? t(T.set_syncing) : t(T.set_sync_now_dev)}
              </button>
            </div>
          )}
        </Card>

        <Card title={t(T.set_change_password)}>
          <label style={lbl}>{t(T.set_current_password)}<input type="password" className="input" value={oldPw} onChange={(e) => setOldPw(e.target.value)} style={{ marginTop: 4 }} /></label>
          <label style={lbl}>{t(T.set_new_password)}<input type="password" className="input" value={newPw} onChange={(e) => setNewPw(e.target.value)} style={{ marginTop: 4 }} /></label>
          <label style={lbl}>{t(T.set_repeat_password)}<input type="password" className="input" value={newPw2} onChange={(e) => setNewPw2(e.target.value)} style={{ marginTop: 4 }} /></label>
          {pwMsg && <div style={{ fontSize: 12, marginBottom: 8, color: pwMsg.ok ? "#16a34a" : "#f4515b" }}>{pwMsg.text}</div>}
          <button type="button" onClick={submitPw} disabled={pwBusy || !oldPw || !newPw} className="btn btn-primary">
            {pwBusy ? t(T.set_pw_changing) : t(T.set_pw_submit)}
          </button>
        </Card>

        <button type="button" onClick={onLogout} className="btn" style={{ color: "#f4515b", border: "1px solid color-mix(in srgb, #f4515b 40%, transparent)" }}>{t(T.menu_logout)}</button>
      </div>
    </main>
  );
}
