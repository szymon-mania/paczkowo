import { useState, type FormEvent } from "react";

// Endpoint konfigurowalny przez zmienną środowiskową (build-time).
// Domyślnie produkcyjny adres API. Patrz: .env.example
const CONTACT_ENDPOINT =
  import.meta.env.PUBLIC_CONTACT_ENDPOINT ?? "https://api.paczkowo.net/contact";

type Status = "idle" | "sending" | "success" | "error";

export default function ContactForm() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status === "sending") return;

    setStatus("sending");
    setErrorMsg("");

    try {
      const res = await fetch(CONTACT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          message: message.trim(),
          source: "paczkowo.net/waitlist",
          submittedAt: new Date().toISOString(),
        }),
      });

      if (!res.ok) {
        throw new Error(`Serwer zwrócił status ${res.status}`);
      }

      setStatus("success");
      setEmail("");
      setName("");
      setMessage("");
    } catch (err) {
      // Na razie endpoint może jedynie logować — pokazujemy czytelny komunikat.
      setStatus("error");
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "Nie udało się wysłać wiadomości."
      );
    }
  }

  if (status === "success") {
    return (
      <div
        className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center dark:border-emerald-900/60 dark:bg-emerald-950/40"
        role="status"
      >
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-900/60 dark:text-emerald-300">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className="h-6 w-6"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m4.5 12.75 6 6 9-13.5"
            />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
          Dziękujemy! Jesteś na liście.
        </h3>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Odezwiemy się na podany adres e-mail, gdy tylko udostępnimy dostęp.
        </p>
        <button
          type="button"
          onClick={() => setStatus("idle")}
          className="mt-4 text-sm font-medium text-brand-600 hover:underline dark:text-brand-400"
        >
          Zapisz kolejny adres
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="cf-name"
            className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
          >
            Imię <span className="text-slate-400">(opcjonalnie)</span>
          </label>
          <input
            id="cf-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            placeholder="Jan"
            className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          />
        </div>
        <div>
          <label
            htmlFor="cf-email"
            className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
          >
            Adres e-mail <span className="text-brand-600">*</span>
          </label>
          <input
            id="cf-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            placeholder="jan@sklep.pl"
            className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          />
        </div>
      </div>

      <div>
        <label
          htmlFor="cf-message"
          className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
        >
          Wiadomość <span className="text-slate-400">(opcjonalnie)</span>
        </label>
        <textarea
          id="cf-message"
          rows={3}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Na ilu kontach sprzedajesz? Czego potrzebujesz?"
          className="w-full resize-y rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
        />
      </div>

      {status === "error" && (
        <p
          className="rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300"
          role="alert"
        >
          Nie udało się wysłać zgłoszenia. {errorMsg} Spróbuj ponownie lub napisz
          na{" "}
          <a href="mailto:kontakt@paczkowo.net" className="underline">
            kontakt@paczkowo.net
          </a>
          .
        </p>
      )}

      <button
        type="submit"
        disabled={status === "sending"}
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
      >
        {status === "sending" ? "Wysyłanie…" : "Dołącz do listy oczekujących"}
      </button>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        Wysyłając formularz zgadzasz się na kontakt mailowy w sprawie Paczkowo.
        Nie wysyłamy spamu.
      </p>
    </form>
  );
}
