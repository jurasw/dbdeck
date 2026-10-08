# DBDeck — kierunki ikony i logo

Trzy propozycje inspirowane wytycznymi Apple. Pliki `concept.png` to wizualizacje wygenerowane wbudowanym imagegen; `prompt.txt` zawiera pełny prompt. Każda wizualizacja pokazuje ikonę, ciemny wariant i logo z napisem DBDeck.

| Kierunek | Pomysł | Tło w Icon Composer |
| --- | --- | --- |
| 01 — Deck | Trzy karty; odniesienie do nazwy, rozwinięcie obecnego znaku | Gradient #76cfff → #18226b; dark #080e2c |
| 02 — Data Core (wybrany) | Trzy niebieskie warstwy danych na czarnym szkle | Domyślnie i dark: #1b2028 → #090b10 → #050609 |
| 03 — Monogram D | Trzy warstwy z zaokrąglonym prawym konturem; abstrakcyjne D | Gradient #275cbd → #080e2c; dark #080b12 |

Wybrany wariant: [Data Core — Black Glass](02-data-core/README.md). Czarna baza jest domyślna; pierwotną jasną propozycję zachowano do porównania.

## Materiały do Icon Composer

Każdy folder zawiera ręcznie przygotowaną, uproszczoną interpretację wektorową kierunku. SVG nie są dokładnym odwzorowaniem renderów AI. Służą jako edytowalny punkt startowy; finalne proporcje i materiały wymagają dopracowania w Composerze.

1. Utwórz dokument dla Maca z płótnem 1024 × 1024.
2. Zaimportuj trzy pliki z folderu `layers/`, zachowując wspólny rozmiar płótna, skalę i pozycję. Kolejność numerów: od tyłu do przodu.
3. Ustaw tło w Composerze według tabeli. Do wariantu dark użyj podanej ciemnej barwy.
4. Ustaw efekty Liquid Glass w Composerze. Zacznij od Specular Automatic i subtelnego cienia; dopasuj przezroczystość tak, by kształty pozostały czytelne. To proponowane ustawienia do eksperymentów, nie uniwersalne wartości Apple.
5. Porównaj warianty default, dark i mono oraz małe rozmiary 16, 32 i 64 px. W logo i na stronie używaj płaskiego znaku z `mark.svg`.

Warstwy mają wypełnione kształty, brak tła, brak maski narożników oraz brak wypalonych cieni, rozmycia i połysku. `preview.svg` jest wyłącznie podglądem kolorów i kompozycji; nie importuj go jako warstwy do Composera. Płaski znak Deck ma przezroczyste przerwy między kartami, uzyskane maskami SVG.

Źródła: [Apple App icons](https://developer.apple.com/design/human-interface-guidelines/app-icons/), [Creating your app icon using Icon Composer](https://developer.apple.com/documentation/xcode/creating-your-app-icon-using-icon-composer).

Materiały są propozycjami; nie zastępują obecnych plików marki ani ikon aplikacji.
