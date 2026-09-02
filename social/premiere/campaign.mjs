export const storeUrl = 'https://apps.apple.com/pl/app/%C5%BCabhop/id6789961777';
export const revision = '20260903-v1';
export const stickerArea = { x: 240, y: 1510, width: 600, height: 120 };
export const palette = { pink: '#ffe1eb', cream: '#fff7f1', olive: '#625e32', violet: '#7040cf', white: '#fff8f3' };

const frog = 'felt-frog.png';
const icon = 'ZabHop/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png';
const radar = 'social/premiere/assets/02-zabka-radar.png';
const other = 'social/premiere/assets/03-other-stores.png';
const compass = 'felt-compass.png';
const box = (x, y, width, height) => ({ x, y, width, height });
// Romie's OTF metrics need extra room for ascenders/descenders beyond its line pitch.
const type = (text, x, y, width, height, size, options = {}) => ({ text, box: box(x, y, width, height + size * .25), size, font: 'Roobert-Regular', color: palette.olive, lineHeight: size * 1.25, ...options });
const photo = (path, rectangle, options = {}) => ({ path, box: rectangle, radius: 36, ...options });
const head = (number, color = palette.olive, label = 'PREMIERA /') => [
  type('ŻabHop', 78, 237, 385, 91, 78, { font: 'Romie-Regular', lineHeight: 84, color }),
  type(`${label} ${number}`, 689, 267, 313, 38, 22, { color, align: 'right', font: 'Roobert-Bold', tracking: 1 }),
];
const foot = (color = palette.olive, text = 'Niezależna aplikacja.\nBez powiązania z siecią Żabka.') => type(text, 78, 1642, 924, 64, 22, { color, lineHeight: 29 });
const scene = (image, rectangle, duration, opts = {}) => ({ image, box: rectangle, duration, zoomFrom: 1, zoomTo: 1.035, focusX: .5, focusY: .5, radius: 36, ...opts });

export const crops = [
  { id: 'radar-compass', source: radar, rect: box(255, 780, 810, 810) },
  { id: 'radar-details', source: radar, rect: box(42, 1825, 1236, 520) },
  { id: 'other-details', source: other, rect: box(42, 1825, 1236, 520) },
  // Show only the shared time filter: a fixed Żabka tab above Carrefour would imply a false UI state.
  { id: 'modes', source: radar, rect: box(48, 532, 1224, 103) },
];
const crop = id => `.local/premiere-build/crops/${id}.png`;

