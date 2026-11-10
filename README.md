# LabelSheet

Impagina N PDF (o immagini) di etichette di spedizione su fogli A4/Letter per stampare meno pagine.
Web app installabile (PWA, funziona offline) e app Android/iOS (Capacitor) con **un'unica codebase**.

**Privacy:** tutto avviene sul dispositivo. Nessun server, nessun upload, nessuna analytics; in produzione una
Content-Security-Policy vieta qualsiasi origine esterna.

## Come funziona

1. **Carica**: selezione multipla o drag & drop di PDF (ogni pagina = un'etichetta) e PNG/JPG/WebP.
2. **Controlla e regola**: per ogni etichetta miniatura ritagliata e ruotata come verrà stampata, scala in %,
   avvisi; ruota (0/90/180/270), ritaglio manuale, dividi (pagina con più etichette), duplica, riordina,
   rimuovi, "pagina intera". A lato le opzioni: griglia, carta, margini, spazio tra celle, linee di taglio,
   scala di grigi, lingua IT/EN, tema chiaro/scuro.
3. **Scarica / Stampa**: anteprima del PDF reale, pulsanti Scarica / Condividi / Stampa, promemoria
   "stampa al 100%". Nome file: `etichette_AAAA-MM-GG.pdf`.

## Requisiti

- Node.js **≥ 20** (provato con 24.10) e npm.
- Android: Android Studio (SDK 35) e JDK 21.
- iOS: macOS con Xcode 16+ e CocoaPods (o SPM).

## Build

```bash
npm install
npm test          # unit test (Vitest)
npm run dev       # sviluppo: http://localhost:5173
npm run build     # produzione in dist/ (PWA + service worker)
npm run preview   # serve dist/ per provare offline/installazione
```

Il contenuto di `dist/` si pubblica su qualsiasi hosting statico **in HTTPS** (necessario per service worker e
Web Share). Il `base` è relativo, quindi funziona anche in una sottocartella.

### Android (Capacitor + Android Studio)

```bash
npx cap add android        # solo la prima volta: genera il progetto android/
npm run cap:android        # build web + cap sync + apre Android Studio
```

In Android Studio: *Run* su emulatore o dispositivo, oppure *Build > Generate Signed Bundle/APK*.

### iOS (Capacitor + Xcode)

```bash
npx cap add ios            # solo la prima volta: genera il progetto ios/
npm run cap:ios            # build web + cap sync + apre Xcode
```

In Xcode: seleziona il team di firma in *Signing & Capabilities*, poi *Run* o *Product > Archive*.
Per salvare in "File" aggiungi a `ios/App/App/Info.plist` le chiavi `UIFileSharingEnabled` e
`LSSupportsOpeningDocumentsInPlace` = `YES`.

Icone e splash per gli store: `npx @capacitor/assets generate` partendo da `public/icon.svg`
(strumento opzionale, non incluso nelle dipendenze).

## Dati di prova

```bash
node scripts/make-samples.mjs
```

Genera in `samples/` PDF sintetici (dati finti): 3 DPD verticali, 1 Poste orizzontale, etichetta salvata
ruotata, pagina con `/Rotate 90`, due etichette su una pagina, multipagina con pagina vuota, pagina piena,
file non valido. In `npm run dev` sono raggiungibili su `/samples/...`.

## Struttura

```
src/core/       logica pura e testata: bbox.ts, rotation.ts, layout.ts, units.ts, i18n.ts, types.ts
src/pdf/        analyze.ts (pdf.js), compose.ts (pdf-lib), engine.ts (client dei worker), imageToPdf.ts
src/workers/    bbox.worker.ts (analisi pixel), compose.worker.ts (generazione PDF)
src/platform/   output.ts: scarica / condividi / stampa, web e nativo
src/components/ UI React
src/state/      reducer dello stato
```

## Scelte tecniche

- **React + Vite + TypeScript**, PWA con `vite-plugin-pwa` (precache di tutto, incluso il worker di pdf.js),
  **Capacitor 7** per Android/iOS con `@capacitor/filesystem` e `@capacitor/share`.
- **L'output resta vettoriale.** Ogni etichetta è la pagina originale incorporata come Form XObject con
  `pdf-lib.embedPage(page, boundingBox)`: testo, font e codici a barre restano quelli del PDF di partenza.
  Il bitmap di pdf.js serve solo all'analisi. Un test verifica che nel PDF finale ci siano solo XObject `/Form`.
- **Ritaglio**: rendering a 100 dpi (orientamento grezzo, `rotation: 0`), bounding box dei pixel con grigio < 250
  (trasparente = bianco), conversione in coordinate PDF con asse Y invertito, margine di 2 pt, clamp alla pagina.
  Se il riquadro copre ≥ 90% della pagina non si ritaglia (avviso "pagina piena", opzione "Pagina intera").
- **Più etichette su una pagina**: profili di righe/colonne; una banda bianca ≥ 0,5" che separa blocchi ≥ 1,5"
  propone "Dividi". Per i casi non rilevati: Duplica + Ritaglia.
- **Rotazione automatica**: si usa la **direzione del testo** (pdf.js `getTextContent`, pesata per numero di
  caratteri): se il testo corre a θ gradi, si ruota di θ in senso orario. Solo senza testo (immagini, testo
  vettorializzato) si applica la regola della specifica: si rispetta `/Rotate` e il contenuto più alto che largo
  va in orizzontale ruotandolo di 90° in senso orario.
  *Perché*: la regola del solo rapporto d'aspetto girerebbe anche le etichette nativamente verticali con testo
  dritto (DPD A6), contraddicendo il primo test di accettazione (DPD al 100% in 2×2).
- **Layout**: celle uguali, etichetta centrata, `s = min(1, (Lc − 2p)/L, (Hc − 2p)/H)` con p = margine interno
  cella; mai oltre il 100%. Le pagine si riempiono in ordine; le etichette "pagina intera" vanno in fondo.
  **Automatica** = griglia con meno fogli tenendo tutte le etichette ≥ 80% (pari merito: scala minima più alta);
  se nessuna griglia ci riesce, vince quella con la scala minima più alta. Senza la soglia "automatica"
  sceglierebbe sempre la griglia più fitta.
- **Default** (margine foglio 0, spazio 0, margine cella 1,4 mm): sono i valori con cui un'etichetta DPD alta
  ~413 pt resta al 100% in 2×2 e una Poste larga ~327 pt scende all'~88%.
- **Linee di taglio**: grigio 0,5 pt, tratteggio 4/3, al centro degli spazi tra celle, da bordo a bordo.
  Avviso se due etichette distano < 4 mm, misurato sull'inchiostro (senza margine di sicurezza).
- **Scala di grigi vettoriale**: sopra ogni foglio un rettangolo grigio con blend mode `Saturation` (sotto, uno
  sfondo bianco opaco): il risultato ha saturazione zero e la luminosità originale.
- **Prestazioni**: file in coda uno alla volta con barra di avanzamento; parsing di pdf.js nel suo worker,
  scansione dei pixel in `bbox.worker`, generazione del PDF con pdf-lib in `compose.worker`. Il rendering di
  analisi usa l'intent `print`, che non dipende da `requestAnimationFrame`: l'elaborazione continua anche con la
  scheda o l'app in background.
- **Errori per file**: PDF con password di apertura, corrotti, non PDF, pagine vuote finiscono nell'elenco
  "Problemi" senza fermare gli altri file.

## Test

`npm test` esegue 40 test:

- `bbox.test.ts`: bounding box, soglia, trasparenza, regione, conversione pixel→PDF con Y invertita, margine e
  clamp, pagina piena, rilevamento di più etichette.
- `layout.test.ts`: formula di scala, celle, linee di taglio, centratura, rotazioni, fogli multipli, avviso
  < 4 mm, griglia automatica, trasformazioni di `drawPage` per 0/90/180/270. Contiene i test di accettazione
  "DPD + Poste in 1 A4 (DPD 100%, Poste ~88%)" e "9 etichette in 2×2 → 3 fogli (4+4+1)".
- `rotation.test.ts`: direzione del testo, fallback sul rapporto d'aspetto, `/Rotate`.
- `compose.test.ts`: PDF reali generati con pdf-lib → 3 pagine A4 per 9 etichette, solo XObject vettoriali,
  font mantenuti, ExtGState della scala di grigi.

I test di accettazione rimanenti si verificano a mano con i file di `samples/`: etichette ruotate dritte
nell'anteprima, scansione dei codici a barre del PDF stampato, funzionamento offline (`npm run preview`, poi
DevTools > Network > Offline).

