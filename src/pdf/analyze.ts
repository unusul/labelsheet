/**
 * Turns an input file into label items: render each page with pdf.js (bitmap for analysis only),
 * find the ink box in the worker, read the text direction, propose crop and rotation.
 */
import { coversNearlyFullPage, pixelBoxToPdfRect, type PixelBox } from '../core/bbox';
import { autoRotation, dominantTextAngle, type TextItemLike } from '../core/rotation';
import type { FileIssue, LabelItem, LabelWarning, Rect } from '../core/types';
import { INK_THRESHOLD } from '../core/units';
import { uid } from '../core/ids';
import { getEngine } from './engine';
import { canvasToPng, imageFileToPdf, pngToPdf } from './imageToPdf';
import { openPdf, type PdfDocument } from './pdfjs';

/** Analysis resolution (spec: 72-150 dpi). */
const ANALYSIS_DPI = 100;
/** Never render analysis bitmaps bigger than this on the long side (huge pages, low-memory phones). */
const MAX_ANALYSIS_PX = 2400;
/** Resolution of the raster fallback for encrypted sources. */
const RASTER_DPI = 300;
const PREVIEW_MAX_PX = 900;

type PdfPage = Awaited<ReturnType<PdfDocument['getPage']>>;

export interface AnalyzeHandlers {
  onItem: (item: LabelItem) => void;
  onIssue: (issue: FileIssue) => void;
}

const IMAGE_RE = /\.(png|jpe?g|webp|gif|bmp)$/i;

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || IMAGE_RE.test(file.name);
}

function looksLikePdf(bytes: Uint8Array): boolean {
  const head = new TextDecoder().decode(bytes.subarray(0, 1024));
  return head.includes('%PDF-');
}

function pageBoxOf(page: PdfPage): Rect {
  const [x0, y0, x1, y1] = page.view;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

async function renderPage(page: PdfPage, pxPerPt: number): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale: pxPerPt, rotation: 0 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff'; // the canvas is transparent black by default: that would be "ink"
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // intent 'print': no requestAnimationFrame scheduling, so analysis keeps going when the tab or
  // the app is in the background (rAF is paused there); it also matches what will be printed.
  await page.render({ canvasContext: ctx, viewport, intent: 'print' }).promise;
  return canvas;
}

function previewOf(canvas: HTMLCanvasElement): string {
  const k = Math.min(1, PREVIEW_MAX_PX / Math.max(canvas.width, canvas.height));
  const small = document.createElement('canvas');
  small.width = Math.round(canvas.width * k);
  small.height = Math.round(canvas.height * k);
  small.getContext('2d')!.drawImage(canvas, 0, 0, small.width, small.height);
  return small.toDataURL('image/jpeg', 0.85);
}

function shiftRect(r: Rect, dx: number, dy: number): Rect {
  return { ...r, x: r.x + dx, y: r.y + dy };
}

/**
 * Raster fallback for sources pdf-lib cannot embed (encrypted with an owner password, or broken
 * structure that only pdf.js tolerates): the page is rendered at 300 dpi and wrapped in a new PDF
 * of the same size with its origin at (0, 0).
 */
async function rasterSource(page: PdfPage, pageBox: Rect): Promise<string> {
  const canvas = await renderPage(page, RASTER_DPI / 72);
  const pdf = await pngToPdf(await canvasToPng(canvas), pageBox.width, pageBox.height);
  canvas.width = canvas.height = 0;
  const sourceId = uid('raster');
  await getEngine().registerSource(sourceId, pdf.slice().buffer as ArrayBuffer);
  return sourceId;
}

interface PageContext {
  file: File;
  sourceId: string;
  needsRaster: boolean;
  isImage: boolean;
  pageCount: number;
}

