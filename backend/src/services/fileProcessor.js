export async function extractText(buffer, mimeType) {
  if (mimeType === 'application/pdf') {
    const pdfParse = await import('pdf-parse');
    const data = await pdfParse.default(buffer);
    return data.text;
  }
  if (mimeType === 'text/plain') {
    return buffer.toString('utf-8');
  }
  throw new Error(`Unsupported file type: ${mimeType}`);
}
