/// <reference lib="webworker" />
/**
 * pdf-lib worker: keeps the source documents in memory and composes the output PDF off the UI thread.
 *
 * Messages in:  register {sourceId, bytes} | unregister {sourceId} | compose {reqId, request}
 * Messages out: registered {sourceId, encrypted, pageCount} | failed {sourceId|reqId, message} | composed {reqId, bytes}
 */
import { PDFDocument } from 'pdf-lib';
import { composePdf, type ComposeRequest } from '../pdf/compose';

export type ComposeWorkerIn =
  | { type: 'register'; sourceId: string; bytes: ArrayBuffer }
  | { type: 'unregister'; sourceId: string }
  | { type: 'compose'; reqId: number; request: ComposeRequest };

export type ComposeWorkerOut =
  | { type: 'registered'; sourceId: string; encrypted: boolean; pageCount: number }
  | { type: 'failed'; sourceId?: string; reqId?: number; message: string }
  | { type: 'composed'; reqId: number; bytes: ArrayBuffer };

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const sources = new Map<string, Promise<PDFDocument>>();

function post(msg: ComposeWorkerOut, transfer: Transferable[] = []): void {
  ctx.postMessage(msg, transfer);
}

async function register(sourceId: string, bytes: ArrayBuffer): Promise<void> {
  const loading = PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  sources.set(sourceId, loading);
  try {
    const doc = await loading;
    post({ type: 'registered', sourceId, encrypted: doc.isEncrypted, pageCount: doc.getPageCount() });
  } catch (e) {
    sources.delete(sourceId);
    post({ type: 'failed', sourceId, message: String(e) });
  }
}

async function compose(reqId: number, request: ComposeRequest): Promise<void> {
  try {
    const bytes = await composePdf(request, (id) => {
      const doc = sources.get(id);
      if (!doc) throw new Error(`Unknown source ${id}`);
      return doc;
    });
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    post({ type: 'composed', reqId, bytes: buffer }, [buffer]);
  } catch (e) {
    post({ type: 'failed', reqId, message: String(e) });
  }
}

ctx.onmessage = (event: MessageEvent<ComposeWorkerIn>) => {
  const msg = event.data;
  if (msg.type === 'register') void register(msg.sourceId, msg.bytes);
  else if (msg.type === 'unregister') sources.delete(msg.sourceId);
  else void compose(msg.reqId, msg.request);
};
