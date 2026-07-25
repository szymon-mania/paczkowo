import { useState } from "react";
import { invoke } from "../lib/serverStatus";
import { ChevronDown, ChevronUp, Truck } from "lucide-react";
import type { Account } from "../lib/types";
import { T, translateMessage, useI18n } from "../lib/i18n";

type Service = { deliveryMethodId?: string; credentialsId?: string; name?: string; carrierId?: string; owner?: string };

export default function CourierAccounts({ accounts, accountLabels }: { accounts: Account[]; accountLabels?: Map<string, string> }) {
  const { t } = useI18n();
  const [openLogin, setOpenLogin] = useState<string | null>(null);
  const [services, setServices] = useState<Record<string, Service[]>>({});
  const [loading, setLoading] = useState<string | null>(null);
  const [err, setErr] = useState<string>("");

  async function toggle(login: string) {
    if (openLogin === login) { setOpenLogin(null); return; }
    setOpenLogin(login);
    setErr("");
    if (!services[login]) {
      setLoading(login);
      try {
        const list = await invoke<Service[]>("get_delivery_services", { login });
        setServices((s) => ({ ...s, [login]: list }));
      } catch (e) {
        setErr(`${login}: ${translateMessage(e, t)}`);
      } finally {
        setLoading(null);
      }
    }
  }

  return (
    <section className="card elev-sm courier-accounts">
      <div className="cp-head">
        <Truck size={15} />
        <h3>{t(T.ca_title)}</h3>
        <span className="cp-count">{accounts.length}</span>
      </div>
      <p className="cp-subhead">{t(T.ca_desc)}</p>
      <div className="courier-account-list">
        {accounts.length === 0 && <div style={{ padding: 20, color: "var(--muted2)", fontSize: 13 }}>{t(T.ca_no_accounts)}</div>}
        {accounts.map((a) => (
          <div key={a.integrationId} className="courier-account-row">
            <button onClick={() => toggle(a.login)} className="courier-account-trigger">
              <span className="courier-account-name"><Truck size={15} /><span><strong>{accountLabels?.get(a.login) || a.login}</strong><small>Allegro</small></span></span>
              <span className="courier-account-action">{openLogin === a.login ? <ChevronUp size={15} /> : <ChevronDown size={15} />} {openLogin === a.login ? t(T.ca_hide) : t(T.ca_show)}</span>
            </button>
            {openLogin === a.login && (
              <div style={{ padding: "0 16px 14px" }}>
                {loading === a.login ? (
                  <div style={{ color: "var(--muted2)", fontSize: 12 }}>{t(T.ca_loading_services)}</div>
                ) : (services[a.login] && services[a.login].length > 0) ? (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ textAlign: "left", color: "var(--muted2)", fontSize: 10, fontWeight: 700, textTransform: "uppercase" }}>
                        <th style={{ padding: "4px 8px 4px 0" }}>{t(T.cp_col_carrier)}</th>
                        <th style={{ padding: "4px 8px" }}>{t(T.ca_col_service)}</th>
                        <th style={{ padding: "4px 8px" }}>{t(T.ca_col_contract)}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {services[a.login].map((s, i) => (
                        <tr key={i} style={{ borderTop: "1px solid var(--border2)" }}>
                          <td style={{ padding: "6px 8px 6px 0", fontWeight: 600 }}>{s.carrierId ?? "—"}</td>
                          <td style={{ padding: "6px 8px", color: "var(--text2)" }}>{s.name ?? s.deliveryMethodId ?? "—"}</td>
                          <td style={{ padding: "6px 8px", color: s.owner === "CLIENT" ? "#15803d" : "var(--muted)" }}>{s.owner === "CLIENT" ? t(T.ca_own) : "Allegro"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div style={{ color: "var(--muted2)", fontSize: 12 }}>{t(T.ca_no_services)}</div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      {err && <div className="cp-subhead" style={{ color: "#b91c1c" }}>{err}</div>}
    </section>
  );
}