async function analyzePage(pdf: PdfDocument, index: number, ctx: PageContext, h: AnalyzeHandlers): Promise<void> {
  const page = await pdf.getPage(index + 1);
  try {
    let pageBox = pageBoxOf(page);
    const pxPerPt = Math.min(ANALYSIS_DPI / 72, MAX_ANALYSIS_PX / Math.max(pageBox.width, pageBox.height));
    const canvas = await renderPage(page, pxPerPt);
    const preview = previewOf(canvas);
    const bitmap = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    canvas.width = canvas.height = 0; // free the backing store early (iOS keeps canvases alive)
    const scan = await getEngine().analyzeBitmap(bitmap.data.buffer as ArrayBuffer, bitmap.width, bitmap.height, pxPerPt, INK_THRESHOLD);
    if (!scan.box) {
      h.onIssue({ fileName: ctx.file.name, page: index + 1, code: 'blank' });
      return;
    }
    const toPdf = (b: PixelBox) => pixelBoxToPdfRect(b, pxPerPt, pageBox);
    const warnings: LabelWarning[] = [];
    let crop = toPdf(scan.box);
    if (coversNearlyFullPage(crop, pageBox)) {
      crop = { ...pageBox };
      warnings.push('fullPage');
    }
    let splits = scan.blocks.length > 1 ? scan.blocks.map(toPdf) : [];
    if (splits.length) warnings.push('multiLabel');

    const text = await page.getTextContent();
    const textAngle = dominantTextAngle(text.items.filter((i): i is TextItemLike & typeof i => 'str' in i));
    if (textAngle === null && !ctx.isImage) warnings.push('noText');

    let sourceId = ctx.sourceId;
    if (ctx.needsRaster) {
      sourceId = await rasterSource(page, pageBox);
      const dx = -pageBox.x;
      const dy = -pageBox.y;
      crop = shiftRect(crop, dx, dy);
      splits = splits.map((s) => shiftRect(s, dx, dy));
      pageBox = shiftRect(pageBox, dx, dy);
      warnings.push('rasterized');
    }

    h.onItem({
      id: uid('label'),
      sourceId,
      fileName: ctx.file.name,
      pageIndex: ctx.needsRaster ? 0 : index,
      pageCount: ctx.pageCount,
      pageBox,
      autoCrop: crop,
      crop,
      textAngle,
      pageRotate: page.rotate,
      autoRotation: autoRotation(textAngle, page.rotate, crop.width, crop.height),
      rotation: null,
      ownSheet: false,
      preview,
      warnings,
      splits,
    });
  } finally {
    page.cleanup();
  }
}

function pdfJsErrorCode(e: unknown): FileIssue['code'] {
  const name = (e as { name?: string })?.name;
  if (name === 'PasswordException') return 'password';
  if (name === 'InvalidPDFException' || name === 'FormatError') return 'corrupt';
  return 'unknown';
}

/**
 * Analyses one file. Never throws: problems are reported through `onIssue`, so one bad file
 * does not stop the others.
 */
export async function analyzeFile(file: File, h: AnalyzeHandlers, onPageProgress?: (done: number, total: number) => void): Promise<void> {
  const engine = getEngine();
  const isImage = isImageFile(file);
  let bytes: Uint8Array;
  try {
    bytes = isImage ? await imageFileToPdf(file) : new Uint8Array(await file.arrayBuffer());
  } catch {
    h.onIssue({ fileName: file.name, code: isImage ? 'unsupported' : 'unknown' });
    return;
  }
  if (!looksLikePdf(bytes)) {
    h.onIssue({ fileName: file.name, code: 'unsupported' });
    return;
  }
  const sourceId = uid('src');
  // pdf-lib (composer) and pdf.js (analysis) open the file in parallel.
  const registered = engine.registerSource(sourceId, bytes.slice().buffer as ArrayBuffer).catch(() => null);
  let pdf: PdfDocument;
  try {
    pdf = await openPdf(bytes);
  } catch (e) {
    engine.unregisterSource(sourceId);
    h.onIssue({ fileName: file.name, code: pdfJsErrorCode(e) });
    return;
  }
  try {
    const info = await registered;
    const needsRaster = !info || info.encrypted;
    if (needsRaster) engine.unregisterSource(sourceId);
    const ctx: PageContext = { file, sourceId, needsRaster, isImage, pageCount: pdf.numPages };
    for (let i = 0; i < pdf.numPages; i++) {
      try {
        await analyzePage(pdf, i, ctx, h);
      } catch {
        h.onIssue({ fileName: file.name, page: i + 1, code: 'corrupt' });
      }
      onPageProgress?.(i + 1, pdf.numPages);
    }
  } finally {
    await pdf.destroy();
  }
}
