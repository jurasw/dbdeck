# Data Core — Black Glass

Wybrany kierunek DBDeck: trzy niebieskie warstwy bazy danych na czarnym, szklistym tle. Czarne tło jest wyglądem domyślnym, również przy jasnym motywie systemu.

- `icon-black-glass.png`: dopracowana wizualizacja samej ikony, wygenerowana wbudowanym imagegen na podstawie pierwotnej planszy.
- `prompt-black-glass.txt`: pełny prompt użyty do przygotowania wariantu.
- `preview-black-glass.svg`: uproszczony podgląd wektorowy wybranego tła i kolorów.
- `layers/`: trzy edytowalne, uproszczone warstwy SVG do importu w Icon Composer. Nie zawierają materiałów ani odbić z renderu AI.
- `concept.png` i `preview.svg`: wcześniejsza propozycja z jasnym tłem, zachowana do porównania.

## Icon Composer

Ustaw płótno 1024 × 1024 i zaimportuj istniejące warstwy `layers/01-foreground.svg`, `layers/02-foreground.svg`, `layers/03-foreground.svg`, od tyłu do przodu, bez zmiany wspólnej skali i położenia.

W wyglądzie Default ustaw gradient tła: grafit #1b2028 → niemal czerń #090b10 → czerń #050609. Dla Dark zachowaj tę samą czarną bazę. SVG podglądu nie jest warstwą do importu; tło i efekty ustaw w Composerze.

Jako punkt startowy zastosuj Specular Automatic, niewielki cień i delikatną refrakcję. Przezroczystość dobierz tak, aby błękitne warstwy pozostały wyraźnie oddzielone od czerni. Najjaśniejsza jest górna warstwa; dolna ma głęboki niebieski kolor. Połysk tła powinien być szeroki i dyskretny, bez mocnej obwódki ani neonowej poświaty.

To wskazówki do dopracowania wybranego kierunku, nie gotowy dokument `.icon` ani dokładne odtworzenie renderu. Sprawdź czytelność w rozmiarach 16, 32 i 64 px oraz w Default, Dark i Mono.

[Instrukcja Apple](https://developer.apple.com/documentation/xcode/creating-your-app-icon-using-icon-composer)
