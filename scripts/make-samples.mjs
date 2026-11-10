/**
 * Generates synthetic label PDFs in ./samples for manual and acceptance testing.
 * All data is fake. Run: node scripts/make-samples.mjs
 *
 *  dpd-1..3.pdf        A4, portrait label 277x407 pt (crop ~283x413 with border and safety margin) in the top-left area (DPD-like, upright text)
 *  poste.pdf           A4, landscape label 321x232 pt (crop ~327x238) (Poste-like)
 *  sideways.pdf        A4, label saved rotated by 90° (text runs bottom-to-top)
 *  rotate-attr.pdf     A4 with /Rotate 90 whose content is drawn upright for the viewer
 *  two-labels.pdf      A4 with two labels stacked (multi-label detection)
 *  multipage.pdf       3 pages, one label each, plus a blank 4th page
 *  full-page.pdf       content covering the whole A4
 *  not-a-pdf.pdf       garbage (error handling)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';

const A4 = [595.28, 841.89];
const OUT = new URL('../samples/', import.meta.url);
mkdirSync(OUT, { recursive: true });

/** Vector "barcode": deterministic bars from a seed. */
function bars(page, x, y, width, height, seed, vertical = false) {
  let s = seed;
  let pos = 0;
  while (pos < width) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const w = 1 + (s % 3);
    if ((s >> 4) % 2 === 0) {
      if (vertical) page.drawRectangle({ x, y: y + pos, width: height, height: w, color: rgb(0, 0, 0) });
      else page.drawRectangle({ x: x + pos, y, width: w, height, color: rgb(0, 0, 0) });
    }
    pos += w;
  }
}

/** Draws an upright label whose lower-left corner is (x, y). */
function drawLabel(page, font, bold, { x, y, w, h, carrier, n }) {
  page.drawRectangle({ x, y, width: w, height: h, borderColor: rgb(0, 0, 0), borderWidth: 1.5 });
  page.drawRectangle({ x, y: y + h - 34, width: w, height: 34, color: carrier === 'DPD' ? rgb(0.86, 0.08, 0.24) : rgb(0.1, 0.3, 0.7) });
  page.drawText(`${carrier} CLASSIC`, { x: x + 10, y: y + h - 24, size: 16, font: bold, color: rgb(1, 1, 1) });
  const lines = ['Sender: Demo Shop Ltd', 'Via Esempio 12, 20100 Milano MI', '', 'Recipient:', `Mario Rossi ${n}`, `Via Roma ${n}`, '00100 Roma RM', 'Tel. 000 000 0000'];
  lines.forEach((t, i) => page.drawText(t, { x: x + 10, y: y + h - 56 - i * 14, size: 10, font }));
  bars(page, x + 10, y + 40, w - 20, Math.min(90, h * 0.25), n * 7919);
  page.drawText(`*${carrier}${String(n).padStart(10, '0')}*`, { x: x + 10, y: y + 22, size: 9, font });
}

async function doc() {
  const d = await PDFDocument.create();
  return { d, font: await d.embedFont(StandardFonts.Helvetica), bold: await d.embedFont(StandardFonts.HelveticaBold) };
}

async function save(d, name) {
  writeFileSync(new URL(name, OUT), await d.save());
  console.log('samples/' + name);
}

for (let n = 1; n <= 3; n++) {
  const { d, font, bold } = await doc();
  drawLabel(d.addPage(A4), font, bold, { x: 20, y: A4[1] - 20 - 413, w: 277, h: 407, carrier: 'DPD', n });
  await save(d, `dpd-${n}.pdf`);
}

{
  const { d, font, bold } = await doc();
  drawLabel(d.addPage(A4), font, bold, { x: 30, y: A4[1] - 30 - 238, w: 321, h: 232, carrier: 'POSTE', n: 4 });
  await save(d, 'poste.pdf');
}

{
  // Sideways: the whole label rotated 90° counter-clockwise on the page (text runs bottom-to-top).
  const { d, font, bold } = await doc();
  const page = d.addPage(A4);
  const w = 360, h = 240;
  // Draw into an embedded page, then place it rotated.
  const tmp = await PDFDocument.create();
  const tf = await tmp.embedFont(StandardFonts.Helvetica);
  const tb = await tmp.embedFont(StandardFonts.HelveticaBold);
  drawLabel(tmp.addPage([w, h]), tf, tb, { x: 0, y: 0, w, h, carrier: 'GLS', n: 5 });
  const [emb] = await d.embedPdf(await tmp.save());
  page.drawPage(emb, { x: 40 + h, y: A4[1] - 40 - w, rotate: degrees(90) });
  void font; void bold;
  await save(d, 'sideways.pdf');
}

{
  // /Rotate 90: content drawn so that it looks upright once the viewer applies the page rotation.
  const tmp = await PDFDocument.create();
  const tf = await tmp.embedFont(StandardFonts.Helvetica);
  const tb = await tmp.embedFont(StandardFonts.HelveticaBold);
  drawLabel(tmp.addPage([340, 230]), tf, tb, { x: 0, y: 0, w: 340, h: 230, carrier: 'BRT', n: 6 });
  const d = await PDFDocument.create();
  const page = d.addPage(A4);
  page.setRotation(degrees(90));
  const [emb] = await d.embedPdf(await tmp.save());
  // Viewer turns the page 90° clockwise, so draw the label turned 90° counter-clockwise.
  page.drawPage(emb, { x: 60 + 230, y: 60, rotate: degrees(90) });
  await save(d, 'rotate-attr.pdf');
}

{
  const { d, font, bold } = await doc();
  const page = d.addPage(A4);
  drawLabel(page, font, bold, { x: 40, y: A4[1] - 40 - 300, w: 400, h: 300, carrier: 'INPOST', n: 7 });
  drawLabel(page, font, bold, { x: 40, y: 60, w: 400, h: 300, carrier: 'INPOST', n: 8 });
  await save(d, 'two-labels.pdf');
}

{
  const { d, font, bold } = await doc();
  for (let n = 9; n <= 11; n++) drawLabel(d.addPage(A4), font, bold, { x: 25, y: A4[1] - 25 - 260, w: 300, h: 260, carrier: 'VINTED GO', n });
  d.addPage(A4); // blank page
  await save(d, 'multipage.pdf');
}

{
  const { d, font, bold } = await doc();
  drawLabel(d.addPage(A4), font, bold, { x: 8, y: 8, w: A4[0] - 16, h: A4[1] - 16, carrier: 'DPD', n: 12 });
  await save(d, 'full-page.pdf');
}

writeFileSync(new URL('not-a-pdf.pdf', OUT), 'this is not a pdf');
console.log('samples/not-a-pdf.pdf');
