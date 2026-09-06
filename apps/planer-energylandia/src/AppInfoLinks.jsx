import { isNativeApp, PUBLIC_APP_URL } from "./native.js";

export function AppInfoLinks({ showNote = false }) {
  const baseUrl = isNativeApp() ? PUBLIC_APP_URL : import.meta.env.BASE_URL;
  return (
    <aside className="app-info">
      {showNote && <p>PogodaPark to niezależna, nieoficjalna aplikacja. Nie jest produktem operatora Energylandii.</p>}
      <nav aria-label="Informacje o aplikacji">
        <a href={`${baseUrl}privacy.html`} target="_blank" rel="noreferrer">Prywatność</a>
        <a href={`${baseUrl}support.html`} target="_blank" rel="noreferrer">Pomoc i kontakt</a>
      </nav>
    </aside>
  );
}
