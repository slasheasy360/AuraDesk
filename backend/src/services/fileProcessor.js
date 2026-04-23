import { createRequire } from 'module';

const require = createRequire(import.meta.url);

export async function extractText(buffer, mimeType) {
  if (mimeType === 'application/pdf') {
    try {
      // Use createRequire for CJS interop — avoids ESM/CJS export format issues
      const pdfParse = require('pdf-parse');

      const data = await pdfParse(buffer, {
        // Suppress errors from individual pages and continue
        max: 0, // parse all pages
      });

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
    const text = buffer.toString('utf-8');
    if (!text || text.trim().length === 0) {
      throw new Error('Text file is empty');
    }
    return text;
  }
  throw new Error(`Unsupported file type: ${mimeType}`);
}
