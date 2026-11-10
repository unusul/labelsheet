/// <reference lib="webworker" />
/**
 * Pixel analysis worker: ink bounding box + detection of several labels on one page.
 * The RGBA buffer is transferred (not copied) from the UI thread.
 */
import { detectLabelBlocks, findInkBox, type PixelBox } from '../core/bbox';

export interface BboxWorkerIn {
  reqId: number;
  data: ArrayBuffer;
  width: number;
  height: number;
  threshold: number;
  /** Pixels per point of the render. */
  pxPerPt: number;
}

export interface BboxWorkerOut {
  reqId: number;
  box: PixelBox | null;
  /** Tight boxes of each label when the page seems to hold more than one. */
  blocks: PixelBox[];
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;

/** A blank band of at least 0.5 in separates two labels; each block must be at least 1.5 in. */
const MIN_GAP_PT = 36;
const MIN_BLOCK_PT = 108;

ctx.onmessage = (event: MessageEvent<BboxWorkerIn>) => {
  const { reqId, width, height, threshold, pxPerPt } = event.data;
  const data = new Uint8ClampedArray(event.data.data);
  const scan = findInkBox(data, width, height, threshold);
  const blocks = detectLabelBlocks(scan, MIN_GAP_PT * pxPerPt, MIN_BLOCK_PT * pxPerPt)
    .map((region) => findInkBox(data, width, height, threshold, region).box)
    .filter((b): b is PixelBox => b !== null);
  const out: BboxWorkerOut = { reqId, box: scan.box, blocks };
  ctx.postMessage(out);
};
