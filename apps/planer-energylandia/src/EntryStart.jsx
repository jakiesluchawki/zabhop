import { ArrowRight, CloudSun, MapTrifold } from "@phosphor-icons/react";

export function EntryStart({ onWeather, onPlan, onResume }) {
  return (
    <main className="entry-shell screen-app">
      <article className="entry-material">
        <header className="entry-brand">
          <img src={`${import.meta.env.BASE_URL}icon-192-v3.png`} alt="" width="42" height="42" />
          <div><p>PogodaPark</p><span>ENERGYLANDIA • POGODA + PLAN</span></div>
          <span>BETA</span>
        </header>

        <section className="entry-intro">
          <p className="eyebrow">JEDNA APLIKACJA • DWIE DECYZJE</p>
          <h1>Najpierw decyzja.<br /><i>Potem dobry dzień.</i></h1>
          <p>Sprawdźcie, czy warto jechać — albo od razu ułóżcie bezpieczną trasę dopasowaną do całej grupy.</p>
          <figure className="entry-illustration">
            <img
              src={`${import.meta.env.BASE_URL}assets/entry-choice-v1.jpg`}
              alt="Filcowa trasa rozdzielająca się na sprawdzenie pogody i plan dnia w parku"
              width="1536"
              height="1024"
              loading="eager"
              decoding="async"
            />
          </figure>
        </section>

        <section className="entry-paths" aria-label="Wybierz, od czego zaczynasz">
          <button className="entry-path weather" type="button" onClick={onWeather}>
            <CloudSun size={25} weight="duotone" aria-hidden="true" />
            <span><strong>Najpierw sprawdź pogodę</strong><small>Wybieram dzień i liczbę dni</small></span>
            <ArrowRight size={19} weight="bold" aria-hidden="true" />
          </button>
          <button className="entry-path plan" type="button" onClick={onPlan}>
            <MapTrifold size={25} weight="duotone" aria-hidden="true" />
            <span><strong>Decyzja podjęta — ułóż plan</strong><small>Przechodzę do 7 krótkich pytań</small></span>
            <ArrowRight size={19} weight="bold" aria-hidden="true" />
          </button>
          {onResume && <button className="entry-resume" type="button" onClick={onResume}>Wróć do zapisanego planu</button>}
        </section>

        <footer>Bez konta. Pogoda i kolejki są odświeżane, a odpowiedzi zostają w tej przeglądarce.</footer>
      </article>
    </main>
  );
}
