export async function extractText(buffer, mimeType) {
  if (mimeType === 'application/pdf') {
    try {
      const pdfParse = await import('pdf-parse');
      const parseFunction = pdfParse.default || pdfParse;
      if (typeof parseFunction !== 'function') {
        throw new Error('pdf-parse module does not export a function');
      }
      const data = await parseFunction(buffer);
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
