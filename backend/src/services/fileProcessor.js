export async function extractText(buffer, mimeType) {
  if (mimeType === 'application/pdf') {
    try {
      // pdf-parse v1 exports a function as default export
      const pdfParseModule = await import('pdf-parse');
      const pdfParse = pdfParseModule.default || pdfParseModule;

      if (typeof pdfParse !== 'function') {
        throw new Error(`pdf-parse not a function: ${typeof pdfParse}`);
      }

      const data = await pdfParse(buffer);

      if (!data || typeof data.text !== 'string') {
        throw new Error('PDF parsing returned no text data');
      }

      const trimmedText = data.text.trim();
      if (trimmedText.length === 0) {
        throw new Error('PDF has no extractable text (may be scanned or encrypted)');
      }

      return trimmedText;
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
