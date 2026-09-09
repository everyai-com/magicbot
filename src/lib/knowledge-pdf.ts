/** Extract selectable PDF text in a worker; scanned PDFs need OCR first. */
export async function extractPdfText(data: Uint8Array): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const task = pdfjs.getDocument({ data });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > 500) throw new Error("PDF exceeds the 500-page limit. Split it into smaller documents.");
    const pages: string[] = [];
    let length = 0;
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      const text = content.items.map((item) => "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "").join("").trim();
      length += text.length;
      if (length > 700_000) throw new Error("PDF text is too large. Split it into smaller documents.");
      if (text) pages.push(text);
      page.cleanup();
    }
    if (!pages.length) throw new Error("This PDF has no selectable text. Run OCR on the scanned pages before uploading.");
    return pages.join("\n\n");
  } finally {
    await task.destroy();
  }
}
