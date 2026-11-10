/**
 * Builds the output PDF with pdf-lib. Runs inside a Web Worker in the app and in Node in the tests.
 *
 * Every label is the ORIGINAL page embedded as a Form XObject clipped to the crop rectangle
 * (`embedPage` with a bounding box): text, vector barcodes and fonts are kept as they are;
 * nothing is rasterized.
 */
import {
  PDFDocument,
  PDFName,
  degrees,
  rgb,
  pushGraphicsState,
  popGraphicsState,
  setGraphicsState,
  setFillingRgbColor,
  rectangle,
  fill,
  type PDFEmbeddedPage,
  type PDFPage,
} from 'pdf-lib';
import { drawParams, type Sheet } from '../core/layout';
import type { PaperSize, Rect, Rotation } from '../core/types';

export interface ComposeLabel {
  sourceId: string;
  pageIndex: number;
  crop: Rect;
  rotation: Rotation;
}

export interface ComposeRequest {
  paper: PaperSize;
  sheets: Sheet[];
  labels: Record<string, ComposeLabel>;
  cutLines: boolean;
  grayscale: boolean;
  title?: string;
}

export type SourceLoader = (sourceId: string) => Promise<PDFDocument>;

const CUT_LINE = { thickness: 0.5, color: rgb(0.55, 0.55, 0.55), dashArray: [4, 3] };

/**
 * Grayscale while staying vector: paint a neutral rectangle over the sheet with the "Saturation"
 * blend mode. The result takes the (zero) saturation of the grey source and hue/luminosity of
 * what is below, i.e. a grey-scale rendering of every label. pdf-lib's BlendMode enum lacks
 * Saturation, so the ExtGState is written by hand.
 */
function applyGrayscale(doc: PDFDocument, page: PDFPage): void {
  const gs = doc.context.obj({ Type: 'ExtGState', BM: PDFName.of('Saturation') });
  const name = page.node.newExtGState('GSgray', doc.context.register(gs));
  const { width, height } = page.getSize();
  page.pushOperators(
    pushGraphicsState(),
    setGraphicsState(name),
    setFillingRgbColor(0.5, 0.5, 0.5),
    rectangle(0, 0, width, height),
    fill(),
    popGraphicsState(),
  );
}

async function embedLabel(
  out: PDFDocument,
  label: ComposeLabel,
  load: SourceLoader,
  cache: Map<string, PDFEmbeddedPage>,
): Promise<PDFEmbeddedPage> {
  const { x, y, width, height } = label.crop;
  const key = `${label.sourceId}#${label.pageIndex}#${x},${y},${width},${height}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const src = await load(label.sourceId);
  const page = src.getPage(label.pageIndex);
  const embedded = await out.embedPage(page, { left: x, bottom: y, right: x + width, top: y + height });
  cache.set(key, embedded);
  return embedded;
}

export async function composePdf(req: ComposeRequest, load: SourceLoader): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  out.setTitle(req.title ?? 'Labels');
  out.setProducer('LabelSheet');
  out.setCreator('LabelSheet');
  const cache = new Map<string, PDFEmbeddedPage>();
  for (const sheet of req.sheets) {
    const page = out.addPage([req.paper.width, req.paper.height]);
    // Opaque white backdrop: some renderers (pdf.js) blend against a TRANSPARENT page backdrop,
    // where "Saturation" would turn empty paper grey.
    if (req.grayscale) page.drawRectangle({ x: 0, y: 0, width: req.paper.width, height: req.paper.height, color: rgb(1, 1, 1) });
    for (const p of sheet.placements) {
      const label = req.labels[p.id];
      const embedded = await embedLabel(out, label, load, cache);
      const { x, y, ccwDegrees } = drawParams(p.box, p.rotation);
      page.drawPage(embedded, { x, y, xScale: p.scale, yScale: p.scale, rotate: degrees(ccwDegrees) });
    }
    if (req.grayscale) applyGrayscale(out, page);
    if (req.cutLines) {
      for (const l of sheet.cutLines) page.drawLine({ start: { x: l.x1, y: l.y1 }, end: { x: l.x2, y: l.y2 }, ...CUT_LINE });
    }
  }
  return out.save();
}
