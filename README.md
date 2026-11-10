# LabelSheet

Lays out N shipping-label PDFs (or images) on A4/Letter sheets so you print as few pages as possible.
Installable web app (PWA, works offline) and Android/iOS app (Capacitor) from **a single codebase**.

**Live app:** https://unusul.github.io/labelsheet/ (open it, then "Install app" / "Add to Home Screen").

**Privacy:** everything runs on the device. No server, no upload, no analytics; in production a
Content-Security-Policy forbids any external origin.

The user interface is available in **Italian and English**, switchable from the IT/EN toggle in the header
(the first visit follows the browser language).

## How it works

1. **Upload**: multiple selection or drag & drop of PDFs (each page = one label) and PNG/JPG/WebP images.
2. **Review & adjust**: for each label, a thumbnail cropped and rotated as it will be printed, the scale in %,
   warnings; rotate (0/90/180/270), manual crop, split (page with several labels), duplicate, reorder,
   remove, "full page". On the side: grid, paper size, margins, space between cells, cut lines, grayscale,
   light/dark theme.
3. **Download / Print**: preview of the actual PDF, Download / Share / Print buttons and a reminder to print at
   100%. File name: `labels_YYYY-MM-DD.pdf` (`etichette_YYYY-MM-DD.pdf` with the Italian UI).

## Requirements

- Node.js **≥ 20** (tested with 22 and 24) and npm.
- Android: Android Studio (SDK 35) and JDK 21.
- iOS: macOS with Xcode 16+ and CocoaPods (or SPM).

## Build

```bash
npm install
npm test          # unit tests (Vitest)
npm run dev       # development: http://localhost:5173
npm run build     # production build in dist/ (PWA + service worker)
npm run preview   # serves dist/ to try offline mode and installation
```

`dist/` can be published on any static hosting **over HTTPS** (required by the service worker and Web Share).
The `base` is relative, so it also works in a sub-folder.

### GitHub Pages

`.github/workflows/pages.yml` runs tests and build at every push to `main` and publishes `dist/` on GitHub Pages
(repository *Settings > Pages > Source: GitHub Actions*). The app is served at
`https://<user>.github.io/<repo>/` and is installable from there.

### Android (Capacitor + Android Studio)

```bash
npx cap add android        # first time only: generates the android/ project
npm run cap:android        # web build + cap sync + opens Android Studio
```

In Android Studio: *Run* on an emulator or device, or *Build > Generate Signed Bundle/APK*.

### iOS (Capacitor + Xcode)

```bash
npx cap add ios            # first time only: generates the ios/ project
npm run cap:ios            # web build + cap sync + opens Xcode
```

In Xcode: pick the signing team in *Signing & Capabilities*, then *Run* or *Product > Archive*.
To save into the Files app, add `UIFileSharingEnabled` and `LSSupportsOpeningDocumentsInPlace` = `YES` to
`ios/App/App/Info.plist`.

Store icons and splash screens: `npx @capacitor/assets generate` from `public/icon.svg`
(optional tool, not in the dependencies).

## Test data and icons

```bash
node scripts/make-samples.mjs   # synthetic label PDFs in samples/ (fake data)
node scripts/make-icons.mjs     # PNG app icons in public/ (no dependencies)
```

The samples cover: 3 portrait DPD labels, 1 landscape Poste label, a label saved sideways, a page with
`/Rotate 90`, two labels on one page, a multi-page file with a blank page, a full page, an invalid file.
With `npm run dev` they are served at `/samples/...`.

## Structure

```
src/core/       pure, tested logic: bbox.ts, rotation.ts, layout.ts, units.ts, i18n.ts, types.ts
src/pdf/        analyze.ts (pdf.js), compose.ts (pdf-lib), engine.ts (worker client), imageToPdf.ts
src/workers/    bbox.worker.ts (pixel analysis), compose.worker.ts (PDF generation)
src/platform/   output.ts: download / share / print, web and native
src/components/ React UI
src/state/      state reducer
```

## Technical choices

- **React + Vite + TypeScript**, PWA with `vite-plugin-pwa` (everything precached, pdf.js worker included),
  **Capacitor 7** for Android/iOS with `@capacitor/filesystem` and `@capacitor/share`.
- **The output stays vector.** Each label is the original page embedded as a Form XObject with
  `pdf-lib.embedPage(page, boundingBox)`: text, fonts and barcodes are those of the source PDF. The pdf.js bitmap
  is used for analysis only. A test checks that the output contains only `/Form` XObjects.
- **Cropping**: render at 100 dpi (raw orientation, `rotation: 0`), bounding box of the pixels with grey < 250
  (transparent = white), conversion to PDF coordinates with the Y axis flipped, 2 pt margin, clamped to the page.
  If the box covers ≥ 90% of the page it is not cropped ("full page" warning, "Full page" option).
