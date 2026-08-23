# ŻabHop

ŻabHop to mobilny radar prowadzący do najbliższej Żabki albo sklepu innej popularnej sieci. Działa jako natywna aplikacja iPhone oraz jako instalowana w Safari aplikacja WWW. Obie wersje wyszukują sklepy lokalnie, pokazują kierunek i dystans, czas dojścia pieszo oraz informację o godzinach otwarcia.

## Jedno źródło projektu

To repozytorium jest jedyną kanoniczną kopią aplikacji. Pliki wersji WWW znajdują się bezpośrednio w jego katalogu głównym, projekt iPhone w `ZabHop.xcodeproj`, a narzędzia publikacji w `Tools/`. Nie należy kopiować zmian do osobnego katalogu `web/` ani budować aplikacji z niepowiązanej kopii projektu.

Serwis GitHub Pages publikuje również istniejące aplikacje Energylandii. Te strony zachowują swoje dotychczasowe adresy. Zarówno aktualizacje katalogów ŻabHop, jak i publikacja jego strony WWW działają niezależnie od powodzenia bieżącej kompilacji Energylandii.

## Katalogi i niezależne aktualizacje

Aplikacja zaczyna pracę natychmiast na lokalnym katalogu. Aktualizacje odczytuje bezpośrednio z zatwierdzonych plików repozytorium:

- Żabka: `https://raw.githubusercontent.com/jakiesluchawki/zabhop/main/stores-manifest.json`
- Inne sklepy: `https://raw.githubusercontent.com/jakiesluchawki/zabhop/main/other-stores-manifest.json`

Manifesty wskazują odpowiednio sąsiednie `stores.json` i `other-stores.json`. Zawierają wersję schematu, datę aktualizacji, liczbę sklepów i sumę SHA-256. Pełna baza jest pobierana tylko po zmianie sumy kontrolnej; przed instalacją sprawdzane są jej zawartość, liczba rekordów i integralność. Ostatnia poprawna lub wbudowana baza pozostaje dostępna bez internetu.

Workflow `Refresh Żabka catalog` pobiera oficjalny lokalizator każdego dnia, z drugą poranną próbą na wypadek chwilowej niedostępności źródła. Workflow `Refresh other store catalog` odświeża raz w tygodniu dane OpenStreetMap dla sieci ALDI, Auchan, Biedronka, Carrefour, Delikatesy Centrum, Dino, Kaufland, Lewiatan, Lidl, Netto, SPAR i Stokrotka.

Oba procesy aktualizują jednocześnie katalog publiczny, manifest oraz bazę dołączaną do aplikacji iPhone. Odrzucają podejrzanie małe wyniki, utratę znacznej części sklepów i nieprawidłowe sumy kontrolne. Import OSM pomija sklepy zamknięte, planowane i niedostępne; deklarację „24/7” uznaje tylko po udokumentowanej aktualnej weryfikacji. Niepotwierdzone godziny są wyraźnie oznaczane.

Ręczne sprawdzenie i odświeżenie:

```sh
node Tools/ValidateCatalogs.mjs
node Tools/RefreshZabkaCatalog.mjs
node Tools/RefreshOtherStores.mjs
node --test tests/*.test.cjs Tools/*.test.mjs
```

## Aplikacja WWW

Otwórz stronę w Safari, wybierz rodzaj sklepu oraz tryb `Otwarte teraz` albo `Na później`, następnie zezwól na lokalizację i kompas. Opcja `Dodaj do ekranu początkowego` instaluje wersję PWA. Katalogi i najważniejsze elementy interfejsu pozostają dostępne offline.

Workflow `Publish ŻabHop` samodzielnie publikuje zmianę aplikacji WWW. Pobiera ostatni poprawny snapshot Pages z własnego wcześniejszego wdrożenia albo z wdrożenia Energylandii; snapshoty pozostają dostępne przez 30 dni. Odtwarza z nich wyłącznie obie wcześniej zbudowane strony Energylandii, sprawdza ich kompletność i dokłada aktualne, publiczne pliki ŻabHop. Nie uruchamia testów, instalacji zależności ani budowania Energylandii; działa samodzielnie również podczas dłuższej niedostępności jej procesu wydawniczego. Kod iOS, testy, skrypty publikacji oraz lokalne dane dostępowe nigdy nie trafiają na publiczny serwis. Osobny workflow `Publish Energylandia websites` odpowiada za harmonogram i wdrożenia Energylandii. Obie publikacje są kolejkowane, więc nie anulują się wzajemnie.

Niezależne aktualizacje baz dodatkowo wykorzystują adresy Git raw, dzięki czemu trafiają do aplikacji również bez następnego wdrożenia Pages.

## Aplikacja iPhone i TestFlight

Otwórz `ZabHop.xcodeproj` albo uruchom testy z terminala:

```sh
xcodebuild -project ZabHop.xcodeproj -scheme ZabHop \
  -destination 'platform=iOS Simulator,name=iPhone 17' test
```

Samodzielny proces TestFlight znajduje się w `Tools/ReleaseTestFlight.sh`. Nie korzysta ze skryptów innych projektów. Przed budową i wysłaniem zawsze wykonuje testy WWW, sprawdza oba katalogi oraz uruchamia pełne testy aplikacji iPhone.

Dane dostępowe należy przekazać przez zmienne `ZABHOP_ASC_KEY_PATH`, `ZABHOP_ASC_KEY_ID` i `ZABHOP_ASC_ISSUER_ID` lub zapisać je w ignorowanym przez Git pliku `.local/app-store-connect.env`. Zmienna `ZABHOP_ASC_ENV_FILE` pozwala jednorazowo wskazać istniejący plik konfiguracyjny podczas migracji. Sekrety i archiwa nigdy nie trafiają do repozytorium.

```sh
sh Tools/ReleaseTestFlight.sh
sh Tools/CheckAppStoreConnect.sh --builds
sh Tools/CheckAppStoreConnect.sh --inspect-external
```

Udostępnienie konkretnego przetworzonego buildu grupie `Testerzy` wymaga jednoznacznego wskazania jego identyfikatora i wersji:

```sh
ZABHOP_EXTERNAL_BUILD_ID='identyfikator-buildu' \
ZABHOP_EXTERNAL_BUILD_VERSION='numer-buildu' \
ZABHOP_EXTERNAL_CONFIRM='SUBMIT_EXTERNAL_numer-buildu' \
sh Tools/CheckAppStoreConnect.sh --submit-external
```

Opcjonalne `ZABHOP_BUILD_NUMBER` ustawia numer wydania, a `ZABHOP_TEST_DESTINATION` wybiera konkretny symulator. Bez tej zmiennej skrypt automatycznie znajduje dostępnego iPhone’a.

Źródła danych: Żabka Polska oraz © OpenStreetMap contributors, ODbL.
