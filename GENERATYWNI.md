# ŻabHop i Energylandia / PogodaPark — przekazanie

Stan źródeł: 7 września 2026. Oryginał: https://github.com/jakiesluchawki/zabhop, commit dff43bde32f454b9fa860462a371c5ef8b828de7.

## Gdzie jest kod

- ŻabHop: pliki WWW w katalogu głównym, aplikacja iOS w `ZabHop/` i `ZabHop.xcodeproj`, narzędzia w `Tools/`.
- Aktualny planer Energylandii / PogodaPark: `apps/planer-energylandia/`, w tym projekt Capacitor/iOS i testy.
- Pozostałe strony Energylandii i usługi pomocnicze są zachowane w tym samym repozytorium. Informacje o krótkich linkach: `services/energylandia-shortlinks/`.
- Repozytorium `jakiesluchawki/planer-energylandia` jest starszą kopią i nie stanowi podstawy tego przekazania.

Repozytoria Generatywnych `zabhop` oraz `energylandia` otrzymują na start tę samą kompletną bazę z historią, aby żaden ze współdzielonych skryptów i assetów nie zginął. Po przekazaniu rozwijają się niezależnie; nie ma automatycznej synchronizacji pomiędzy nimi ani z kontem właściciela.

## Start

ŻabHop: patrz główny README. Testy WWW: `node --test tests/*.test.cjs Tools/*.test.mjs`.
PogodaPark: przejdź do `apps/planer-energylandia`, wykonaj `npm ci`, następnie użyj poleceń z lokalnego package.json i README.

To przekazanie źródeł istniejących aplikacji, nie gotowych nowych wydań Androida. Konta sklepów, klucze podpisujące i tokeny usług nie są kopiowane. Obecne adresy stron i API wskazują działające usługi właściciela; zmianę adresów, identyfikatorów aplikacji i własne publikacje należy zaplanować przed wydaniem. GitHub Actions w nowych kopiach wyłączono na start, aby skopiowane harmonogramy i wdrożenia nie uruchomiły się samoczynnie.

Przy przekazaniu porównano commity i sprawdzono źródła pod kątem sekretów. Nie wykonywano ponownego pełnego procesu publikacji iOS ani testów urządzeń.
