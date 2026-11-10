import type { PaperName, PaperSize } from './types';

export const PT_PER_MM = 72 / 25.4;

export function mmToPt(mm: number): number {
  return mm * PT_PER_MM;
}

export function ptToMm(pt: number): number {
  return pt / PT_PER_MM;
}

export const PAPERS: Record<PaperName, PaperSize> = {
  A4: { name: 'A4', width: 595.28, height: 841.89 },
  Letter: { name: 'Letter', width: 612, height: 792 },
};

/** Labels closer than this (on the sheet) trigger a "hard to cut" warning. */
export const MIN_CUT_DISTANCE_PT = mmToPt(4);

/** Below this scale barcodes may stop scanning reliably. */
export const LOW_SCALE_THRESHOLD = 0.8;

/** Safety margin added around the detected ink box. */
export const CROP_SAFETY_MARGIN_PT = 2;

/** Grey level (0-255) under which a pixel counts as "ink". */
export const INK_THRESHOLD = 250;

/** Output file name: etichette_YYYY-MM-DD.pdf (local date). */
export function outputFileName(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `etichette_${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.pdf`;
}
