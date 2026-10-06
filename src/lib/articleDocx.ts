const DOCX_MAX_BYTES = 15 * 1024 * 1024;
const DOCX_MAX_XML_BYTES = 8 * 1024 * 1024;
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
const WORD_NAMESPACE = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const DOCUMENT_XML_PATH = 'word/document.xml';

export class DocxImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocxImportError';
  }
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new DocxImportError('Unsupported browser for compressed DOCX.');
  }
  try {
    const input = new Uint8Array(bytes).buffer as ArrayBuffer;
    const stream = new Blob([input]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > DOCX_MAX_XML_BYTES) {
        await reader.cancel();
        throw new DocxImportError('DOCX article document exceeds the safe size limit.');
      }
      chunks.push(value);
    }
    const output = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
    return output;
  } catch (error) {
    if (error instanceof DocxImportError) throw error;
    throw new DocxImportError('DOCX decompression failed; re-save it.');
  }
}

function findEndOfCentralDirectory(view: DataView): number {
  const minimum = Math.max(0, view.byteLength - 22 - 0xffff);
  for (let offset = view.byteLength - 22; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) !== EOCD_SIGNATURE) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + 22 + commentLength === view.byteLength) return offset;
  }
  throw new DocxImportError('Invalid DOCX archive. Choose a .docx file.');
}

async function readDocumentXml(bytes: Uint8Array, decompressor: (input: Uint8Array) => Promise<Uint8Array>): Promise<string> {
  if (bytes.byteLength > DOCX_MAX_BYTES) throw new DocxImportError('Each DOCX must be 15 MB or smaller.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEndOfCentralDirectory(view);
  const diskNumber = view.getUint16(eocd + 4, true);
  const centralDisk = view.getUint16(eocd + 6, true);
  const entriesOnDisk = view.getUint16(eocd + 8, true);
  const entryCount = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount || entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new DocxImportError('Multi-part and ZIP64 DOCX files are unsupported; re-save as .docx.');
  }
  if (centralOffset + centralSize > eocd || centralOffset > bytes.byteLength) {
    throw new DocxImportError('Incomplete DOCX archive; re-save it.');
  }

  let offset = centralOffset;
  let documentEntry: { flags: number; method: number; compressedSize: number; uncompressedSize: number; localOffset: number } | null = null;
  const decoder = new TextDecoder('utf-8', { fatal: true });

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > bytes.byteLength || view.getUint32(offset, true) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new DocxImportError('Damaged DOCX ZIP directory; re-save it.');
    }
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const diskStart = view.getUint16(offset + 34, true);
    const localOffset = view.getUint32(offset + 42, true);
    const entryEnd = offset + 46 + fileNameLength + extraLength + commentLength;
    if (entryEnd > bytes.byteLength) throw new DocxImportError('Damaged DOCX ZIP directory; re-save it.');
    let name: string;
    try {
      name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + fileNameLength));
    } catch {
      throw new DocxImportError('Invalid ZIP filename in DOCX.');
    }
    if (name === DOCUMENT_XML_PATH) {
      documentEntry = { flags, method, compressedSize, uncompressedSize, localOffset };
      break;
    }
    if (diskStart !== 0) throw new DocxImportError('Multi-part DOCX archives are unsupported.');
    offset = entryEnd;
  }

  if (!documentEntry) throw new DocxImportError('DOCX is missing its main article document.');
  const entry = documentEntry;
  if ((entry.flags & 1) !== 0) throw new DocxImportError('Password-protected DOCX files cannot be imported.');
  if (entry.uncompressedSize > DOCX_MAX_XML_BYTES) throw new DocxImportError('DOCX article document exceeds the safe size limit.');
  if (entry.method !== 0 && entry.method !== 8) throw new DocxImportError('Unsupported DOCX compression method; re-save in Word.');
  if (entry.localOffset + 30 > bytes.byteLength || view.getUint32(entry.localOffset, true) !== LOCAL_FILE_SIGNATURE) {
    throw new DocxImportError('Damaged DOCX article document; re-save it.');
  }

  const localNameLength = view.getUint16(entry.localOffset + 26, true);
  const localExtraLength = view.getUint16(entry.localOffset + 28, true);
  const dataStart = entry.localOffset + 30 + localNameLength + localExtraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > bytes.byteLength || dataStart > dataEnd) throw new DocxImportError('Truncated DOCX article document; re-save it.');
  const compressed = bytes.subarray(dataStart, dataEnd);
  const xmlBytes = entry.method === 0 ? new Uint8Array(compressed) : await decompressor(compressed);
  if (xmlBytes.byteLength > DOCX_MAX_XML_BYTES || xmlBytes.byteLength !== entry.uncompressedSize) {
    throw new DocxImportError('DOCX article document failed its size check.');
  }
  try {
    return decoder.decode(xmlBytes);
  } catch {
    throw new DocxImportError('DOCX article document is not valid UTF-8.');
  }
}

