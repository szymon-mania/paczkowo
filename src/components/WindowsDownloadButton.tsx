import { useEffect, useState } from "react";

import { downloads } from "../config/downloads";

type UpdateManifest = {
  platforms?: Record<string, { url?: string }>;
};

function windowsInstallerUrl(manifest: UpdateManifest): string | null {
  const url = manifest.platforms?.["windows-x86_64"]?.url;
  return url && url.startsWith("https://api.paczkowo.net/downloads/") ? url : null;
}

export default function WindowsDownloadButton() {
  const [installerUrl, setInstallerUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    async function loadInstallerUrl() {
      try {
        const response = await fetch(downloads.updateManifest, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Update manifest returned ${response.status}`);

        const url = windowsInstallerUrl((await response.json()) as UpdateManifest);
        if (!url) throw new Error("Windows installer URL is missing from the update manifest");

        setInstallerUrl(url);
      } catch (error) {
        if (!controller.signal.aborted) setFailed(true);
      }
    }

    void loadInstallerUrl();
    return () => controller.abort();
  }, []);

  if (failed) {
    return (
      <p className="mt-8 text-sm text-red-700 dark:text-red-300" role="alert">
        Nie udało się przygotować instalatora. Odśwież stronę lub napisz do nas.
      </p>
    );
  }

  if (!installerUrl) {
    return (
      <button
        type="button"
        disabled
        className="mt-8 inline-flex w-full cursor-wait items-center justify-center gap-3 rounded-lg bg-brand-600 px-6 py-4 text-base font-semibold text-white opacity-70 sm:w-auto"
      >
        Przygotowuję instalator...
      </button>
    );
  }

  return (
    <a
      href={installerUrl}
      className="mt-8 inline-flex w-full items-center justify-center gap-3 rounded-lg bg-brand-600 px-6 py-4 text-base font-semibold text-white shadow-lg shadow-brand-600/20 transition hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 sm:w-auto"
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0 4.5-4.5M12 15 7.5 10.5M4 20.25h16" />
      </svg>
      Pobierz dla Windows
    </a>
  );
}