export const artworks = [
  {
    id: 'story-01-premiera', title: '01 / Hop, po zakupy', format: 'story', background: palette.pink,
    lead: 'Hop,\npo zakupy.', body: 'ŻabHop już w App Store.\nBezpłatnie na iPhone’a.', stickerLabel: 'Pobierz ŻabHopa',
    alt: 'Różowa plansza z oryginalną filcową żabką. Hop, po zakupy. ŻabHop już w App Store. Bezpłatnie na iPhone’a.',
    texts: [ ...head('01'), type('Hop,\npo zakupy.', 76, 366, 930, 335, 150, { font: 'Romie-Regular', lineHeight: 139, tracking: -3 }),
      type('ŻabHop już w App Store.\nBezpłatnie na iPhone’a.', 80, 709, 920, 107, 39),
      type('Sklep pod ręką. Dosłownie.', 80, 1425, 920, 55, 34, { font: 'Roobert-Bold' }), foot() ],
    images: [photo(frog, box(248, 826, 584, 584), { animated: true, radius: 42 })],
    scenes: [scene(frog, box(248, 826, 584, 584), 2.3, { zoomFrom: 1.06, zoomTo: 1 }), scene(icon, box(265, 833, 550, 550), 2.2), scene(frog, box(238, 818, 602, 602), 2.5, { zoomFrom: 1.04, zoomTo: 1.08 })],
  },
  {
    id: 'story-02-kierunek', title: '02 / W tę stronę', format: 'story', background: palette.cream,
    lead: 'W tę\nstronę.', body: 'Duża strzałka.\nOdległość.\nI ruszasz.', stickerLabel: 'Znajdź swój kierunek',
    alt: 'Kremowa plansza z autentycznym ekranem radaru ŻabHopa. W tę stronę. Duża strzałka, odległość i ruszasz. Kierunek w linii prostej; trasę pieszą otworzysz w Apple Maps.',
    texts: [...head('02'), type('W tę\nstronę.', 78, 382, 460, 311, 145, { font: 'Romie-Regular', lineHeight: 142, tracking: -3 }),
      type('Duża strzałka.\nOdległość.\nI ruszasz.', 82, 759, 400, 180, 39, { lineHeight: 55 }),
      type('Kierunek w linii prostej.\nTrasę pieszą otworzysz\nw Apple Maps.', 82, 1138, 390, 122, 27, { lineHeight: 37 }),
      type('Żabka? Już wiesz, gdzie.', 82, 1426, 920, 50, 34, { font: 'Roobert-Bold' }), foot(palette.olive, 'Przykładowy ekran aplikacji.\nNiezależny projekt, bez powiązania z siecią Żabka.')],
    images: [photo(radar, box(538, 444, 438, 952), { animated: true, radius: 42, border: palette.olive, borderWidth: 5 })],
    scenes: [scene(radar, box(538, 444, 438, 952), 2.5, { zoomTo: 1.012, radius: 42 }),
      scene(crop('radar-compass'), box(523, 562, 472, 630), 2.3, { zoomFrom: 1.0, zoomTo: 1.06 }),
      scene(radar, box(538, 444, 438, 952), 2.4, { zoomFrom: 1.06, zoomTo: 1.015 })],
  },
  {
    id: 'story-03-otwarte', title: '03 / A zdążę?', format: 'story', background: palette.pink,
    lead: 'A zdążę?', body: 'Sprawdź godziny otwarcia\ni przewidywany czas dojścia.', stickerLabel: 'Sprawdź sklepy w okolicy',
    alt: 'Różowa plansza z prawdziwymi fragmentami interfejsu: Otwarte teraz, Na później, godziny otwarcia i szacowany czas dojścia. A zdążę? Godziny mogą się zmieniać.',
    texts: [...head('03'), type('A zdążę?', 76, 398, 934, 180, 159, { font: 'Romie-Regular', lineHeight: 164, tracking: -3 }),
      type('Sprawdź godziny otwarcia\ni przewidywany czas dojścia.', 80, 611, 920, 110, 39),
      type('Teraz. Albo na później.', 80, 1409, 920, 58, 38, { font: 'Roobert-Bold' }),
      foot(palette.olive, 'Przykładowe ekrany aplikacji.\nGodziny i czas dojścia mogą się zmieniać.')],
    images: [photo(crop('modes'), box(80, 840, 920, 78), { radius: 15 }),
      photo(crop('radar-details'), box(80, 1008, 920, 387), { animated: true, radius: 25 })],
    scenes: [scene(crop('radar-details'), box(80, 1008, 920, 387), 2.4, { zoomTo: 1.012, radius: 25 }),
      scene(crop('other-details'), box(80, 1008, 920, 387), 2.4, { zoomTo: 1.014, radius: 25 }),
      scene(crop('radar-details'), box(80, 1008, 920, 387), 2.4, { zoomFrom: 1.018, zoomTo: 1, radius: 25 })],
  },
  {
    id: 'story-04-inne-sklepy', title: '04 / Nie tylko Żabka', format: 'story', background: palette.olive,
    lead: 'Nie tylko\nŻabka.', body: 'Sklepy innych sieci\nteż są pod ręką.', stickerLabel: 'Wybierz swój sklep',
    alt: 'Oliwkowa plansza z prawdziwym ekranem Inne sklepy. Nie tylko Żabka. Sklepy innych sieci też są pod ręką. Wybierz cel i porównaj do pięciu sklepów.',
    texts: [...head('04', palette.pink), type('Nie tylko\nŻabka.', 78, 388, 490, 294, 113, { font: 'Romie-Regular', lineHeight: 120, color: palette.pink, tracking: -2 }),
      type('Sklepy innych sieci\nteż są pod ręką.', 80, 798, 410, 116, 35, { color: palette.pink, lineHeight: 48 }),
      type('Wybierz cel.\nPorównaj do 5 sklepów.', 80, 927, 410, 110, 29, { color: palette.pink, lineHeight: 41 }),
      type('Ten sam radar. Więcej możliwości.', 80, 1425, 920, 55, 32, { font: 'Roobert-Bold', color: palette.pink }), foot(palette.pink, 'Przykładowy ekran aplikacji.\nNiezależny projekt, bez powiązania z siecią Żabka.')],
    images: [photo(other, box(538, 444, 438, 952), { animated: true, radius: 42, border: palette.pink, borderWidth: 5 })],
    scenes: [scene(other, box(538, 444, 438, 952), 2.4, { zoomTo: 1.012, radius: 42 }),
      scene(crop('other-details'), box(80, 1020, 920, 387), 2.2, { zoomFrom: 1.0, zoomTo: 1.012, focusX: .5 }),
      scene(other, box(538, 444, 438, 952), 2.4, { zoomFrom: 1.045, zoomTo: 1.01, radius: 42 })],
  },
  {
    id: 'story-05-pobierz', title: '05 / Po prostu hop', format: 'story', background: palette.violet,
    lead: 'Bez konta.\nBez reklam.\nPo prostu hop.', body: 'ŻabHop na iPhone’a.\nBezpłatnie w App Store.', stickerLabel: 'Pobierz za darmo',
    alt: 'Fioletowa plansza z filcową żabką. Bez konta. Bez reklam. Po prostu hop. ŻabHop na iPhone’a, bezpłatnie w App Store.',
    texts: [...head('05', palette.pink), type('Bez konta.\nBez reklam.\nPo prostu hop.', 76, 390, 930, 480, 128, { font: 'Romie-Regular', lineHeight: 139, color: palette.pink, tracking: -2.5 }),
      type('ŻabHop na iPhone’a.\nBezpłatnie w App Store.', 80, 899, 880, 116, 41, { color: palette.pink, lineHeight: 55 }),
      type('Mała aplikacja.\nSklep pod ręką.', 80, 1214, 470, 115, 38, { color: palette.pink, lineHeight: 51 }), foot(palette.pink)],
    images: [photo(icon, box(650, 1118, 300, 300), { animated: true, radius: 66 })],
    scenes: [scene(icon, box(650, 1118, 300, 300), 2.2, { radius: 66, zoomTo: 1.04 }),
      scene(compass, box(650, 1118, 300, 300), 2.2, { radius: 66, zoomFrom: 1.0, zoomTo: 1.07 }),
      scene(frog, box(650, 1118, 300, 300), 2.6, { radius: 66, zoomFrom: 1.08, zoomTo: 1 })],
  },
  {
    id: 'post-01-premiera', title: 'Post / Premiera', format: 'post', background: palette.pink,
    lead: 'Hop, po zakupy.', body: 'ŻabHop już w App Store.',
    alt: 'Premiera ŻabHopa: Hop, po zakupy. Oryginalna filcowa żabka na różowym tle. Bezpłatnie na iPhone’a, bez konta i bez reklam.',
    texts: [type('ŻabHop', 78, 75, 600, 84, 73, { font: 'Romie-Regular', lineHeight: 80 }),
      type('JUŻ W APP STORE', 644, 104, 357, 34, 22, { font: 'Roobert-Bold', align: 'right', tracking: 1 }),
      type('Hop,\npo zakupy.', 77, 234, 930, 340, 150, { font: 'Romie-Regular', lineHeight: 137, tracking: -3 }),
      type('ŻabHop już w App Store.', 80, 586, 920, 68, 41),
      type('Bezpłatnie na iPhone’a.', 80, 1168, 920, 55, 37, { font: 'Roobert-Bold' }),
      type('BEZ KONTA · BEZ REKLAM', 80, 1235, 920, 38, 23, { tracking: 1 })],
    images: [photo(frog, box(300, 668, 480, 480), { radius: 36 })],
  },
  {
    id: 'post-02-radar', title: 'Post / Sklep pod ręką', format: 'post', background: palette.cream,
    lead: 'Sklep\npod ręką.', body: 'Kierunek. Odległość.\nGodziny otwarcia.',
    alt: 'Kremowa plansza z autentycznym ekranem ŻabHopa. Sklep pod ręką. Kierunek, odległość, godziny otwarcia. Żabka i inne sieci. Bezpłatnie na iPhone’a.',
    texts: [type('ŻabHop', 78, 72, 600, 88, 74, { font: 'Romie-Regular', lineHeight: 84 }),
      type('NA IPHONE’A', 684, 105, 317, 34, 22, { font: 'Roobert-Bold', align: 'right', tracking: 1 }),
      type('Sklep\npod ręką.', 78, 257, 474, 290, 110, { font: 'Romie-Regular', lineHeight: 118, tracking: -2 }),
      type('Kierunek.\nOdległość.\nGodziny otwarcia.', 80, 621, 411, 170, 34, { lineHeight: 48 }),
      type('Żabka i inne sieci.', 80, 940, 420, 100, 32, { font: 'Roobert-Bold' }),
      type('Bezpłatnie na iPhone’a.', 80, 1205, 924, 54, 35, { font: 'Roobert-Bold' }),
      type('Przykładowy ekran. Niezależna aplikacja.', 80, 1264, 924, 28, 18)],
    images: [photo(radar, box(580, 285, 413, 897), { radius: 40, border: palette.olive, borderWidth: 5 })],
  },
].map(item => ({ ...item, width: 1080, height: item.format === 'story' ? 1920 : 1350, storeUrl, ...(item.format === 'story' ? { stickerArea } : {}) }));

