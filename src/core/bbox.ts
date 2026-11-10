/**
 * Ink bounding-box detection on a rendered page bitmap, and conversion to PDF coordinates.
 *
 * The bitmap is used ONLY for analysis: the output PDF embeds the original vector page,
 * clipped to the rectangle computed here.
 */
import type { Rect } from './types';
import { CROP_SAFETY_MARGIN_PT, INK_THRESHOLD } from './units';

/** Pixel box: left/top inclusive, right/bottom exclusive, Y grows downwards (canvas convention). */
export interface PixelBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface InkScan {
  box: PixelBox | null;
  /** Ink pixels per row of the scanned region (index 0 = region.top). */
  rowInk: Uint32Array;
  /** Ink pixels per column of the scanned region (index 0 = region.left). */
  colInk: Uint32Array;
}

/**
 * Grey level of an RGBA pixel composited over white (a transparent pixel counts as white).
 * Rec.601 luma, integer maths.
 */
export function greyOverWhite(r: number, g: number, b: number, a: number): number {
  const luma = (299 * r + 587 * g + 114 * b) / 1000;
  return 255 - (a / 255) * (255 - luma);
}

/**
 * Finds the bounding box of the "non-white" pixels (grey < threshold) inside `region`
 * (defaults to the whole bitmap). Returns null when the region is blank.
 */
export function findInkBox(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  threshold = INK_THRESHOLD,
  region: PixelBox = { left: 0, top: 0, right: width, bottom: height },
): InkScan {
  const rw = region.right - region.left;
  const rh = region.bottom - region.top;
  const rowInk = new Uint32Array(Math.max(rh, 0));
  const colInk = new Uint32Array(Math.max(rw, 0));
  let left = Infinity;
  let top = Infinity;
  let right = -1;
  let bottom = -1;
  for (let y = region.top; y < region.bottom; y++) {
    let offset = (y * width + region.left) * 4;
    for (let x = region.left; x < region.right; x++, offset += 4) {
      if (greyOverWhite(data[offset], data[offset + 1], data[offset + 2], data[offset + 3]) >= threshold) continue;
      rowInk[y - region.top]++;
      colInk[x - region.left]++;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      bottom = y;
    }
  }
  const box = right < 0 ? null : { left, top, right: right + 1, bottom: bottom + 1 };
  return { box, rowInk, colInk };
}

/**
 * Converts a pixel box of a page rendered UNROTATED at `pxPerPt` pixels per point into a PDF rect.
 * The Y axis is flipped: pixel row 0 is the TOP of the page box, PDF y grows upwards.
 * A safety margin is added and the result is clamped to the page box.
 */
export function pixelBoxToPdfRect(
  box: PixelBox,
  pxPerPt: number,
  pageBox: Rect,
  marginPt = CROP_SAFETY_MARGIN_PT,
): Rect {
  const pageTop = pageBox.y + pageBox.height;
  const x0 = Math.max(pageBox.x, pageBox.x + box.left / pxPerPt - marginPt);
  const x1 = Math.min(pageBox.x + pageBox.width, pageBox.x + box.right / pxPerPt + marginPt);
  const y0 = Math.max(pageBox.y, pageTop - box.bottom / pxPerPt - marginPt);
  const y1 = Math.min(pageTop, pageTop - box.top / pxPerPt + marginPt);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * True when the crop covers (almost) the whole page: such content must not be cropped
 * aggressively (an A4 full of content is probably not a small label).
 */
export function coversNearlyFullPage(crop: Rect, pageBox: Rect, ratio = 0.9): boolean {
  return crop.width >= pageBox.width * ratio && crop.height >= pageBox.height * ratio;
}

/** Blank runs (consecutive zero entries) of a profile, as [start, end) index pairs. */
function inkSegments(profile: Uint32Array, minGap: number): Array<[number, number]> {
  const segments: Array<[number, number]> = [];
  let start = -1;
  let blank = 0;
  for (let i = 0; i < profile.length; i++) {
    if (profile[i] > 0) {
      if (start < 0) start = i;
      else if (blank >= minGap) {
        segments.push([start, i - blank]);
        start = i;
      }
      blank = 0;
    } else if (start >= 0) blank++;
  }
  if (start >= 0) segments.push([start, profile.length - blank]);
  return segments;
}

/**
 * Detects several labels on one page: looks for wide blank bands (rows first, then columns)
 * that split the ink into two or more blocks, each big enough to be a label on its own.
 *
 * @param scan         result of findInkBox over the whole page
 * @param minGapPx     minimum width of the blank band, in pixels
 * @param minBlockPx   minimum size of each block along the split axis, in pixels
 * @returns the pixel boxes of the blocks (not yet tightened on the other axis), or [] if no split
 */
export function detectLabelBlocks(scan: InkScan, minGapPx: number, minBlockPx: number): PixelBox[] {
  const { box } = scan;
  if (!box) return [];
  const big = (s: [number, number]) => s[1] - s[0] >= minBlockPx;
  const rows = inkSegments(scan.rowInk.subarray(box.top, box.bottom), minGapPx);
  if (rows.length > 1 && rows.every(big)) {
    return rows.map(([a, b]) => ({ left: box.left, right: box.right, top: box.top + a, bottom: box.top + b }));
  }
  const cols = inkSegments(scan.colInk.subarray(box.left, box.right), minGapPx);
  if (cols.length > 1 && cols.every(big)) {
    return cols.map(([a, b]) => ({ top: box.top, bottom: box.bottom, left: box.left + a, right: box.left + b }));
  }
  return [];
}
