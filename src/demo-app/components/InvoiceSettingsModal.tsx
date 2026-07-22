import { useEffect, useMemo, useState } from "react";
import { BadgeCheck, Building2, FileKey2, Plus, ShieldCheck, Trash2 } from "lucide-react";

import {
  deleteInvoiceSellerProfile,
  deleteKsefConnection,
  importKsefCertificate,
  listInvoiceSellerProfiles,
  listKsefConnections,
  saveInvoiceSellerProfile,
  saveKsefConnection,
  verifyKsefCertificateConnection,
  type InvoiceSellerProfile,
  type KsefConnection,
  type KsefEnvironment,
  type SaveInvoiceSellerProfile,
} from "../lib/commerceApi";
import { T, translateMessage, useI18n } from "../lib/i18n";
import { CommerceModal, Field, StatusPill } from "./CommerceUi";

type Props = { onClose: () => void; onChanged: () => void };

const blankProfile = (): SaveInvoiceSellerProfile => ({
  displayName: "",
  legalName: "",
  nip: "",
  street: "",
  postCode: "",
  city: "",
  country: "PL",
  email: "",
  phone: "",
  bankAccount: "",
  bankSwift: "",
  krs: "",
  regon: "",
  bdo: "",
  issuePlace: "",
  numberingPrefix: "FV",
  active: true,
  ksefConnectionId: undefined,
  ksefEnvironment: "TEST",
});

const editProfile = (profile: InvoiceSellerProfile): SaveInvoiceSellerProfile => ({
  id: profile.id,
  displayName: profile.displayName,
  legalName: profile.legalName,
  nip: profile.nip,
  street: profile.street,
  postCode: profile.postCode,
  city: profile.city,
  country: profile.country,
  email: profile.email,
  phone: profile.phone,
  bankAccount: profile.bankAccount,
  bankSwift: profile.bankSwift,
  krs: profile.krs,
  regon: profile.regon,
  bdo: profile.bdo,
  issuePlace: profile.issuePlace,
  numberingPrefix: profile.numberingPrefix,
  active: profile.active,
  ksefConnectionId: profile.ksefConnectionId,
  ksefEnvironment: profile.ksefEnvironment,
});