function textInsideParagraph(paragraph: Element): string {
  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ?? '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const element = node as Element;
    if (element.namespaceURI !== WORD_NAMESPACE) return '';
    switch (element.localName) {
      case 't': return element.textContent ?? '';
      case 'tab': return '\t';
      case 'br':
      case 'cr': return '\n';
      case 'noBreakHyphen': return '\u2011';
      case 'softHyphen': return '\u00ad';
      case 'instrText':
      case 'delText': return '';
      default: return Array.from(element.childNodes).map(walk).join('');
    }
  };
  return Array.from(paragraph.childNodes).map(walk).join('');
}

/**
 * Import only visible WordprocessingML text. Whitespace, paragraph boundaries,
 * tabs, line breaks and entity-decoded characters are retained; no prose is
 * trimmed, rewritten, summarized or sent to a model.
 */
export async function extractDocxText(
  source: ArrayBuffer | Uint8Array,
  decompressor: (input: Uint8Array) => Promise<Uint8Array> = inflateRaw,
): Promise<string> {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  const xml = await readDocumentXml(bytes, decompressor);
  if (typeof DOMParser === 'undefined') throw new DocxImportError('Browser XML support is required for DOCX import.');
  const documentXml = new DOMParser().parseFromString(xml, 'application/xml');
  if (documentXml.getElementsByTagName('parsererror').length) throw new DocxImportError('Invalid DOCX article XML; re-save it.');
  const body = documentXml.getElementsByTagNameNS(WORD_NAMESPACE, 'body').item(0);
  if (!body) throw new DocxImportError('DOCX is missing its main article body.');
  if (['ins', 'del', 'moveFrom', 'moveTo'].some(tag => documentXml.getElementsByTagNameNS(WORD_NAMESPACE, tag).length > 0)) {
    throw new DocxImportError('This DOCX contains tracked changes. Review them in Word, then re-upload.');
  }
  const paragraphs = Array.from(body.getElementsByTagNameNS(WORD_NAMESPACE, 'p'));
  if (paragraphs.length === 0) throw new DocxImportError('No article paragraphs found in DOCX.');
  const text = paragraphs.map(textInsideParagraph).join('\n');
  if (!text.trim()) throw new DocxImportError('No article text found in DOCX.');
  if (text.length > 500_000) throw new DocxImportError('Extracted article exceeds the 500,000-character limit.');
  return text;
}

export async function sha256Hex(source: ArrayBuffer | Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new DocxImportError('Secure file checks require HTTPS.');
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  const digestInput = new Uint8Array(bytes).buffer as ArrayBuffer;
  const digest = await crypto.subtle.digest('SHA-256', digestInput);
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}

export const DOCX_IMPORT_LIMITS = Object.freeze({ maxFileBytes: DOCX_MAX_BYTES, maxArticleCharacters: 500_000 });
