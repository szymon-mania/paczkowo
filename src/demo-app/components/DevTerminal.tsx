import { useEffect, useRef, useState } from "react";
import { Terminal, Trash2, X } from "lucide-react";
import { invoke } from "../lib/serverStatus";

type DevLogEntry = {
  timestamp: string;
  level: string;
  target: string;
  message: string;
};

type DevTerminalProps = {
  defaultOpen?: boolean;
};

const frontendLogs: DevLogEntry[] = [];
const frontendSubscribers = new Set<(logs: DevLogEntry[]) => void>();
let frontendCaptureInstalled = false;

function stringifyLogPart(value: unknown): string {
  if (value instanceof Error) return value.stack || value.message;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function emitFrontendLog(level: string, target: string, parts: unknown[]) {
  frontendLogs.push({
    timestamp: new Date().toISOString(),
    level,
    target,
    message: parts.map(stringifyLogPart).join(" "),
  });
  if (frontendLogs.length > 500) frontendLogs.splice(0, frontendLogs.length - 500);
  const snapshot = [...frontendLogs];
  frontendSubscribers.forEach((listener) => listener(snapshot));
}

function installFrontendLogCapture() {
  if (frontendCaptureInstalled || typeof window === "undefined") return;
  frontendCaptureInstalled = true;

  const originalError = console.error.bind(console);
  const originalWarn = console.warn.bind(console);
  const originalInfo = console.info.bind(console);

  console.error = (...args: unknown[]) => {
    emitFrontendLog("ERROR", "frontend.console", args);
    originalError(...args);
  };
  console.warn = (...args: unknown[]) => {
    emitFrontendLog("WARN", "frontend.console", args);
    originalWarn(...args);
  };
  console.info = (...args: unknown[]) => {
    emitFrontendLog("INFO", "frontend.console", args);
    originalInfo(...args);
  };

  window.addEventListener("error", (event) => {
    emitFrontendLog("ERROR", "frontend.window", [
      event.message,
      `${event.filename}:${event.lineno}:${event.colno}`,
      event.error,
    ]);
  });
  window.addEventListener("unhandledrejection", (event) => {
    emitFrontendLog("ERROR", "frontend.promise", [event.reason]);
  });
}

function subscribeFrontendLogs(listener: (logs: DevLogEntry[]) => void) {
  installFrontendLogCapture();
  frontendSubscribers.add(listener);
  listener([...frontendLogs]);
  return () => {
    frontendSubscribers.delete(listener);
  };
}

export function writeFrontendDevLog(level: string, target: string, ...parts: unknown[]) {
  installFrontendLogCapture();
  emitFrontendLog(level, target, parts);
}

export default function DevTerminal({ defaultOpen = false }: DevTerminalProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [logs, setLogs] = useState<DevLogEntry[]>([]);
  const [frontend, setFrontend] = useState<DevLogEntry[]>([]);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => subscribeFrontendLogs(setFrontend), []);

  useEffect(() => {
    if (!open) return;
    let active = true;
    const poll = async () => {
      try {
        const next = await invoke<DevLogEntry[]>("get_dev_logs");
        if (active) {
          setLogs(next);
          setError("");
        }
      } catch (value) {
        if (active) setError(String(value));
      }
    };
    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, 750);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [open]);

  const allLogs = [...logs, ...frontend].sort(
    (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp),
  );

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ block: "nearest" });
  }, [allLogs.length, open]);

  const clear = async () => {
    await invoke("clear_dev_logs");
    frontendLogs.splice(0, frontendLogs.length);
    setLogs([]);
    setFrontend([]);
  };

  return (
    <>
      {!open && (
        <button type="button" className="dev-terminal-launcher" onClick={() => setOpen(true)}>
          <Terminal size={14} /> Dev terminal
        </button>
      )}
      {open && (
        <aside className="dev-terminal" aria-label="Development terminal">
          <header className="dev-terminal-header">
            <span>
              <Terminal size={15} /> Development logs <small>{allLogs.length}</small>
            </span>
            <div>
              <button type="button" className="btn btn-ghost btn-icon" title="Clear logs" onClick={() => void clear()}>
                <Trash2 size={14} />
              </button>
              <button type="button" className="btn btn-ghost btn-icon" title="Close" onClick={() => setOpen(false)}>
                <X size={15} />
              </button>
            </div>
          </header>
          <div className="dev-terminal-output">
            {error && <div className="dev-terminal-error">{error}</div>}
            {allLogs.length === 0 && !error && (
              <div className="dev-terminal-empty">Waiting for backend/frontend logs...</div>
            )}
            {allLogs.map((entry, index) => (
              <div className={`dev-terminal-line ${entry.level.toLowerCase()}`} key={`${entry.timestamp}-${index}`}>
                <span className="dev-terminal-time">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                <strong>{entry.level}</strong>
                <span className="dev-terminal-target">[{entry.target}]</span>
                <span>{entry.message}</span>
              </div>
            ))}
            <div ref={endRef} />
          </div>
        </aside>
      )}
    </>
  );
}
