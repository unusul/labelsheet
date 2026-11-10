/**
 * Automatic orientation of a label.
 *
 * Primary signal: the direction of the text layer (pdf.js text items). If most characters run
 * at angle θ (counter-clockwise, PDF user space), rotating the content CLOCKWISE by θ makes the
 * text horizontal. This is robust and does not depend on the page /Rotate entry, because the
 * composer embeds the raw (unrotated) page content.
 *
 * Fallback (no text layer, e.g. images or outlined text): the rule of the spec, i.e. honour the
 * page /Rotate and turn "taller than wide" content 90° clockwise into landscape.
 *
 * Why not the aspect rule alone: many couriers (e.g. DPD A6) produce native PORTRAIT labels with
 * upright text; rotating them would make them sideways and shrink them in a 2x2 grid.
 */
import type { Rotation } from './types';

export interface TextItemLike {
  str: string;
  /** pdf.js text item transform [a, b, c, d, e, f]. */
  transform: number[];
}

export function normalizeRotation(deg: number): Rotation {
  const r = (((Math.round(deg / 90) * 90) % 360) + 360) % 360;
  return r as Rotation;
}

/** Minimum number of characters needed to trust the text direction. */
const MIN_TEXT_CHARS = 8;

/**
 * Dominant text direction snapped to 0/90/180/270 (counter-clockwise), weighted by the
 * number of characters. Returns null when there is not enough text.
 */
export function dominantTextAngle(items: TextItemLike[]): Rotation | null {
  const weights = new Map<Rotation, number>();
  let total = 0;
  for (const item of items) {
    const chars = item.str.trim().length;
    if (!chars) continue;
    const [a, b] = item.transform;
    const angle = normalizeRotation((Math.atan2(b, a) * 180) / Math.PI);
    weights.set(angle, (weights.get(angle) ?? 0) + chars);
    total += chars;
  }
  if (total < MIN_TEXT_CHARS) return null;
  let best: Rotation = 0;
  for (const [angle, w] of weights) if (w > (weights.get(best) ?? 0)) best = angle;
  return best;
}

/**
 * Clockwise rotation to apply to the raw page content of a crop.
 *
 * @param textAngle  dominantTextAngle() of the page, or null
 * @param pageRotate the page /Rotate value (clockwise, as reported by pdf.js)
 * @param cropW      crop width in user space (unrotated)
 * @param cropH      crop height in user space (unrotated)
 */
export function autoRotation(textAngle: Rotation | null, pageRotate: number, cropW: number, cropH: number): Rotation {
  if (textAngle !== null) return textAngle;
  const base = normalizeRotation(pageRotate);
  const swapped = base === 90 || base === 270;
  const shownW = swapped ? cropH : cropW;
  const shownH = swapped ? cropW : cropH;
  return shownH > shownW ? normalizeRotation(base + 90) : base;
}
