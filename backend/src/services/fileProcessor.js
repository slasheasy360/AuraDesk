import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const DOCX_TYPES = [
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
];

const EXCEL_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
];

export async function extractText(buffer, mimeType) {
  if (mimeType === 'application/pdf') {
    try {
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(buffer, { max: 0 });

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
    if (!text || text.trim().length === 0) throw new Error('Text file is empty');
    return text;
  }

  if (DOCX_TYPES.includes(mimeType)) {
    try {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      const text = result.value?.trim();
      if (!text || text.length === 0) throw new Error('Document has no extractable text');
      return text;
    } catch (err) {
      throw new Error(`Word document parsing failed: ${err.message}`);
    }
  }

  if (EXCEL_TYPES.includes(mimeType)) {
    try {
      const XLSX = require('xlsx');
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const parts = [];
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
        if (csv.trim()) parts.push(`[Sheet: ${sheetName}]\n${csv}`);
      }
      const text = parts.join('\n\n').trim();
      if (!text) throw new Error('Spreadsheet has no extractable data');
      return text;
    } catch (err) {
      throw new Error(`Excel parsing failed: ${err.message}`);
    }
  }

  throw new Error(`Unsupported file type: ${mimeType}`);
}
