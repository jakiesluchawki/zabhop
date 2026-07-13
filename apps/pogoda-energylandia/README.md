# PogodaPark — Energylandia

Mobilna aplikacja dla rodziny w Energylandii. Łączy dwa tryby w jednym adresie:

- **Pogoda** — ocena 0–100, najlepsze okno wizyty, kilka niezależnych prognoz i porównanie biletu na jeden lub dwa dni.
- **Na miejscu** — trasa dla dwóch dorosłych i dwojga sześciolatków, filtrowana oddzielnie po wieku i wzroście dzieci, mapa GPS, plan WC oraz czasy kolejek.

Widok parkowy jest dostępny bezpośrednio pod hashem `#park`. Dane profilu, zaliczone atrakcje i ostatnia przerwa na WC są przechowywane wyłącznie lokalnie w przeglądarce.

## Jak działa trasa

Domyślnie aplikacja nie zgaduje wzrostu dzieci. Do czasu ustawienia obu profili pokazuje tylko atrakcje dostępne na podstawie wieku z opiekunem. Po wybraniu wzrostu wspólna trasa używa progu niższego dziecka.

Plan prowadzi od dalszych stref w stronę wyjścia: **Sweet Valley → Aqualantis → Smoczy Gród → Strefa Familijna → Bajkolandia**. Pomija atrakcje typowo dla maluchów, odrzuca pozycje zamknięte i pozwala oznaczać kolejne punkty jako zrobione. GPS może przeliczyć najbliższy sensowny przystanek i najbliższą toaletę.

Czasy z Queue-Times są nieoficjalne. Aplikacja pokazuje odczyt źródłowy, ale przy rekomendacji ostrożnie mnoży kolejkę przez 1,5, ponieważ relacje gości wskazują na okresowe zaniżenia. Oznaczenia przy atrakcji i polecenia obsługi zawsze mają pierwszeństwo.

## Źródła parkowe

- [Oficjalna mapa Energylandii 2026](https://energylandia.pl/wp-content/uploads/2024/06/MAPKA_PL_2026.pdf) — strefy, WC i ograniczenia.
- [Oficjalne strony atrakcji](https://energylandia.pl/atrakcje/) — wiek, wzrost i zasady jazdy z opiekunem.
- [OpenStreetMap](https://www.openstreetmap.org/#map=16/50.0003/19.4058) — współrzędne atrakcji i toalet.
- [Queue-Times](https://queue-times.com/en-US/parks/317/queue_times) — nieoficjalne statusy oraz kolejki.
- Relacje rodzinne z lat 2025–2026 — wskazówka ruchu od tyłu parku i ostrożna korekta czasu oczekiwania.

## Źródła pogody

- **ICM UM 4 km** — obowiązkowe źródło kontrolne i meteorogram dla Zatora.
- **Open-Meteo** — temperatura, opad, prawdopodobieństwo opadu, kod pogody i porywy.
- **MET Norway Locationforecast** — niezależna prognoza temperatury, opadu, wiatru i zjawisk.
- **DWD przez Bright Sky** — trzecia niezależna prognoza liczbowa.
- **Antistorm** — bieżący nowcast z najbliższego dostępnego punktu pomiarowego.

## Uruchomienie lokalne

Wymagany jest Node.js 22 lub nowszy.

```bash
npm ci
npm run dev
```

Kontrola jakości:

```bash
npm test
npm run build
npm run preview
```

Ręczne odświeżenie migawki kolejek:

```bash
npm run refresh:queues
```

## Publikacja

Kod źródłowy mieszka w `apps/pogoda-energylandia` repozytorium `jakiesluchawki/zabhop`. Statyczny build jest publikowany w `pogoda-energylandia`, dzięki czemu zachowuje dotychczasowy adres GitHub Pages. Workflow `update-energylandia.yml` co 10 minut odświeża kolejki, uruchamia testy, buduje aplikację i aktualizuje tylko katalog wdrożeniowy, gdy dane faktycznie się zmienią.
