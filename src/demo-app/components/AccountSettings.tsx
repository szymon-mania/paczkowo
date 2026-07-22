import { useEffect, useState } from "react";
import { AlertTriangle, RefreshCw, Unplug } from "lucide-react";
import {
  disconnectIntegration,
  getAccountOptions,
  setCollectOrders,
  type AccountOptions,
  type Integration,
} from "../lib/accountApi";
import { T, translateMessage, useI18n } from "../lib/i18n";
import { CommerceModal } from "./CommerceUi";

function Toggle({ on, onChange }: { on: boolean; onChange: (value: boolean) => void }) {
  return (
    <button type="button" className={`account-toggle${on ? " on" : ""}`} onClick={() => onChange(!on)} aria-pressed={on}>
      <span />
    </button>
  );
}

export default function AccountSettings({
  integration,
  onClose,
  onChanged,
}: {
  integration: Integration;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const [opt, setOpt] = useState<AccountOptions | null>(null);
  const [collect, setCollect] = useState(true);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [disconnectStock, setDisconnectStock] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const reconnectRequired =
    integration.status === "ERROR" && integration.errorAction === "RECONNECT_REQUIRED";
  const reconnectMessage = integration.errorMessage || t(T.int_reconnect_required);

  const reload = () =>
    getAccountOptions(integration.id)
      .then((options) => {
        setOpt(options);
        setCollect(options.collectOrders);
      })
      .catch((error) => setMsg({ text: translateMessage(error, t), ok: false }));

  useEffect(() => {
    reload();
  }, [integration.id]);

  const toggleCollect = async (value: boolean) => {
    setCollect(value);
    try {
      await setCollectOrders(integration.id, value);
      onChanged();
    } catch (error) {
      setMsg({ text: translateMessage(error, t), ok: false });
      setCollect(!value);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await disconnectIntegration(integration.id, true, disconnectStock);
      onChanged();
      onClose();
    } catch (error) {
      setMsg({ text: translateMessage(error, t), ok: false });
    } finally {
      setBusy(false);
      setConfirmOpen(false);
    }
  };

  return (
    <CommerceModal title={t(T.as_title)} onClose={onClose}>
      <div className="account-settings">
        <div className="account-settings-identity">
          <span>{integration.platform}</span>
          <strong>{integration.accountName}</strong>
        </div>

        {reconnectRequired && (
          <div className="commerce-alert danger account-reconnect-alert">
            <AlertTriangle size={16} />
            <span>{reconnectMessage} {t(T.int_reconnect_required_body)}</span>
          </div>
        )}

        <section className="account-settings-section">
          <div className="account-settings-icon"><RefreshCw size={16} /></div>
          <div className="account-settings-copy">
            <h4>{t(T.set_sync)}</h4>
            <strong>{t(T.as_collect_orders)}</strong>
            <p>{t(T.as_collect_desc)}</p>
          </div>
          <Toggle on={collect} onChange={toggleCollect} />
        </section>

        <section className="account-settings-section vertical danger">
          <div className="account-settings-section-head">
            <div className="account-settings-icon"><Unplug size={16} /></div>
            <div className="account-settings-copy">
              <h4>{t(T.as_disconnect_section)}</h4>
              <p>{integration.accountName}</p>
            </div>
          </div>

          {!disconnectOpen ? (
            <button type="button" onClick={() => setDisconnectOpen(true)} className="btn account-danger-action">
              <Unplug size={14} />
              {t(T.as_disconnect_btn)}
            </button>
          ) : (
            <div className="account-disconnect-box">
              <p>{t(T.as_disconnect_body_1)} <b>{integration.accountName}</b> {t(T.as_disconnect_body_2)}</p>
              <label className="account-settings-option">
                <span>{t(T.as_also_stock)}{opt ? ` (${opt.products})` : ""}</span>
                <Toggle on={disconnectStock} onChange={setDisconnectStock} />
              </label>
              <button type="button" onClick={() => setConfirmOpen(true)} disabled={busy} className="btn account-danger-action">
                <Unplug size={14} />
                {busy ? t(T.as_working) : t(T.as_disconnect_idle)}
              </button>
              <button type="button" onClick={() => setDisconnectOpen(false)} className="btn btn-secondary">{t(T.common_cancel)}</button>
            </div>
          )}
        </section>

        {msg && <div className={`commerce-alert ${msg.ok ? "good" : "danger"}`}>{msg.text}</div>}
      </div>
      {confirmOpen && (
        <div className="account-confirm-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setConfirmOpen(false); }}>
          <section className="account-confirm-dialog" role="dialog" aria-modal="true" aria-label={t(T.as_disconnect_confirm)}>
            <div className="account-confirm-icon"><Unplug size={18} /></div>
            <h4>{t(T.as_disconnect_confirm)}</h4>
            <p>Czy na pewno chcesz odłączyć konto <b>{integration.accountName}</b>?</p>
            <div className="account-confirm-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setConfirmOpen(false)} disabled={busy}>{t(T.common_cancel)}</button>
              <button type="button" className="btn account-danger-action solid" onClick={disconnect} disabled={busy}>
                <Unplug size={14} />
                {busy ? t(T.as_working) : t(T.as_disconnect_idle)}
              </button>
            </div>
          </section>
        </div>
      )}
    </CommerceModal>
  );
}
