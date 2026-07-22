// Bezpieczna auto-aktualizacja przez oficjalny plugin Tauri (minisign).
// Plugin sam pobiera paczke, weryfikuje jej podpis wkompilowanym kluczem
// publicznym i dopiero wtedy instaluje. Bez waznego podpisu instalacja jest
// odrzucana.

export type UpdateProgress = {
  downloaded: number; // bajty pobrane
  total: number;      // bajty lacznie (0 gdy serwer nie podal)
  percent: number;    // 0..100 (0 gdy total nieznany)
};

export async function runSelfUpdate(onProgress?: (p: UpdateProgress) => void): Promise<boolean> {
  void onProgress;
  return false;
}

export type InstallOutcome = "installed" | "none";

// Wrapper dla UI: tylko podpisany Tauri updater. Brak fallbacku do downloadUrl,
// bo update ma przejsc przez /api/update/manifest i weryfikacje podpisu.
export async function installUpdateOrOpen(onProgress?: (p: UpdateProgress) => void): Promise<InstallOutcome> {
  return (await runSelfUpdate(onProgress)) ? "installed" : "none";
}
