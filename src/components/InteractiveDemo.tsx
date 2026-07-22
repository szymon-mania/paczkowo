import "../demo-app/index.css";
import DesktopApp from "../demo-app/App";
import { installDevMock } from "../demo-app/lib/devMock";
import { I18nProvider } from "../demo-app/lib/i18n";

if (typeof window !== "undefined") {
  installDevMock();
}

export default function InteractiveDemo() {
  return (
    <I18nProvider>
      <DesktopApp />
    </I18nProvider>
  );
}
