export async function extractText(buffer, mimeType) {
  if (mimeType === 'application/pdf') {
    try {
      // pdf-parse exports PDFParse as a named export
      const pdfModule = await import('pdf-parse');
      const PDFParse = pdfModule.PDFParse;

      if (!PDFParse || typeof PDFParse !== 'function') {
        throw new Error(`PDFParse not found or not a function: ${typeof PDFParse}`);
      }

      // PDFParse is a class, instantiate and await the promise
      const parser = new PDFParse(buffer);
      const data = await parser;

      if (!data || typeof data.text !== 'string' || data.text.trim().length === 0) {
        throw new Error(`Invalid PDF data: no text content extracted`);
      }

      return data.text;
    } catch (err) {
      throw new Error(`PDF parsing failed: ${err.message}`);
    }
  }
  if (mimeType === 'text/plain') {
    try {
      const text = buffer.toString('utf-8');
      if (!text || text.trim().length === 0) {
        throw new Error('Text file is empty');
      }
      return text;
    } catch (err) {
      throw new Error(`Text extraction failed: ${err.message}`);
    }
  }
  throw new Error(`Unsupported file type: ${mimeType}`);
}
