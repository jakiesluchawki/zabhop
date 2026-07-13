import { CloudSun, MapTrifold } from "@phosphor-icons/react";

export function AppNav({ active, onChange }) {
  return (
    <nav className="app-nav" aria-label="Główne sekcje aplikacji">
      <button
        type="button"
        className={active === "weather" ? "active" : ""}
        onClick={() => onChange("weather")}
        aria-current={active === "weather" ? "page" : undefined}
      >
        <CloudSun size={21} weight={active === "weather" ? "fill" : "regular"} />
        <span>Pogoda</span>
      </button>
      <button
        type="button"
        className={active === "park" ? "active" : ""}
        onClick={() => onChange("park")}
        aria-current={active === "park" ? "page" : undefined}
      >
        <MapTrifold size={21} weight={active === "park" ? "fill" : "regular"} />
        <span>Na miejscu</span>
      </button>
    </nav>
  );
}
