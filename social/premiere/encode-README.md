# Encoder materiałów premierowych

Deterministyczny montaż istniejących obrazów: pionowy MP4 H.264, 1080×1920,
30 kl./s, 6–8 sekund, bez ścieżki dźwiękowej. To montaż produktowy autentycznych
screenshotów, nie nagranie interakcji: nie dodaje gestów, dotknięć ani udawanych
stanów interfejsu. Klatki i ich układ są powtarzalne; bitstream H.264 może się
różnić między wersjami systemu lub sprzętowymi encoderami AVFoundation.

## Uruchomienie

Z katalogu `zabhop-canonical/`:

```sh
xcrun swiftc -O -swift-version 6 -warnings-as-errors \
  -module-cache-path /tmp/zabhop-premiere-swift-module-cache \
  social/premiere/encode.swift -o /tmp/zabhop-premiere-encode
/tmp/zabhop-premiere-encode social/premiere/plan.json
```

Można też podać JSON przez standardowe wejście, używając argumentu `-`.
Ścieżki względne w planie są rozwiązywane względem katalogu pliku JSON; przy
standardowym wejściu — względem katalogu roboczego. Tylda jest obsługiwana.
Wymagany jest macOS z Xcode Command Line Tools (Swift 6) i AVFoundation.
W sandboxie Codex systemowa usługa kompresji wideo może być niedostępna;
uruchomienie eksportu wymaga wtedy standardowej zgody na wykonanie poza
sandboxem. Sam encoder nie używa sieci.

## Kontrakt JSON

```json
{
  "jobs": [
    {
      "id": "premiera",
      "output": "exports/premiera.mp4",
      "overlay": "overlays/premiera.png",
      "background": "#F5F0E6",
      "width": 1080,
      "height": 1920,
      "fps": 30,
      "scenes": [
        {
          "image": "screenshots/mapa.png",
          "duration": 3.5,
          "box": { "x": 110, "y": 440, "width": 860, "height": 1160 },
          "zoomFrom": 1.0,
          "zoomTo": 1.035,
          "focusX": 0.5,
          "focusY": 0.15,
          "radius": 32
        },
        {
          "image": "screenshots/trasa.png",
          "duration": 3.5,
          "box": { "x": 110, "y": 440, "width": 860, "height": 1160 },
          "zoomFrom": 1.035,
          "zoomTo": 1.0,
          "focusX": 0.5,
          "focusY": 0.4,
          "radius": 32
        }
      ],
      "previews": "qa/preview"
    }
  ]
}
```

- `id`: unikalny slug ASCII (`A–Z`, `a–z`, cyfry, `_`, `-`).
- `output`: docelowy plik `.mp4`.
- `overlay`: PNG 1080×1920 z kanałem alfa, nakładany nieruchomo, w całości, na
  **każdej klatce**. Powinien zawierać komplet copy. Dla testu technicznego
  dopuszczalne jest `null` lub pominięcie pola.
- `background`: sześciocyfrowy kolor RGB, z `#` lub bez.
- `width`, `height`, `fps`: wymagane wartości 1080, 1920, 30.
- `duration`: sekundy danej sceny; zaokrąglane do najbliższej klatki. Suma po
  zaokrągleniu musi wynosić od 180 do 240 klatek (6–8 s).
- `box`: prostokąt wewnątrz płótna, w pikselach; początek współrzędnych w lewym
  górnym rogu. Obraz zachowuje proporcje i wypełnia prostokąt przez `cover`.
- `zoomFrom`, `zoomTo`: od 1 do 1.15, względem bazowego `cover`; rekomendowane
  1.00–1.04. Płynna interpolacja `smoothstep`, bez losowego ruchu.
- `focusX`, `focusY`: kotwica kadrowania od 0 do 1. `0` wyrównuje nadmiar obrazu
  do lewej/góry; `1` do prawej/dołu; `0.5` centruje. Zoom względem tej kotwicy
  daje subtelny, deterministyczny pan/zoom.
- `radius`: promień narożników w pikselach, maksymalnie połowa krótszego boku.
- `previews`: **prefiks ścieżki**, nie katalog. Przykład powyżej zapisze
  `qa/preview-premiera-shot1.png` i `qa/preview-premiera-shot2.png`.

Między scenami jest twarde cięcie. Nakładka nigdy się nie przesuwa, nie skaluje
i nie zanika. Obraz jest jedynie kadrowany; źródłowe pliki nie są modyfikowane.
Wybór kadru musi zachować prawdziwy sens i czytelność pokazywanego interfejsu.

## Kontrole i bezpieczeństwo wyjść

Cały plan, obrazy, wymiary i konflikty ścieżek sprawdzane są przed renderowaniem.
Encoder nie pozwala nadpisać wejściowego obrazu ani pliku planu. Gotowy MP4 jest
ponownie odczytywany: wymagane są H.264, jeden tor wideo 1080×1920 bez obrotu,
30 kl./s, oczekiwana długość i brak toru audio. Każdy PNG QA jest klatką
**zdekodowaną z finalnie zakodowanego wideo**, ze środka odpowiedniej sceny.

Wyjścia powstają przez plik tymczasowy na tym samym systemie plików i atomowe
`rename`. Błąd renderowania lub weryfikacji nie usuwa poprzedniego MP4. Każdy
PNG jest również zastępowany atomowo; zestaw kilku plików nie jest jedną
transakcją. Po powodzeniu encoder wypisuje jeden JSON receipt na każde zadanie:
ścieżki, codec, wymiary, klatki, czas trwania, fps i liczbę torów audio.
