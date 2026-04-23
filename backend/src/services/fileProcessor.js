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

      // Log what we got
      console.log('[PDF] Parsed data keys:', Object.keys(data || {}));
      console.log('[PDF] Text type:', typeof data?.text, 'Length:', data?.text?.length);

      if (!data) {
        throw new Error('No data returned from PDF parser');
      }

      if (!data.text || typeof data.text !== 'string') {
        throw new Error(`PDF text property invalid: type=${typeof data.text}`);
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