## Limiti noti

- **PDF con password del proprietario** (apribili ma cifrati): pdf-lib non sa decifrarli, quindi quella pagina
  viene **rasterizzata a 300 dpi** (avviso sull'etichetta). I codici a barre restano leggibili, ma non è più
  vettoriale. I PDF con **password di apertura** vengono rifiutati con un messaggio.
- **Immagini**: sono raster per natura; si assume 203 dpi (stampanti termiche), quindi la "scala" di un'immagine
  si riferisce a quella risoluzione.
- **Scala di grigi**: si basa sui blend mode PDF. Acrobat, Chrome, Firefox (pdf.js) e i driver moderni li
  rispettano; driver molto vecchi possono ignorarli. Il **bianco e nero puro** non è ottenibile restando
  vettoriali: usa l'opzione B/N della stampante.
- **Stampa su mobile**: si usa il foglio di condivisione. Su iOS c'è sempre "Stampa"; su Android dipende dalle
  app installate (in alternativa apri il PDF con un visualizzatore e stampa da lì). Un plugin di stampa nativo
  richiederebbe una dipendenza in più, non aggiunta. Su Safari desktop "Stampa" apre il PDF in una nuova scheda.
- **Margini della stampante**: con margine foglio 0 un'etichetta molto alta arriva a ~1,4 mm dal bordo e alcune
  stampanti la tagliano. In quel caso imposta il margine foglio a 4 mm.
- **Bin-packing** non implementato: solo griglie a celle uguali (più "pagina intera").
- **Più etichette su una pagina**: si rileva solo una divisione semplice (righe oppure colonne) separata da una
  banda bianca; layout più complessi richiedono il ritaglio manuale.
- **Anteprima**: i font standard non incorporati vengono approssimati nell'anteprima di pdf.js; il PDF generato
  non ne risente.
- **Memoria**: ogni pagina conserva un'anteprima JPEG (~900 px). Centinaia di etichette su telefoni con poca
  RAM possono rallentare.
- Le icone sono SVG: i browser moderni le accettano nel manifest; per gli store genera i PNG con
  `@capacitor/assets`.
