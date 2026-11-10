/**
 * Shared domain types.
 *
 * Coordinate convention: every `Rect` is in PDF points (1 pt = 1/72 in) in PDF user space,
 * origin at the BOTTOM-LEFT corner, Y growing upwards (the opposite of canvas pixels).
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Clockwise rotation applied to a label when it is placed on the sheet. */
export type Rotation = 0 | 90 | 180 | 270;

export type PaperName = 'A4' | 'Letter';

export interface PaperSize {
  name: PaperName;
  width: number;
  height: number;
}

export interface Grid {
  cols: number;
  rows: number;
}

export type GridId = '2x2' | '2x3' | '1x2' | '1x3' | 'auto';

export type ColorMode = 'color' | 'grayscale';

export type Lang = 'it' | 'en';

export type ThemePref = 'system' | 'light' | 'dark';

export interface Settings {
  paper: PaperName;
  grid: GridId;
  /** Sheet margin on every side, millimetres. */
  marginMm: number;
  /** Space between adjacent cells, millimetres. */
  gapMm: number;
  /** Inner padding of each cell on every side, millimetres (the "margin" of the scale formula is 2x this). */
  paddingMm: number;
  cutLines: boolean;
  colorMode: ColorMode;
  lang: Lang;
  theme: ThemePref;
}

export type LabelWarning =
  | 'fullPage' // content fills (almost) the whole page: not cropped aggressively
  | 'multiLabel' // the page probably contains more than one label
  | 'rasterized' // the source was encrypted: label rasterized at 300 dpi
  | 'noText'; // no text layer: rotation guessed from the aspect ratio

/** One label = one crop of one page of one source document. */
export interface LabelItem {
  id: string;
  sourceId: string;
  fileName: string;
  pageIndex: number;
  pageCount: number;
  /** Visible page box (pdf.js `page.view`) in user space. */
  pageBox: Rect;
  /** Crop found by the automatic detection (null if the page was blank). */
  autoCrop: Rect;
  /** Crop currently in use (auto or manual). */
  crop: Rect;
  /** Dominant text direction of the page (null = no usable text layer). */
  textAngle: Rotation | null;
  /** Page /Rotate (clockwise). */
  pageRotate: number;
  /** Rotation proposed by the auto-detection for the current crop. */
  autoRotation: Rotation;
  /** Rotation chosen by the user; null = use autoRotation. */
  rotation: Rotation | null;
  /** Print this label alone on a full sheet. */
  ownSheet: boolean;
  /** JPEG data URL of the whole (unrotated) page, used for thumbnails and manual crop. */
  preview: string;
  warnings: LabelWarning[];
  /** Suggested crops when the page seems to hold several labels. */
  splits: Rect[];
}

export type FileErrorCode = 'password' | 'corrupt' | 'blank' | 'unsupported' | 'unknown';

export interface FileIssue {
  fileName: string;
  /** 1-based page, when the issue concerns a single page. */
  page?: number;
  code: FileErrorCode;
}

export function effectiveRotation(item: Pick<LabelItem, 'rotation' | 'autoRotation'>): Rotation {
  return item.rotation ?? item.autoRotation;
}
