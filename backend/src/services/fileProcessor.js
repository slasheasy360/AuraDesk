export async function extractText(buffer, mimeType) {
  if (mimeType === 'application/pdf') {
    try {
      // Import pdf-parse (exports a class that needs 'new')
      const pdfModule = await import('pdf-parse');
      const PDFParse = pdfModule.default || pdfModule;

      // pdf-parse exports a class, so use 'new' to instantiate it
      const parser = new PDFParse(buffer);
      const data = await parser;

      if (!data || !data.text) {
        throw new Error('PDF parsing returned no text data');
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
