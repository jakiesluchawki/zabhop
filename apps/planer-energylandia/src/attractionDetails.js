// Short, family-oriented summaries paraphrased from each attraction's official
// Energylandia page. The linked image is the page's official social preview.

const DETAILS = Object.freeze({
  "honey-harbour": Object.freeze({
    imageUrl: "https://energylandia.pl/wp-content/uploads/2021/10/Sweet-Valley-9.jpg",
    summary: "Rodzinna kolejka w Sweet Valley: prawie 12 metrów wysokości, sporo zakrętów i prędkość do 46 km/h. Dobra rozgrzewka, ale u Was pozostaje żółtym dodatkiem.",
  }),
  "bumble-boats": Object.freeze({
    imageUrl: "https://energylandia.pl/wp-content/uploads/2021/10/Sweet-Valley-45.jpg",
    summary: "Spokojny rejs małą łódką przez czekoladową scenografię Sweet Valley. Dobra żółta opcja dla sześciolatków, kiedy chcecie zwolnić po szybszych kolejkach.",
  }),
  "mokate-twist": Object.freeze({
    imageUrl: "https://energylandia.pl/wp-content/uploads/2021/10/Sweet-Valley-5.jpg",
    summary: "Duża wirująca platforma z filiżankami, które można dodatkowo obracać samodzielnie. Krótka, zabawna i wyraźnie bardziej dynamiczna niż zwykła karuzela.",
  }),
  "bon-bon-balloon": Object.freeze({
    imageUrl: "https://energylandia.pl/wp-content/uploads/2021/10/Sweet-Valley.jpg",
    summary: "Latające balony w Sweet Valley obracają się wspólnie, a każda rodzina może dodatkowo sterować własną gondolą. Spokojniejsza żółta przerwa z dobrym widokiem.",
  }),
  "candy-carousel": Object.freeze({
    imageUrl: "https://energylandia.pl/wp-content/uploads/2021/10/Sweet-Valley-13.jpg",
    summary: "Dwupoziomowa karuzela wiedeńska w samym środku Sweet Valley. Spokojny, widokowy przystanek, gdy potrzebujecie chwili oddechu.",
  }),
  "crazy-barn": Object.freeze({
    imageUrl: "https://energylandia.pl/wp-content/uploads/2021/10/Sweet-Valley-31.jpg",
    summary: "Obrotowa stodoła przechyla wagoniki pod różnymi kątami i kręci nimi po całej platformie. To jedna z mocniejszych żółtych opcji, znacznie ciekawsza niż zwykła karuzela.",
  }),
  "choco-chip-creek": Object.freeze({
    imageUrl: "https://energylandia.pl/wp-content/uploads/2021/10/Sweet-Valley-25.jpg",
    summary: "Długi rodzinny rollercoaster prowadzący wysoko nad Sweet Valley. Ma około 1,2 km trasy i rozpędza się do 55 km/h — mocny zielony start dnia.",
  }),
  abyssus: Object.freeze({
    imageUrl: "https://energylandia.pl/wp-content/uploads/2019/11/AQUALANTIS-8.jpg",
    summary: "Najmocniejszy punkt Waszej trasy: podwójnie wystrzeliwany rollercoaster, do 100 km/h, 38,5 m wysokości i pięć inwersji.",
  }),
  "whirlpool-water-fight": Object.freeze({
    imageUrl: "https://energylandia.pl/wp-content/uploads/2019/11/AQUALANTIS.jpg",
    summary: "Interaktywna wodna bitwa w Aqualantis: łodzie mają armatki, a cała załoga pompuje i celuje. Oficjalny próg 120 cm z opiekunem czyni ją zielonym punktem planu.",
  }),
  "light-explorers": Object.freeze({
    imageUrl: "https://energylandia.pl/wp-content/uploads/2020/10/AQUALANTIS-8.jpg",
    summary: "Rodzinna kolejka stylizowana na maszynę czasu. Dynamiczna, ale wyraźnie łagodniejsza od Abyssusa — traktujcie ją jako żółty plan zapasowy.",
  }),
  "stormy-ship": Object.freeze({
    imageUrl: "https://energylandia.pl/wp-content/uploads/2020/10/AQUALANTIS-50.jpg",
    summary: "Wirująca morska przygoda w Aqualantis, w której sami wybieracie kierunek rejsu. Krótka, rodzinna opcja pomiędzy większymi atrakcjami.",
  }),
  "grotto-expedition": Object.freeze({
    imageUrl: "https://energylandia.pl/wp-content/uploads/2019/11/AQUALANTIS-24.jpg",
    summary: "Spokojna podróż statkiem przez rozbudowaną scenerię Aqualantis. Dobra na odpoczynek i oglądanie strefy bez kolejnej dawki przeciążeń.",
  }),
  frida: Object.freeze({
    imageUrl: "https://energylandia.pl/wp-content/uploads/2019/07/SMOCZY-GROD-33.jpg",
    summary: "Rodzinny rollercoaster w Smoczym Grodzie z szybkimi zakrętami i baśniową oprawą. Fajny po drodze, ale słabszy od zielonych hitów 120+.",
  }),
  "wonder-wheel": Object.freeze({
    imageUrl: "https://energylandia.pl/wp-content/uploads/2022/02/SMOCZY-GROD-3.jpg",
    summary: "Koło widokowe z 30 gondolami i panoramą całego parku. To spokojny reset oraz dobry moment na ustalenie dalszej trasy.",
  }),
  formula: Object.freeze({
    imageUrl: "https://energylandia.pl/wp-content/uploads/2017/02/Formula.jpg",
    summary: "Wystrzeliwany rollercoaster, który osiąga 100 km/h w około dwie sekundy i dochodzi do 4,5 G. Krótko, bardzo szybko i zdecydowanie zielony priorytet.",
  }),
  "formula-autodrom": Object.freeze({
    imageUrl: "https://energylandia.pl/wp-content/uploads/2017/02/Formula-Autodrom.jpg",
    summary: "Klasyczne samochodziki zderzakowe w rodzinnej wersji. Od 120 cm dzieci mogą naprawdę ścigać się i zderzać, więc to sensowny zielony dodatek blisko Formuły.",
  }),
  anaconda: Object.freeze({
    imageUrl: "https://energylandia.pl/wp-content/uploads/2017/03/STREFA-FAMILIJNA-15.jpg",
    summary: "Duża wodna przejażdżka łodzią z dwoma zjazdami, prędkością do 55 km/h i spektakularną falą. Załóżcie, że zmokniecie.",
  }),
  "rmf-dragon": Object.freeze({
    imageUrl: "https://energylandia.pl/wp-content/uploads/2017/02/RMF-Dragon.jpg",
    summary: "Podwieszany rollercoaster pędzący blisko ziemi i przez tunele. Ma około 20 m wysokości i osiąga mniej więcej 75 km/h.",
  }),
  "viking-ride": Object.freeze({
    imageUrl: "https://energylandia.pl/wp-content/uploads/2017/03/STREFA-FAMILIJNA-11.jpg",
    summary: "Spokojny rejs łodzią przez Wioskę Wikingów, pełen scenografii i małych niespodzianek. Żółty reset po mocniejszych atrakcjach w centralnej części parku.",
  }),
  "monster-house": Object.freeze({
    imageUrl: "https://energylandia.pl/wp-content/uploads/2017/02/Monster_house_2024_3-2048x1365.jpg",
    summary: "Kolejka prowadzi przez ciemny dom strachów pełen potworów i niespodzianek. Jest pod dachem, ale dla wrażliwych sześciolatków może być mocna.",
  }),
  "swiss-water-cups": Object.freeze({
    imageUrl: "https://energylandia.pl/wp-content/uploads/2017/03/Swiss_water_cups_2024_3-2048x1365.jpg",
    summary: "Łagodny wodny rejs przez szwajcarską wioskę, elfy i ogrody. To spokojna żółta opcja oraz dobry odpoczynek bez opuszczania Strefy Familijnej.",
  }),
  atlantis: Object.freeze({
    imageUrl: "https://energylandia.pl/wp-content/uploads/2017/02/Atlantis_2024_4-2048x1365.jpg",
    summary: "Rodzinny spływ okrągłymi pontonami po rwącej rzece. Płyniecie razem, obracacie się po drodze i macie dużą szansę na wodę.",
  }),
  boomerang: Object.freeze({
    imageUrl: "https://energylandia.pl/wp-content/uploads/2017/03/STREFA-FAMILIJNA-19.jpg",
    summary: "Familijny rollercoaster z pagórkami, zwrotami i tempem dobrym dla dzieci, które lubią kolejki. U Was to żółta opcja, nie cel sam w sobie.",
  }),
  "splash-battle": Object.freeze({
    imageUrl: "https://energylandia.pl/wp-content/uploads/2017/02/STREFA-FAMILIJNA-7.jpg",
    summary: "Spokojna przejażdżka łodzią połączona z bitwą na armatki wodne. Najlepsza, gdy wszyscy mają ochotę zmoknąć i trochę się powygłupiać.",
  }),
  "gold-mine": Object.freeze({
    imageUrl: "https://energylandia.pl/wp-content/uploads/2017/02/Toffiffe-Kopalnia-Zlota.jpg",
    summary: "Klasyczny spływ wagonikami stylizowanymi na drewniane pnie: spokojne podjazdy przechodzą w wodne zjazdy. Przygotujcie się na zachlapanie.",
  }),
  "frutti-loop": Object.freeze({
    imageUrl: "https://energylandia.pl/wp-content/uploads/2017/02/STREFA-FAMILIJNA-3.jpg",
    summary: "Niewielki rodzinny rollercoaster z łagodnymi zjazdami i prędkością około 20 km/h. Dla Was żółta opcja na dokładkę, gdy kolejka jest krótka.",
  }),
  energus: Object.freeze({
    imageUrl: "https://energylandia.pl/wp-content/uploads/2017/03/3-2.jpg",
    summary: "Klasyczny rodzinny rollercoaster z łagodniejszym profilem i kilkoma szybkimi zakrętami. Dobry zapas na koniec trasy, jeśli dzieci nadal mają energię.",
  }),
  "jungle-adventure": Object.freeze({
    imageUrl: "https://energylandia.pl/wp-content/uploads/2017/03/Jungle-Adventure-1.jpg",
    summary: "Pontonowy spływ dziką rzeką z falami, wodospadami i wirami. To zielony priorytet 120+ oraz pewny kandydat na mokry finał.",
  }),
});

export function detailsForAttraction(attraction) {
  return DETAILS[attraction?.id] || Object.freeze({
    imageUrl: null,
    summary: "Sprawdźcie charakter atrakcji, ograniczenia i bieżące komunikaty obsługi przed wejściem do kolejki.",
  });
}

export { DETAILS as ATTRACTION_DETAILS };
