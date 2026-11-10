/**
 * Wraps raster inputs (PNG/JPG/WebP labels, rasterized fallbacks) into a one-page PDF so that
 * images and PDFs go through exactly the same pipeline.
 */
import { PDFDocument } from 'pdf-lib';

/**
 * Assumed resolution of label images: 203 dpi is the native resolution of most thermal label
 * printers, so a 812x1218 px courier image becomes a 4x6 in label.
 */
export const IMAGE_DPI = 203;

export async function pngToPdf(png: Uint8Array, widthPt: number, heightPt: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const image = await doc.embedPng(png);
  doc.addPage([widthPt, heightPt]).drawImage(image, { x: 0, y: 0, width: widthPt, height: heightPt });
  return doc.save();
}

export async function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('PNG encoding failed');
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Decodes an image file (the browser applies the EXIF orientation of JPEG photos) and re-encodes it
 * losslessly as PNG, so barcodes keep sharp edges.
 */
export async function imageFileToPdf(file: Blob): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const png = await canvasToPng(canvas);
  return pngToPdf(png, (canvas.width * 72) / IMAGE_DPI, (canvas.height * 72) / IMAGE_DPI);
}
