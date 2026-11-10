/**
 * pdf.js setup. The legacy build is used on purpose: it runs on older iOS/Android WebViews
 * that miss some recent JS features required by the modern build.
 */
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export { pdfjs };

/** Opens a PDF. The bytes are copied because pdf.js transfers (detaches) the buffer to its worker. */
export function openPdf(bytes: Uint8Array) {
  return pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, enableXfa: false }).promise;
}

export type PdfDocument = Awaited<ReturnType<typeof openPdf>>;
