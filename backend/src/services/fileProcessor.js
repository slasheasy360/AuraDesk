import pdfParse from 'pdf-parse/legacy/build/pdf.js';

export async function extractText(buffer, mimeType) {
  if (mimeType === 'application/pdf') {
    const data = await pdfParse(buffer);
    return data.text;
  }
  if (mimeType === 'text/plain') {
    return buffer.toString('utf-8');
  }
  throw new Error(`Unsupported file type: ${mimeType}`);
}
