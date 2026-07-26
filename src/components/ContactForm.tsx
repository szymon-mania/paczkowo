import { useEffect, useState, type FormEvent } from "react";

const WEB3FORMS_ENDPOINT = "https://api.web3forms.com/submit";
const WEB3FORMS_ACCESS_KEY =
  import.meta.env.PUBLIC_WEB3FORMS_ACCESS_KEY ??
  "867d978c-740c-454a-ba07-80f58f3e6984";

const categories = ["Pytanie", "Pomoc techniczna", "Błąd w aplikacji", "Prośba o integrację", "Inne"];

/** Kategorie wybierane z adresu, np. /kontakt?kategoria=integracja#formularz. */
const categoryByParam: Record<string, string> = {
  integracja: "Prośba o integrację",
  pomoc: "Pomoc techniczna",
  blad: "Błąd w aplikacji",
};

type Status = "idle" | "sending" | "success" | "error";

export default function ContactForm() {
  const [category, setCategory] = useState(categories[0]);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // Kategoria z adresu ustawiana po hydracji — React nie poprawia wartości pól przy hydracji.
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get("kategoria");
    const preset = param && categoryByParam[param.toLowerCase()];
    if (preset) setCategory(preset);
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "sending") return;

    const form = event.currentTarget;
    const values = new FormData(form);
    const name = String(values.get("name") ?? "").trim();
    const email = String(values.get("email") ?? "").trim();
    const subject = String(values.get("subject") ?? "").trim();
    const content = message.trim();

    if (!email || !content) return;

    setStatus("sending");
    setError("");

    try {
      const response = await fetch(WEB3FORMS_ENDPOINT, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          access_key: WEB3FORMS_ACCESS_KEY,
          subject: subject ? `[Paczkowo] ${category}: ${subject}` : `[Paczkowo] ${category}`,
          from_name: "Paczkowo - formularz strony",
          replyto: email,
          "Imię i nazwisko": name || "Nie podano",
          "E-mail": email,
          Kategoria: category,
          Temat: subject || "Nie podano",
          Wiadomość: content,
          Źródło: "paczkowo.net/kontakt",
          botcheck: false,
        }),
      });
      const result = await response.json().catch(() => null);

      if (!response.ok || result?.success !== true) {
        throw new Error(result?.message || "Nie udało się wysłać wiadomości.");
      }

      form.reset();
      setMessage("");
      setStatus("success");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Nie udało się wysłać wiadomości.");
      setStatus("error");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block text-sm font-medium text-slate-200">
          Imię i nazwisko
          <input name="name" autoComplete="name" className="mt-2 w-full border border-white/15 bg-[#10101a] px-3.5 py-3 text-white outline-none transition placeholder:text-slate-600 focus:border-brand-300" placeholder="Jan Kowalski" />
        </label>
        <label className="block text-sm font-medium text-slate-200">
          E-mail <span className="text-brand-300">*</span>
          <input name="email" type="email" required autoComplete="email" className="mt-2 w-full border border-white/15 bg-[#10101a] px-3.5 py-3 text-white outline-none transition placeholder:text-slate-600 focus:border-brand-300" placeholder="jan@firma.pl" />
        </label>
      </div>
      <div className="grid gap-5 sm:grid-cols-[0.8fr_1.2fr]">
        <label className="block text-sm font-medium text-slate-200">
          Kategoria
          <select name="category" value={category} onChange={(event) => setCategory(event.target.value)} className="mt-2 w-full border border-white/15 bg-[#10101a] px-3.5 py-3 text-white outline-none transition focus:border-brand-300">
            {categories.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium text-slate-200">
          Temat
          <input name="subject" className="mt-2 w-full border border-white/15 bg-[#10101a] px-3.5 py-3 text-white outline-none transition placeholder:text-slate-600 focus:border-brand-300" placeholder="Krótko: czego dotyczy wiadomość?" />
        </label>
      </div>
      <label className="block text-sm font-medium text-slate-200">
        Wiadomość <span className="text-brand-300">*</span>
        <textarea required rows={7} value={message} onChange={(event) => setMessage(event.target.value)} className="mt-2 w-full resize-y border border-white/15 bg-[#10101a] px-3.5 py-3 text-white outline-none transition placeholder:text-slate-600 focus:border-brand-300" placeholder="Opisz, czego potrzebujesz. Odpowiemy na podany adres e-mail." />
      </label>
      <p className="text-xs leading-6 text-slate-500">Wysyłając wiadomość potwierdzasz, że znasz <a className="text-brand-300 hover:text-white" href="/polityka-prywatnosci">politykę prywatności</a>. Odpowiemy wyłącznie w sprawie tego zgłoszenia.</p>
      {status === "success" && <p role="status" className="border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">Dziękujemy. Wiadomość została wysłana.</p>}
      {status === "error" && <p role="alert" className="border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error} Napisz bezpośrednio na <a className="underline" href="mailto:kontakt@paczkowo.net">kontakt@paczkowo.net</a>.</p>}
      <button type="submit" disabled={status === "sending"} className="inline-flex min-h-12 items-center justify-center bg-brand-500 px-6 py-3 text-sm font-semibold text-white transition hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-60">{status === "sending" ? "Wysyłanie..." : "Wyślij wiadomość"}</button>
    </form>
  );
}