- **Several labels on one page**: row/column profiles; a blank band ≥ 0.5" separating blocks ≥ 1.5" offers
  "Split". For undetected cases: Duplicate + Crop.
- **Automatic rotation**: based on the **text direction** (pdf.js `getTextContent`, weighted by number of
  characters): if text runs at θ degrees, the label is rotated θ clockwise. Only without text (images, outlined
  text) the aspect rule applies: honour `/Rotate`, and content taller than wide is turned 90° clockwise into
  landscape. *Why*: the aspect rule alone would also rotate natively portrait labels with upright text (DPD A6),
  making them sideways and smaller in a 2×2 grid.
- **Layout**: equal cells, centred label, `s = min(1, (Wc − 2p)/W, (Hc − 2p)/H)` with p = cell inner margin;
  never above 100%. Sheets are filled in order; "full page" labels go last. **Automatic** = the grid with the
  fewest sheets that keeps every label ≥ 80% (ties: larger minimum scale); if no grid manages it, the one with the
  largest minimum scale wins. Without the threshold "automatic" would always pick the densest grid.
- **Defaults** (sheet margin 0, gap 0, cell margin 1.4 mm): the values with which a ~413 pt tall DPD label stays at
  100% in 2×2 and a ~327 pt wide Poste label goes down to ~88%.
- **Cut lines**: grey 0.5 pt, 4/3 dash, in the middle of the gutters, edge to edge. Warning when two labels are
  closer than 4 mm, measured on the ink (without the safety margin).
- **Vector grayscale**: a grey rectangle with the `Saturation` blend mode over each sheet (on an opaque white
  backdrop): zero saturation, original luminosity.
- **Performance**: files queued one at a time with a progress bar; pdf.js parses in its own worker, pixels are
  scanned in `bbox.worker`, pdf-lib builds the PDF in `compose.worker`. Analysis renders with the `print` intent,
  which does not depend on `requestAnimationFrame`: processing goes on with the tab or app in the background.
- **Per-file errors**: PDFs with an open password, corrupted files, non-PDFs and blank pages are listed under
  "Problems" without stopping the other files.

## Tests

`npm test` runs 40 tests:

- `bbox.test.ts`: bounding box, threshold, transparency, region, pixel→PDF conversion with flipped Y, margin and
  clamping, full page, multi-label detection.
- `layout.test.ts`: scale formula, cells, cut lines, centring, rotations, multiple sheets, < 4 mm warning,
  automatic grid, `drawPage` transforms for 0/90/180/270. Includes the acceptance tests "DPD + Poste on 1 A4
  (DPD 100%, Poste ~88%)" and "9 labels in 2×2 → 3 sheets (4+4+1)".
- `rotation.test.ts`: text direction, aspect-ratio fallback, `/Rotate`.
- `compose.test.ts`: real PDFs generated with pdf-lib → 3 A4 pages for 9 labels, vector XObjects only, fonts kept,
  grayscale ExtGState.

The remaining acceptance tests are manual, with the files in `samples/`: rotated labels upright in the preview,
barcodes of the printed PDF scanning, offline mode (`npm run preview`, then DevTools > Network > Offline).

## Known limitations

- **PDFs with an owner password** (openable but encrypted): pdf-lib cannot decrypt them, so that page is
  **rasterized at 300 dpi** (warning on the label). Barcodes stay readable but no longer vector. PDFs with an
  **open password** are rejected with a message.
- **Images** are raster by nature; 203 dpi is assumed (thermal printers), so the "scale" of an image refers to
  that resolution.
- **Grayscale** relies on PDF blend modes. Acrobat, Chrome, Firefox (pdf.js) and modern drivers honour them; very
  old drivers may ignore them. **Pure black & white** is not possible while staying vector: use the printer's B/W
  option.
- **Printing on mobile** goes through the share sheet. iOS always offers "Print"; on Android it depends on the
  installed apps (otherwise open the PDF in a viewer and print from there). A native print plugin would need an
  extra dependency, not added. On desktop Safari "Print" opens the PDF in a new tab.
- **Printer margins**: with sheet margin 0 a very tall label gets ~1.4 mm from the edge and some printers clip
  it. In that case set the sheet margin to 4 mm.
- **Bin-packing** is not implemented: equal-cell grids only (plus "full page").
- **Several labels on one page**: only a simple split (rows or columns) separated by a blank band is detected;
  more complex layouts need a manual crop.
- **Preview**: non-embedded standard fonts are approximated in the pdf.js preview; the generated PDF is not
  affected.
- **Memory**: each page keeps a JPEG preview (~900 px). Hundreds of labels on low-RAM phones can slow down.
