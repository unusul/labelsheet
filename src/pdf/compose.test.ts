/**
 * Integration test of the composer on real PDFs generated with pdf-lib (vector text + a vector
 * "barcode" made of rectangles), checking page count and that the output stays vector.
 */
import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFRawStream, StandardFonts, rgb, PDFDict } from 'pdf-lib';
import { composePdf, type ComposeLabel } from './compose';
import { layoutFixed } from '../core/layout';
import { PAPERS, mmToPt } from '../core/units';

/** An A4 page with a label in the top half: text + vector bars. */
async function labelPdf(text: string): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(text, { x: 40, y: 780, size: 14, font });
  for (let i = 0; i < 40; i++) {
    page.drawRectangle({ x: 40 + i * 6, y: 640, width: i % 3 === 0 ? 3 : 1.5, height: 100, color: rgb(0, 0, 0) });
  }
  return PDFDocument.load(await doc.save());
}

const crop = { x: 38, y: 638, width: 260, height: 160 };

async function compose(count: number, opts: { grayscale?: boolean; cutLines?: boolean } = {}) {
  const docs = new Map<string, PDFDocument>();
  const labels: Record<string, ComposeLabel> = {};
  for (let i = 0; i < count; i++) {
    docs.set(`s${i}`, await labelPdf(`Label ${i} - Mario Rossi, Via Roma ${i}`));
    labels[`l${i}`] = { sourceId: `s${i}`, pageIndex: 0, crop, rotation: i % 2 ? 90 : 0 };
  }
  const layoutLabels = Object.entries(labels).map(([id, l]) => ({
    id, width: l.crop.width, height: l.crop.height, rotation: l.rotation, ownSheet: false,
  }));
  const paper = PAPERS.A4;
  const result = layoutFixed(layoutLabels, { cols: 2, rows: 2 }, { paper, marginPt: 0, gapPt: 0, paddingPt: mmToPt(1.4) });
  const bytes = await composePdf(
    { paper, sheets: result.sheets, labels, cutLines: opts.cutLines ?? true, grayscale: opts.grayscale ?? false },
    async (id) => docs.get(id)!,
  );
  return PDFDocument.load(bytes);
}

/** Collects the /Subtype of every XObject reachable from the pages' resources. */
function xobjectSubtypes(doc: PDFDocument): string[] {
  const subtypes: string[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    const dict = obj instanceof PDFRawStream ? obj.dict : obj instanceof PDFDict ? obj : null;
    if (dict?.get(PDFName.of('Type')) === PDFName.of('XObject')) {
      subtypes.push(String(dict.get(PDFName.of('Subtype'))));
    }
  }
  return subtypes;
}

describe('composePdf', () => {
  it('9 labels on 2x2 produce 3 A4 pages', async () => {
    const out = await compose(9);
    expect(out.getPageCount()).toBe(3);
    const { width, height } = out.getPage(0).getSize();
    expect(width).toBeCloseTo(595.28);
    expect(height).toBeCloseTo(841.89);
  });

  it('keeps labels vector: Form XObjects only, no image XObject', async () => {
    const out = await compose(4, { grayscale: true });
    const subtypes = xobjectSubtypes(out);
    expect(subtypes.length).toBeGreaterThanOrEqual(4);
    expect(subtypes.every((s) => s === '/Form')).toBe(true);
  });

  it('grayscale adds a Saturation blend ExtGState (vector, no rasterization)', async () => {
    const out = await compose(1, { grayscale: true });
    const gs = [...out.context.enumerateIndirectObjects()].filter(
      ([, o]) => o instanceof PDFDict && o.get(PDFName.of('BM')) === PDFName.of('Saturation'),
    );
    expect(gs).toHaveLength(1);
  });

  it('keeps the fonts of the source (text stays text)', async () => {
    const out = await compose(1);
    const fonts = [...out.context.enumerateIndirectObjects()].filter(
      ([, o]) => o instanceof PDFDict && o.get(PDFName.of('Type')) === PDFName.of('Font'),
    );
    expect(fonts.length).toBeGreaterThan(0);
  });
});
