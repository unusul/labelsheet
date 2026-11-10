/**
 * Thin promise-based client of the two workers (pixel analysis, pdf-lib composition).
 */
import type { BboxWorkerIn, BboxWorkerOut } from '../workers/bbox.worker';
import type { ComposeWorkerIn, ComposeWorkerOut } from '../workers/compose.worker';
import type { ComposeRequest } from './compose';

interface Pending<T> {
  resolve: (v: T) => void;
  reject: (e: Error) => void;
}

export interface SourceInfo {
  encrypted: boolean;
  pageCount: number;
}

export class Engine {
  private readonly bboxWorker = new Worker(new URL('../workers/bbox.worker.ts', import.meta.url), { type: 'module' });
  private readonly composeWorker = new Worker(new URL('../workers/compose.worker.ts', import.meta.url), { type: 'module' });
  private readonly bboxPending = new Map<number, Pending<BboxWorkerOut>>();
  private readonly sourcePending = new Map<string, Pending<SourceInfo>>();
  private readonly composePending = new Map<number, Pending<Uint8Array>>();
  private nextId = 1;

  constructor() {
    this.bboxWorker.onmessage = (e: MessageEvent<BboxWorkerOut>) => {
      this.bboxPending.get(e.data.reqId)?.resolve(e.data);
      this.bboxPending.delete(e.data.reqId);
    };
    this.composeWorker.onmessage = (e: MessageEvent<ComposeWorkerOut>) => this.onComposeMessage(e.data);
  }

  private onComposeMessage(msg: ComposeWorkerOut): void {
    if (msg.type === 'registered') {
      this.sourcePending.get(msg.sourceId)?.resolve({ encrypted: msg.encrypted, pageCount: msg.pageCount });
      this.sourcePending.delete(msg.sourceId);
    } else if (msg.type === 'composed') {
      this.composePending.get(msg.reqId)?.resolve(new Uint8Array(msg.bytes));
      this.composePending.delete(msg.reqId);
    } else if (msg.sourceId !== undefined) {
      this.sourcePending.get(msg.sourceId)?.reject(new Error(msg.message));
      this.sourcePending.delete(msg.sourceId);
    } else if (msg.reqId !== undefined) {
      this.composePending.get(msg.reqId)?.reject(new Error(msg.message));
      this.composePending.delete(msg.reqId);
    }
  }

  /** Analyses an RGBA bitmap; the buffer is transferred to the worker (unusable afterwards). */
  analyzeBitmap(data: ArrayBuffer, width: number, height: number, pxPerPt: number, threshold: number): Promise<BboxWorkerOut> {
    const reqId = this.nextId++;
    const msg: BboxWorkerIn = { reqId, data, width, height, pxPerPt, threshold };
    return new Promise((resolve, reject) => {
      this.bboxPending.set(reqId, { resolve, reject });
      this.bboxWorker.postMessage(msg, [data]);
    });
  }

  /** Hands a source PDF to the composer (the buffer is transferred). */
  registerSource(sourceId: string, bytes: ArrayBuffer): Promise<SourceInfo> {
    const msg: ComposeWorkerIn = { type: 'register', sourceId, bytes };
    return new Promise((resolve, reject) => {
      this.sourcePending.set(sourceId, { resolve, reject });
      this.composeWorker.postMessage(msg, [bytes]);
    });
  }

  unregisterSource(sourceId: string): void {
    const msg: ComposeWorkerIn = { type: 'unregister', sourceId };
    this.composeWorker.postMessage(msg);
  }

  compose(request: ComposeRequest): Promise<Uint8Array> {
    const reqId = this.nextId++;
    const msg: ComposeWorkerIn = { type: 'compose', reqId, request };
    return new Promise((resolve, reject) => {
      this.composePending.set(reqId, { resolve, reject });
      this.composeWorker.postMessage(msg);
    });
  }
}

let engine: Engine | null = null;

export function getEngine(): Engine {
  engine ??= new Engine();
  return engine;
}
