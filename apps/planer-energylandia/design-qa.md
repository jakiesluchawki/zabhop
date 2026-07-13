# Design QA — wejście, mobilna gęstość i PDF

## Zakres

- Jednoznaczny pierwszy ekran produktu z dwiema drogami: sprawdzenie pogody albo bezpośrednie planowanie.
- Zachowanie istniejącego, filcowego barometru PogodaPark bez utraty jego charakteru.
- Skrócenie kluczowych ekranów do użytecznego kadru telefonu.
- Graficzny, wielostronicowy podgląd planu przed drukiem lub zapisem do PDF.

## Źródła wizualne

- Referencja PogodaPark: `/Users/mieszkomahboob/.codex/attachments/f65651ff-1b27-408e-97d3-f7a0bd7399ec/codex-clipboard-ede9581b-cdfd-49a3-90c9-2e6fb26fd2b5.png`
- Referencja intro planera: `/Users/mieszkomahboob/.codex/attachments/da004bfb-65cc-40c4-9557-6a3d5dc682ea/codex-clipboard-61c03db2-51b5-467f-81cb-6caa4ae21c41.png`
- Nowa ilustracja wejścia: `public/assets/entry-choice-v1.jpg`
- Język produktu: Romie + Roobert, krem/róż/oliwka/fiolet, filc i papier, spokojne objaśnienia zamiast ozdobnych kontrolek.

## Zachowana kontrola poprzedniej wersji

- Poprzednie porównania produkcyjne pozostają w `qa/energylandia-final/`: pogoda, intro planera, responsywność oraz detal atrakcji przy 320 px.
- Zachowane regresje obejmują: trzy dni pogody, świeży Antistorm, pełny horyzont planu do 20:00, posiłek, bezpieczny podział i spotkanie grupy, elastyczny bufor, stan „zaliczone”, mapę oraz szczegóły atrakcji z obiema nawigacjami.
- Rozróżnienie `SHELTER_NOW` i `LEAVE_NOW`, transparentne źródła, modalne arkusze z obsługą klawiatury oraz link bez imion i lokalizacji nie zostały zmienione.

## Widoki i breakpointy

- 320 × 700: ekran wejścia, intro planera i pierwsze pytanie mieszczą główne zadanie oraz CTA bez nakładania elementów.
- 390 × 844: oba wybory na ekranie wejścia, przycisk planowania w pogodzie oraz pełne intro planera są widoczne w pierwszym kadrze.
- 430 × 932: brak poziomego przepełnienia i poprawny reflow.
- iOS safe-area: dolne akcje zachowują oddech od krawędzi i nie są zasłonięte przez przeglądarkę.

## Interakcje

- `Najpierw sprawdź pogodę` prowadzi do istniejącego modułu PogodaPark.
- `Decyzja podjęta — ułóż plan` prowadzi do skróconego intro, a następnie do ankiety.
- Z pogody można przejść do planowania lub wrócić do wyboru startu.
- Zapisany plan nadal można wznowić.
- `Przygotuj piękny PDF` otwiera pełnoekranowy podgląd; `Drukuj / zapisz` uruchamia natywny dialog drukowania dopiero po gotowości fontów i obrazów.

## PDF

- Okładka: marka, filcowa grafika, skład grupy, długość pobytu i zakres dnia.
- Każdy dzień: własna ilustracja, skrót planu, kolorystyczne rozróżnienie przejazdów, obiadu, podziału grupy i bufora.
- Koniec dnia oraz elastyczne alternatywy są zachowane w wersji do druku.
- Reguły `@page`, `print-color-adjust` i page-break przygotowują dokument do A4; podgląd HTML odpowiada strukturze wersji drukowanej.

## Porównania i dowody

- `qa/energylandia-v2/comparison-welcome-density.png`: poprzedni tytuł wypychał treść i CTA poza kadr; nowy wariant pokazuje ilustrację, korzyści i CTA w jednym ekranie.
- `qa/energylandia-v2/comparison-weather-density.png`: barometr i hierarchia PogodaPark zostały zachowane, a droga do planowania jest dostępna bez długiego przewijania.
- `qa/energylandia-v2/entry-320x700.png`
- `qa/energylandia-v2/entry-390x844.png`
- `qa/energylandia-v2/welcome-320x700.png`
- `qa/energylandia-v2/welcome-390x844.png`
- `qa/energylandia-v2/onboarding-step1-320x700.png`
- `qa/energylandia-v2/weather-390x844.png`
- `qa/energylandia-v2/pdf-cover-preview-390x844.png`
- `qa/energylandia-v2/pdf-day-preview-390x844.png`

## Kontrola jakości

- Typografia: display pozostaje redakcyjny, ale nagłówki są płynne i nie dominują nad zadaniem.
- Odstępy: kluczowe CTA są widoczne bez przewijania na typowych telefonach.
- Kolory i materiały: zgodne z istniejącym językiem CHMURNIK / Gdzie Żaba.
- Obrazy: lokalne zasoby wysokiej rozdzielczości, bez placeholderów i emoji.
- Copy: użytkownik od pierwszego ekranu rozumie, dlaczego widzi pogodę i jak od razu przejść do planu.
- Konsola przeglądarki: bez błędów i ostrzeżeń w sprawdzonych ścieżkach.

final result: passed
