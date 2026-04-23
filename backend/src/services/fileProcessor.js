export async function extractText(buffer, mimeType) {
  if (mimeType === 'application/pdf') {
    try {
      // Import pdf-parse and handle different export patterns
      const pdfModule = await import('pdf-parse');
      let pdfParse = pdfModule.default || pdfModule;

      // If it's an object, try to find a parsing function
      if (typeof pdfParse !== 'function' && typeof pdfParse === 'object') {
        // Try common function property names
        for (const key of ['parse', 'parsePdf', 'pdf', 'PDFParse']) {
          if (typeof pdfParse[key] === 'function') {
            pdfParse = pdfParse[key];
            break;
          }
        }
      }

      if (typeof pdfParse !== 'function') {
        console.error('pdfParse type:', typeof pdfParse);
        console.error('pdfParse object keys:', Object.keys(pdfParse || {}));
        throw new Error(`pdf-parse: received ${typeof pdfParse}, expected function`);
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
