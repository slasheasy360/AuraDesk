export async function extractText(buffer, mimeType) {
  if (mimeType === 'application/pdf') {
    try {
      // Try importing from the build folder (ESM compatible path)
      let pdfParse;
      try {
        const pdfModule = await import('pdf-parse/lib/pdf.js');
        pdfParse = pdfModule.default || pdfModule;
      } catch {
        // Fallback to main package export
        const pdfModule = await import('pdf-parse');
        pdfParse = pdfModule.default || pdfModule;
      }

      if (!pdfParse || typeof pdfParse !== 'function') {
        throw new Error(`pdf-parse not a function: received ${typeof pdfParse}`);
      }

      const data = await pdfParse(buffer);
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