export default function InvoiceSettingsModal({ onClose, onChanged }: Props) {
  const { t } = useI18n();
  const [profiles, setProfiles] = useState<InvoiceSellerProfile[]>([]);
  const [connections, setConnections] = useState<KsefConnection[]>([]);
  const [editing, setEditing] = useState<SaveInvoiceSellerProfile>(blankProfile());
  const [certificatePassword, setCertificatePassword] = useState("");
  const [environment, setEnvironment] = useState<KsefEnvironment>("TEST");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = async (preferredId?: string) => {
    const [loadedProfiles, loadedConnections] = await Promise.all([
      listInvoiceSellerProfiles(),
      listKsefConnections().catch(() => [] as KsefConnection[]),
    ]);
    setProfiles(loadedProfiles);
    setConnections(loadedConnections);
    const selected = loadedProfiles.find((profile) => profile.id === preferredId)
      ?? loadedProfiles.find((profile) => profile.id === editing.id)
      ?? loadedProfiles.find((profile) => profile.active)
      ?? loadedProfiles[0];
    setEditing(selected ? editProfile(selected) : blankProfile());
    if (selected) setEnvironment(selected.ksefEnvironment);
  };

  useEffect(() => { void load().catch((value) => setError(translateMessage(value, t))); }, []);
  const selected = useMemo(() => profiles.find((profile) => profile.id === editing.id), [profiles, editing.id]);
  const connection = useMemo(() => connections.find((item) => item.localProfileId === editing.id && item.environment === environment), [connections, editing.id, environment]);
  useEffect(() => {
    setCertificatePassword("");
  }, [connection?.id, editing.id, environment]);
  const set = <K extends keyof SaveInvoiceSellerProfile>(key: K, value: SaveInvoiceSellerProfile[K]) => setEditing((current) => ({ ...current, [key]: value }));
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await action(); onChanged(); }
    catch (value) { setError(translateMessage(value, t)); }
    finally { setBusy(false); }
  };
  const saveProfile = () => run(async () => {
    const id = await saveInvoiceSellerProfile({ ...editing, ksefEnvironment: environment });
    await load(id);
  });
  const removeProfile = () => editing.id && run(async () => {
    await deleteInvoiceSellerProfile(editing.id!);
    await load();
  });
  const connectCertificate = () => editing.id && run(async () => {
    const saved = await saveKsefConnection({
      localProfileId: editing.id!,
      displayName: editing.displayName,
      nip: editing.nip.replace(/\D/g, ""),
      environment,
    });
    try {
      await importKsefCertificate(saved.id, certificatePassword);
      await verifyKsefCertificateConnection(saved.id, editing.id!);
    } finally {
      setCertificatePassword("");
      await load(editing.id);
    }
  });
  const replaceCertificate = () => connection && editing.id && run(async () => {
    try {
      await importKsefCertificate(connection.id, certificatePassword);
      await verifyKsefCertificateConnection(connection.id, editing.id!);
    } finally {
      setCertificatePassword("");
      await load(editing.id);
    }
  });
  const verify = () => connection && editing.id && run(async () => {
    await verifyKsefCertificateConnection(connection.id, editing.id!);
    await load(editing.id);
  });
  const disconnect = () => connection && editing.id && run(async () => {
    await deleteKsefConnection(connection.id, editing.id!);
    await load(editing.id);
  });
  const profileComplete = Boolean(editing.displayName.trim() && editing.legalName.trim()
    && editing.nip.replace(/\D/g, "").length === 10 && editing.street.trim()
    && editing.postCode.trim() && editing.city.trim() && editing.numberingPrefix.trim());
  const certificateValidTo = connection?.certificateValidTo
    ? new Date(connection.certificateValidTo).toLocaleDateString()
    : undefined;

  return <CommerceModal title={t(T.invoice_settings)} onClose={onClose} wide>
    <div className="invoice-settings-layout">
      <aside className="invoice-profile-list">
        <button type="button" className="btn btn-secondary" onClick={() => { setEditing(blankProfile()); setEnvironment("TEST"); }}><Plus size={14} />{t(T.invoice_profile_add)}</button>
        {profiles.map((profile) => <button type="button" key={profile.id} className={`invoice-profile-card${profile.id === editing.id ? " active" : ""}`} onClick={() => { setEditing(editProfile(profile)); setEnvironment(profile.ksefEnvironment); }}>
          <Building2 size={17} /><span><strong>{profile.displayName}</strong><small>{profile.nip} · {profile.numberingPrefix}</small></span>
          {profile.active && <BadgeCheck size={15} />}
        </button>)}
      </aside>
      <div className="invoice-settings-content">
        {error && <div className="commerce-alert danger">{error}</div>}
        <div className="commerce-form-grid">
          <div className="commerce-form-section">{t(T.invoice_profile_edit)}</div>
          <Field label={t(T.invoice_provider_name)}><input className="input" value={editing.displayName} onChange={(event) => set("displayName", event.target.value)} /></Field>
          <Field label={t(T.invoice_field_name)}><input className="input" value={editing.legalName} onChange={(event) => set("legalName", event.target.value)} /></Field>
          <Field label={t(T.invoice_field_tax_id)}><input className="input" inputMode="numeric" value={editing.nip} onChange={(event) => set("nip", event.target.value)} /></Field>
          <Field label={t(T.invoice_profile_prefix)}><input className="input" maxLength={12} value={editing.numberingPrefix} onChange={(event) => set("numberingPrefix", event.target.value.toUpperCase())} /></Field>
          <Field label={t(T.invoice_field_street)} span={2}><input className="input" value={editing.street} onChange={(event) => set("street", event.target.value)} /></Field>
          <Field label={t(T.invoice_field_post_code)}><input className="input" value={editing.postCode} onChange={(event) => set("postCode", event.target.value)} /></Field>
          <Field label={t(T.invoice_field_city)}><input className="input" value={editing.city} onChange={(event) => set("city", event.target.value)} /></Field>
          <Field label={t(T.invoice_field_country)}><input className="input" maxLength={2} value={editing.country} onChange={(event) => set("country", event.target.value.toUpperCase())} /></Field>
          <Field label={t(T.invoice_field_issue_place)}><input className="input" value={editing.issuePlace ?? ""} onChange={(event) => set("issuePlace", event.target.value)} /></Field>
          <Field label={t(T.invoice_field_email)}><input className="input" type="email" value={editing.email ?? ""} onChange={(event) => set("email", event.target.value)} /></Field>
          <Field label={t(T.invoice_field_phone)}><input className="input" value={editing.phone ?? ""} onChange={(event) => set("phone", event.target.value)} /></Field>
          <Field label={t(T.invoice_field_bank_account)}><input className="input" value={editing.bankAccount ?? ""} onChange={(event) => set("bankAccount", event.target.value)} /></Field>
          <Field label={t(T.invoice_field_bank_swift)}><input className="input" value={editing.bankSwift ?? ""} onChange={(event) => set("bankSwift", event.target.value.toUpperCase())} /></Field>
          <Field label={t(T.invoice_profile_registry)}><input className="input" placeholder="KRS" value={editing.krs ?? ""} onChange={(event) => set("krs", event.target.value)} /></Field>
          <Field label="REGON"><input className="input" value={editing.regon ?? ""} onChange={(event) => set("regon", event.target.value)} /></Field>
          <Field label="BDO"><input className="input" value={editing.bdo ?? ""} onChange={(event) => set("bdo", event.target.value)} /></Field>
          <Field label={t(T.invoice_profile_active)}><label className="commerce-check"><input type="checkbox" checked={editing.active} onChange={(event) => set("active", event.target.checked)} />{t(T.invoice_profile_active)}</label></Field>
        </div>
        <div className="commerce-modal-actions invoice-settings-actions"><button type="button" className="btn btn-secondary danger" disabled={busy || !editing.id} onClick={removeProfile}><Trash2 size={14} /></button><button type="button" className="btn btn-primary" disabled={busy || !profileComplete} onClick={saveProfile}>{t(T.common_save)}</button></div>

        {selected && <section className="invoice-ksef-settings">
          <div className="commerce-form-section"><span>{t(T.invoice_ksef_connection)}</span>{connection && <StatusPill tone={connection.status === "VERIFIED" ? "good" : connection.status === "ERROR" ? "danger" : "warn"}>{connection.status}</StatusPill>}</div>
          <div className="commerce-form-grid invoice-ksef-grid">
            <Field label={t(T.invoice_ksef_environment)}><select className="input" value={environment} onChange={(event) => setEnvironment(event.target.value as KsefEnvironment)}><option value="TEST">TEST</option><option value="DEMO">DEMO</option><option value="PRODUCTION">PRODUCTION</option></select></Field>
            <Field label={t(T.invoice_ksef_auth_method)}><div className="invoice-ksef-method"><span><FileKey2 size={15} />{t(T.invoice_ksef_certificate)}</span></div></Field>
            <Field label={t(T.invoice_ksef_certificate_password)}><input className="input" type="password" autoComplete="new-password" value={certificatePassword} onChange={(event) => setCertificatePassword(event.target.value)} /></Field>
          </div>
          {connection && <div className="invoice-ksef-certificate-meta">
            <span className={connection.localCertificateStored ? "ready" : "missing"}><FileKey2 size={15} />{t(connection.localCertificateStored ? T.invoice_ksef_certificate_ready : T.invoice_ksef_certificate_missing)}</span>
            {connection.certificateSerialNumber && <span><strong>{t(T.invoice_ksef_certificate_serial)}</strong><code>{connection.certificateSerialNumber}</code></span>}
            {certificateValidTo && <span><strong>{t(T.invoice_ksef_certificate_valid_to)}</strong>{certificateValidTo}</span>}
          </div>}
          <div className="commerce-alert good invoice-security-note"><ShieldCheck size={16} /><span>{t(T.invoice_ksef_certificate_notice)}</span></div>
          <div className="commerce-modal-actions invoice-settings-actions">
            {!connection && <button type="button" className="btn btn-primary" disabled={busy || certificatePassword.length < 1} onClick={connectCertificate}><FileKey2 size={14} />{t(T.invoice_ksef_connect_verify)}</button>}
            {connection && <button type="button" className={`btn ${connection.localCertificateStored ? "btn-secondary" : "btn-primary"}`} disabled={busy || certificatePassword.length < 1} onClick={replaceCertificate}><FileKey2 size={14} />{t(connection.localCertificateStored ? T.invoice_ksef_certificate_replace : T.invoice_ksef_certificate_choose)}</button>}
            {connection?.localCertificateStored && <button type="button" className="btn btn-primary" disabled={busy} onClick={verify}><ShieldCheck size={14} />{t(connection.status === "EXPIRED" ? T.invoice_ksef_reauthorize : T.invoice_ksef_verify)}</button>}
            {connection && <button type="button" className="btn btn-secondary danger" disabled={busy} onClick={disconnect}>{t(T.invoice_ksef_disconnect)}</button>}
          </div>
        </section>}
      </div>
    </div>
  </CommerceModal>;
}
