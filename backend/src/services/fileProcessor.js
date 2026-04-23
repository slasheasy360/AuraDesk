export async function extractText(buffer, mimeType) {
  if (mimeType === 'application/pdf') {
    try {
      // Import pdf-parse - try different export patterns
      const pdfModule = await import('pdf-parse');

      // pdf-parse might export as: default, direct, or as an object with a parse method
      let PDFParse;

      // Try direct import first
      if (typeof pdfModule.default === 'function') {
        PDFParse = pdfModule.default;
      } else if (typeof pdfModule === 'function') {
        PDFParse = pdfModule;
      } else {
        // Log what we got for debugging
        console.error('[PDF] Module keys:', Object.keys(pdfModule));
        console.error('[PDF] Module.default type:', typeof pdfModule.default);

        // Try finding a function in the module
        for (const [key, value] of Object.entries(pdfModule)) {
          if (typeof value === 'function') {
            console.log(`[PDF] Found function at key: ${key}`);
            PDFParse = value;
            break;
          }
        }
      }

      if (!PDFParse) {
        throw new Error('Could not find PDF parser function in module');
      }

      // Try to call it - could be a class or function
      let data;
      try {
        // Try as a class first
        data = await new PDFParse(buffer);
      } catch (classErr) {
        // If that fails, try as a function
        try {
          data = await PDFParse(buffer);
        } catch (funcErr) {
          throw new Error(`Failed both as class and function: ${funcErr.message}`);
        }
      }

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
