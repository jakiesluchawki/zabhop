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

Przed wydaniem uruchom także osobny schemat `ZabHopUITests` na małym iPhonie i iPadzie. Test sprawdza, czy ekran startowy mieści się w oknie, można przewinąć go do linku Pomoc oraz nacisnąć przycisk startu i przejść dalej także bez zgody na lokalizację. Test iPada pozostawia aplikację w rzeczywistym trybie zgodności z iPhone'em — nie zmienia obsługiwanych rodzin urządzeń.

```sh
xcodebuild -project ZabHop.xcodeproj -scheme ZabHopUITests \
  -destination 'platform=iOS Simulator,name=iPhone SE (3rd generation)' \
  -parallel-testing-enabled NO CODE_SIGNING_ALLOWED=NO test
xcodebuild -project ZabHop.xcodeproj -scheme ZabHopUITests \
  -destination 'platform=iOS Simulator,name=iPad Air 11-inch (M3)' \
  -parallel-testing-enabled NO CODE_SIGNING_ALLOWED=NO test
```

Nazwy muszą odpowiadać lokalnym symulatorom z `xcrun simctl list devices available`; można zamiast nazwy wskazać `id=UDID`.

Samodzielny proces TestFlight znajduje się w `Tools/ReleaseTestFlight.sh`. Nie korzysta ze skryptów innych projektów. Przed budową i wysłaniem zawsze wykonuje testy WWW, sprawdza oba katalogi oraz uruchamia testy jednostkowe aplikacji iPhone. Testy interfejsu z osobnego schematu należy wykonać przed uruchomieniem tego procesu.

Dane dostępowe należy przekazać przez zmienne `ZABHOP_ASC_KEY_PATH`, `ZABHOP_ASC_KEY_ID` i `ZABHOP_ASC_ISSUER_ID` lub zapisać je w ignorowanym przez Git pliku `.local/app-store-connect.env`. Zmienna `ZABHOP_ASC_ENV_FILE` pozwala jednorazowo wskazać istniejący plik konfiguracyjny podczas migracji. Sekrety i archiwa nigdy nie trafiają do repozytorium.

Domyślnie Xcode zarządza podpisem automatycznie. Jeżeli certyfikat dystrybucyjny znajduje się w oddzielnym pęku kluczy, można jawnie wybrać właściwą tożsamość i odpowiadający aplikacji profil App Store:

```sh
ZABHOP_SIGNING_KEYCHAIN_PATH='/ścieżka/do/pęku-kluczy.keychain-db' \
ZABHOP_SIGNING_IDENTITY='odcisk-SHA1-certyfikatu-dystrybucyjnego' \
sh Tools/CheckAppStoreConnect.sh --prepare-signing

ZABHOP_SIGNING_KEYCHAIN_PATH='/ścieżka/do/pęku-kluczy.keychain-db' \
ZABHOP_SIGNING_IDENTITY='odcisk-SHA1-certyfikatu-dystrybucyjnego' \
ZABHOP_PROVISIONING_PROFILE_SPECIFIER='nazwa-profilu-App-Store-ŻabHop' \
ZABHOP_SIGNING_KEYCHAIN_PASSWORD_FILE='/ścieżka/do/lokalnego-pliku-z-hasłem' \
sh Tools/ReleaseTestFlight.sh
```

Polecenie `--prepare-signing` sprawdza dokładny odcisk istniejącego certyfikatu oraz identyfikator aplikacji, odnajduje albo tworzy ręcznie zarządzany profil App Store wyłącznie dla ŻabHop i instaluje go lokalnie. Nie generuje nowego certyfikatu ani nie korzysta z innych pęków kluczy. Plik hasła jest opcjonalny, jeśli pęk został już odblokowany. Przy jego podaniu skrypt odblokowuje wyłącznie wskazany istniejący pęk kluczy; nie wypisuje hasła, nie zapisuje go w repozytorium ani nie zmienia listy pęków czy uprawnień klucza. Podpis ręczny wymaga ręcznie zarządzanego profilu i wykorzystuje tę samą tożsamość podczas tworzenia archiwum oraz wysyłki do TestFlight.

Jeżeli dostępny profil dystrybucyjny jest zarządzany automatycznie przez Xcode, można przygotować niepodpisane archiwum; prawidłowy podpis App Store zostanie zastosowany automatycznie dopiero podczas eksportu i wysyłki:

```sh
ZABHOP_ARCHIVE_SIGNING_MODE=unsigned sh Tools/ReleaseTestFlight.sh
```

Istniejące, wcześniej sprawdzone archiwum można wysłać ponownie bez powtarzania testów i kompilacji. Wymaga ono jawnie wskazanego archiwum oraz konfiguracji eksportu z ręcznym profilem dystrybucyjnym ŻabHop:

```sh
ZABHOP_EXISTING_ARCHIVE_PATH='/ścieżka/do/ZabHop.xcarchive' \
ZABHOP_EXPORT_OPTIONS_PATH='/ścieżka/do/ExportOptions-TestFlight.plist' \
ZABHOP_SIGNING_IDENTITY='odcisk-SHA1-certyfikatu-dystrybucyjnego' \
ZABHOP_PROVISIONING_PROFILE_SPECIFIER='nazwa-profilu-App-Store-ŻabHop' \
sh Tools/UploadExistingArchive.sh
```

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
