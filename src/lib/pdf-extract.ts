// Client-side PDF text extraction. Runs entirely in the browser —
// PDF binary never leaves the client until extracted text is sent to the API.
//
// We load pdfjs as a runtime script (not via bundler import) to avoid
// Next.js/Turbopack interop issues with pdfjs-dist's ESM build.

declare global {
  interface Window {
    // pdfjs attaches itself to globalThis when loaded as a module script
    pdfjsLib?: {
      GlobalWorkerOptions: { workerSrc: string };
      getDocument: (params: { data: ArrayBuffer }) => { promise: Promise<PDFDocument> };
    };
  }
}

interface PDFDocument {
  numPages: number;
  getPage(n: number): Promise<PDFPage>;
}

interface PDFPage {
  getTextContent(): Promise<{ items: Array<{ str?: string }> }>;
}

let loadPromise: Promise<Window['pdfjsLib']> | null = null;

function loadPdfjs(): Promise<Window['pdfjsLib']> {
  if (loadPromise) return loadPromise;
  loadPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('PDF extraction requires a browser environment'));
      return;
    }
    if (window.pdfjsLib) {
      resolve(window.pdfjsLib);
      return;
    }
    // Load via dynamic ESM import — but as a script element, not bundler import
    const script = document.createElement('script');
    script.type = 'module';
    script.textContent = `
      import * as pdfjsLib from '/pdf.min.mjs';
      pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
      window.pdfjsLib = pdfjsLib;
      window.dispatchEvent(new Event('pdfjs-loaded'));
    `;
    window.addEventListener('pdfjs-loaded', () => {
      if (window.pdfjsLib) resolve(window.pdfjsLib);
      else reject(new Error('PDF library failed to load'));
    }, { once: true });
    document.head.appendChild(script);
  });
  return loadPromise;
}

export async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await loadPdfjs();
  if (!pdfjs) throw new Error('PDF library unavailable');

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;

  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => item.str ?? '')
      .filter((s) => s.length > 0)
      .join(' ');
    pages.push(pageText);
  }

  return pages.join('\n\n');
}
