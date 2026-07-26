import "../demo-app/index.css";
import DesktopApp from "../demo-app/App";
import { installDevMock } from "../demo-app/lib/devMock";
import { I18nProvider } from "../demo-app/lib/i18n";

// Filtry listy zamówień aplikacja zapamiętuje w localStorage. W demo to myli:
// po powrocie na /demo lista startowała z zawężonym filtrem kuriera i wyglądała,
// jakby brakowało zamówień. Każde wejście do demo zaczyna od pełnej listy.
const ORDER_FILTER_KEYS = ["orderStatusFilter", "orderChannelFilter", "orderCourierFilter"];

if (typeof window !== "undefined") {
  for (const key of ORDER_FILTER_KEYS) localStorage.removeItem(key);
  installDevMock();
}

export default function InteractiveDemo() {
  return (
    <I18nProvider>
      <DesktopApp />
    </I18nProvider>
  );
}
