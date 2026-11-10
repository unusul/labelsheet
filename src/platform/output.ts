/**
 * Download / share / print, on the web and inside the Capacitor native shell.
 * Nothing is uploaded: files go only to the local file system or to the OS share sheet.
 */
import { Capacitor } from '@capacitor/core';

export type OutputResult = 'done' | 'cancelled' | 'fallback-download' | 'native-share';

export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function pdfBlob(bytes: Uint8Array): Blob {
  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}

function webDownload(bytes: Uint8Array, fileName: string): void {
  const url = URL.createObjectURL(pdfBlob(bytes));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function nativeWrite(bytes: Uint8Array, fileName: string, toDocuments: boolean): Promise<string> {
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  const res = await Filesystem.writeFile({
    path: fileName,
    data: toBase64(bytes),
    directory: toDocuments ? Directory.Documents : Directory.Cache,
    recursive: true,
  });
  return res.uri;
}

async function nativeShare(bytes: Uint8Array, fileName: string, title: string): Promise<OutputResult> {
  const { Share } = await import('@capacitor/share');
  const uri = await nativeWrite(bytes, fileName, false);
  try {
    await Share.share({ title, files: [uri], dialogTitle: title });
    return 'native-share';
  } catch {
    return 'cancelled';
  }
}

export async function downloadPdf(bytes: Uint8Array, fileName: string): Promise<OutputResult> {
  if (!isNative()) {
    webDownload(bytes, fileName);
    return 'done';
  }
  try {
    await nativeWrite(bytes, fileName, true);
    return 'done';
  } catch {
    // Some Android versions refuse the public Documents folder: let the user pick a target instead.
    return nativeShare(bytes, fileName, fileName);
  }
}

export async function sharePdf(bytes: Uint8Array, fileName: string, title: string): Promise<OutputResult> {
  if (isNative()) return nativeShare(bytes, fileName, title);
  const file = new File([bytes as BlobPart], fileName, { type: 'application/pdf' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return 'done';
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return 'cancelled';
    }
  }
  webDownload(bytes, fileName);
  return 'fallback-download';
}

/**
 * Web: prints the PDF through a hidden iframe (system print dialog, Chrome/Edge/Firefox).
 * Safari and in-app browsers that cannot print a PDF iframe get the PDF in a new tab instead.
 * Native: opens the share sheet, whose "Print" entry hands the PDF to the system print service.
 */
export async function printPdf(bytes: Uint8Array, fileName: string, title: string): Promise<OutputResult> {
  if (isNative()) return nativeShare(bytes, fileName, title);
  const url = URL.createObjectURL(pdfBlob(bytes));
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  if (isSafari) {
    window.open(url, '_blank', 'noopener');
    return 'done';
  }
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  frame.src = url;
  frame.onload = () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } catch {
      window.open(url, '_blank', 'noopener');
    }
  };
  document.body.appendChild(frame);
  setTimeout(() => {
    frame.remove();
    URL.revokeObjectURL(url);
  }, 10 * 60_000);
  return 'done';
}
