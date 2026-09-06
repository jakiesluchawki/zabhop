# PogodaPark

Niezależny planer wizyty w Energylandii: porównanie prognoz, bezpieczna trasa dla całej grupy, kolejki, opcjonalne pokazy, mapa i lokalny eksport PDF. Nie jest aplikacją operatora parku.

Strona: https://jakiesluchawki.github.io/zabhop/planer-energylandia/

## Rozwój

```sh
npm ci
npm test
npm run dev
```

`npm run build` tworzy statyczny serwis w `dist/`. Publikację obsługuje workflow `update-energylandia.yml` w głównym repozytorium. Adres starszej aplikacji pogodowej pozostaje działającym wejściem do planera. Pozostałe aplikacje w repozytorium mają własne procesy wydania.

## Dane i ich ograniczenia

- Kolejki pochodzą z Queue-Times; godziny działania i pokazy z oficjalnych stron Energylandii. Migawki zachowują czas pobrania i podlegają kontroli świeżości.
- Niepotwierdzone godziny, nieaktualna kolejka albo niedostępna prognoza nie stanowią potwierdzenia dostępności atrakcji.
- Wzrost i wiek są przedziałami. Planer liczy uprawnienia od ich dolnej granicy; decyzja operatora na miejscu pozostaje wiążąca.
- Pozycja GPS służy lokalnym obliczeniom. Śledzenie zatrzymuje się po przejściu w tło. Aplikacja nie obiecuje alarmów działających w tle.
- Krótki link przechowuje anonimowy, uproszczony plan przez maksymalnie 90 dni. Zwykłe planowanie działa bez konta.

Aktualizacja migawek: `npm run refresh:queues`, `npm run refresh:calendar`, `npm run refresh:shows`.

## iPhone i iPad

Projekt Capacitor znajduje się w `ios/App/App.xcodeproj`. Wersja iOS zawiera interfejs i logikę planowania w paczce aplikacji; dane parku są odświeżane przez HTTPS, a przy braku sieci pozostaje oznaczona czasem migawka z paczki.

```sh
npm run ios:sync
npm run ios:build
```

`POGODAPARK_DERIVED_DATA` i `POGODAPARK_SIMULATOR_DESTINATION` pozwalają wskazać katalog kompilacji i pojedynczy symulator. Schemat `App` zawiera testy `AppUITests`: pierwszy ekran, prognozy oraz trzydniowy plan z zamianą atrakcji, wznowieniem i rzeczywistym eksportem PDF.

Natywne integracje obejmują GPS, schowek, systemowe udostępnianie oraz wielostronicowy PDF. Kod aplikacji iOS aktualizuje się przez nowe wydanie w sklepie; mechanizm odświeżania powłoki strony internetowej jest w tej wersji wyłączony.

Instrukcje przygotowania karty, screenów i zgłoszenia: [app-store/README.md](app-store/README.md). Klucze, profile robocze, logi i archiwa pozostają wyłącznie w ignorowanym katalogu `.local/` repozytorium. Gotowy build i komplet metadanych nie oznaczają jeszcze zgody Apple na publikację.
