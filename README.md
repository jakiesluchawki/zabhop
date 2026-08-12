# ŻabHop

Mobilny radar prowadzący do najbliższej otwartej Żabki albo — po wybraniu jednego przełącznika — do najbliższego sklepu innej popularnej sieci. Działa jako PWA: korzysta z lokalizacji i kompasu telefonu, pokazuje pięć najbliższych celów i otwiera pieszą trasę w Apple Maps.

## Uruchomienie

Otwórz stronę w Safari, wybierz **Otwarte teraz** albo **Na później**, stuknij **Znajdź najbliższą** i zezwól na lokalizację oraz kompas. Opcja **Dodaj do ekranu początkowego** instaluje wersję PWA.

Godziny Żabek pochodzą z oficjalnego lokalizatora Żabki. Dane innych sieci: © OpenStreetMap contributors, ODbL. Brak lub niejednoznaczne godziny są oznaczane jako nieznane. W trybie **Otwarte teraz** Żabka bez danych może zostać ostrożnie oznaczona jako prawdopodobnie otwarta między 07:00 a 21:00; sklep jawnie zamknięty zawsze jest pomijany, a podobnie odległy sklep z potwierdzonym otwarciem ma pierwszeństwo. Dla innych sieci nie stosujemy tego założenia.

## Aplikacja iOS

Natywny projekt znajduje się w `ZabHop.xcodeproj`. Aplikacja natychmiast korzysta z dołączonego katalogu, a raz na dobę sprawdza niewielki manifest na GitHub Pages. Pełny katalog pobiera tylko po zmianie SHA-256, weryfikuje go przed instalacją i zachowuje ostatnią poprawną oraz wbudowaną wersję jako fallback offline.

Workflow `Refresh Żabka catalog` codziennie buduje odsanityzowany katalog z oficjalnego lokalizatora, odrzuca podejrzane wyniki i publikuje zmianę tylko wtedy, gdy zawartość katalogu faktycznie się zmieniła.