export const captions = [
  { id: 'instagram', title: 'Instagram — post premierowy', platform: 'instagram', text:
`Hop, po zakupy. 🐸\n\nZrobiłem małą aplikację, która pokazuje, w którą stronę jest najbliższa Żabka. Nazywa się ŻabHop i właśnie trafiła do App Store.\n\nDuża strzałka, odległość, dostępne godziny otwarcia i przewidywany czas dojścia. Można też wybrać sklep innej sieci albo porównać kilka miejsc w okolicy. Trasę pieszą otworzysz w Apple Maps.\n\nBezpłatnie na iPhone’a. Bez konta i bez reklam.\n\nW App Store szukaj: ŻabHop.\n\nŻabHop to niezależna aplikacja, niepowiązana z prezentowanymi sieciami. Godziny otwarcia mogą się zmieniać.\n\n#ŻabHop #iPhone #PolskieAplikacje` },
  { id: 'facebook', title: 'Facebook — dla znajomych', platform: 'facebook', text:
`Hop, po zakupy. 🐸\n\nŻabHop jest już w App Store. To moja mała aplikacja, która pokazuje kierunek do Żabki albo sklepu innej sieci w okolicy.\n\nDuża strzałka, odległość, dostępne godziny i przewidywany czas dojścia. Można porównać kilka sklepów i wybrać swój cel, a trasę pieszą otworzyć w Apple Maps.\n\nBezpłatnie na iPhone’a. Bez konta i bez reklam.\n\nJeśli sprawdzisz ją przy najbliższych zakupach, daj znać, jak się sprawdziła.\n\n${storeUrl}\n\nŻabHop to niezależna aplikacja, niepowiązana z prezentowanymi sieciami. Godziny otwarcia mogą się zmieniać.` },
  { id: 'linkedin', title: 'LinkedIn — mały produkt, konkretny problem', platform: 'linkedin', text:
`ŻabHop jest już w App Store.\n\nTo niewielka aplikacja na iPhone’a z prostym zadaniem: wskazać kierunek do Żabki lub sklepu innej popularnej sieci w okolicy.\n\nDuża strzałka i odległość aktualizują się podczas ruchu. Można porównać do pięciu sklepów, sprawdzić dostępne godziny otwarcia i otworzyć trasę pieszą w Apple Maps.\n\nKatalogi są zapisane na urządzeniu i aktualizują się niezależnie od kolejnych wersji aplikacji. Lokalna baza, kierunek i dystans działają również bez internetu; aktualizacje i usługi Apple Maps potrzebują połączenia.\n\nBezpłatnie. Bez konta, reklam i analityki.\n\nJeśli sprawdzisz ŻabHopa podczas najbliższego spaceru, chętnie usłyszę, jak się sprawdził.\n\n${storeUrl}\n\nNiezależny projekt, niepowiązany z prezentowanymi sieciami. Strzałka pokazuje kierunek w linii prostej, a godziny otwarcia mogą się zmieniać.` },
  { id: 'stories-linki', title: 'Stories — kolejność i naklejki Link', platform: 'stories', text:
`Opublikuj materiały 01–05 w tej kolejności. Dla każdego numeru wybierz MP4 ALBO JPG — to alternatywne wersje tej samej storki.\n\n01 / Hop, po zakupy — „Pobierz ŻabHopa”\n02 / W tę stronę — „Znajdź swój kierunek”\n03 / A zdążę? — „Sprawdź sklepy w okolicy”\n04 / Nie tylko Żabka — „Wybierz swój sklep”\n05 / Po prostu hop — „Pobierz za darmo”\n\nKażda naklejka prowadzi pod ten sam adres:\n${storeUrl}\n\nDodaj prawdziwą naklejkę Link w Instagramie. Na obrazie ani filmie nie ma klikalnego linku. Umieść ją na środku wolnego pola, około 82% wysokości, nad małym podpisem.\n\nFilmy są bez dźwięku. Muzykę możesz wybrać w Instagramie. To montaże oryginalnych grafik i autentycznych zrzutów ekranu, a nie nagrania gestów ani aktualne dane o sklepach.` },
];
