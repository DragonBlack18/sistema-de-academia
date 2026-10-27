import { ApiError } from './security';

type ImageMetadata = { mime: 'image/png' | 'image/jpeg' | 'image/webp'; width: number; height: number };
const invalid = () => new ApiError(415, 'A imagem está incompleta ou possui uma estrutura inválida. Envie um PNG, JPEG ou WebP válido.');
const fourCC = (bytes: Uint8Array, offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  return crc >>> 0;
});
function crc32(bytes: Uint8Array, start: number, end: number) {
  let crc = 0xffffffff;
  for (let index = start; index < end; index++) crc = crcTable[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function dimensions(mime: ImageMetadata['mime'], width: number, height: number): ImageMetadata {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw invalid();
  if (width > 10000 || height > 10000 || width * height > 25_000_000) {
    throw new ApiError(400, 'Use uma imagem com até 10.000 pixels por lado e 25 milhões de pixels no total.');
  }
  return { mime, width, height };
}

function png(bytes: Uint8Array, view: DataView): ImageMetadata {
  if (bytes.length < 45 || view.getUint32(8) !== 13 || fourCC(bytes, 12) !== 'IHDR') throw invalid();
  const metadata = dimensions('image/png', view.getUint32(16), view.getUint32(20));
  const validDepths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
  if (!validDepths[bytes[25]]?.includes(bytes[24]) || bytes[26] !== 0 || bytes[27] !== 0 || bytes[28] > 1) throw invalid();
  let offset = 8;
  let dataBytes = 0;
  let chunks = 0;
  while (offset + 12 <= bytes.length && ++chunks <= 10000) {
    const length = view.getUint32(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) throw invalid();
    const type = fourCC(bytes, offset + 4);
    if (!/^[A-Za-z]{4}$/.test(type) || (type === 'IHDR' && offset !== 8)) throw invalid();
    if (crc32(bytes, offset + 4, end - 4) !== view.getUint32(end - 4)) throw invalid();
    if (type === 'IDAT') dataBytes += length;
    if (type === 'IEND') {
      if (length !== 0 || dataBytes === 0 || end !== bytes.length) throw invalid();
      return metadata;
    }
    offset = end;
  }
  throw invalid();
}

function jpeg(bytes: Uint8Array, view: DataView): ImageMetadata {
  let offset = 2;
  let metadata: ImageMetadata | undefined;
  let scanned = false;
  let segments = 0;
  const frames = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  while (offset < bytes.length && ++segments <= 10000) {
    if (bytes[offset++] !== 0xff) throw invalid();
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9) {
      if (!metadata || !scanned || offset !== bytes.length) throw invalid();
      return metadata;
    }
    if (!marker || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || offset + 2 > bytes.length) throw invalid();
    const length = view.getUint16(offset);
    const end = offset + length;
    if (length < 2 || end > bytes.length) throw invalid();
    if (frames.has(marker)) {
      if (length < 11 || length !== 8 + 3 * bytes[offset + 7]) throw invalid();
      const next = dimensions('image/jpeg', view.getUint16(offset + 5), view.getUint16(offset + 3));
      if (metadata && (metadata.width !== next.width || metadata.height !== next.height)) throw invalid();
      metadata = next;
    }
    offset = end;
    if (marker === 0xda) {
      if (!metadata || length < 8) throw invalid();
      const scanStart = offset;
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) { offset++; continue; }
        const next = bytes[offset + 1];
        if (next === 0 || (next >= 0xd0 && next <= 0xd7)) { offset += 2; continue; }
        if (next === 0xff) { offset++; continue; }
        break;
      }
      if (offset === scanStart) throw invalid();
      scanned = true;
    }
  }
  throw invalid();
}

function webp(bytes: Uint8Array, view: DataView): ImageMetadata {
  if (bytes.length < 26 || view.getUint32(4, true) + 8 !== bytes.length) throw invalid();
  let offset = 12;
  let metadata: ImageMetadata | undefined;
  let image = false;
  let animated = false;
  let chunks = 0;
  const u24 = (at: number) => bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16);
  while (offset + 8 <= bytes.length && ++chunks <= 10000) {
    const type = fourCC(bytes, offset);
    const length = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const end = start + length;
    if (end > bytes.length) throw invalid();
    let frame: ImageMetadata | undefined;
    if (type === 'VP8X') {
      if (metadata || offset !== 12 || length !== 10) throw invalid();
      metadata = dimensions('image/webp', u24(start + 4) + 1, u24(start + 7) + 1);
      animated = Boolean(bytes[start] & 2);
    } else if (type === 'VP8 ') {
      if (length < 10 || (bytes[start] & 1) || bytes[start + 3] !== 0x9d || bytes[start + 4] !== 1 || bytes[start + 5] !== 0x2a) throw invalid();
      frame = dimensions('image/webp', view.getUint16(start + 6, true) & 0x3fff, view.getUint16(start + 8, true) & 0x3fff);
      image = true;
    } else if (type === 'VP8L') {
      if (length < 5 || bytes[start] !== 0x2f) throw invalid();
      const bits = view.getUint32(start + 1, true);
      if (bits >>> 29) throw invalid();
      frame = dimensions('image/webp', (bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
      image = true;
    } else if (type === 'ANMF') {
      if (!animated || !metadata || length < 32) throw invalid();
      const frameWidth = u24(start + 6) + 1, frameHeight = u24(start + 9) + 1;
      if (u24(start) * 2 + frameWidth > metadata.width || u24(start + 3) * 2 + frameHeight > metadata.height) throw invalid();
      image = true;
    }
    if (frame) {
      if (metadata && (metadata.width !== frame.width || metadata.height !== frame.height)) throw invalid();
      metadata ??= frame;
    }
    offset = end + (length & 1);
  }
  if (!metadata || !image || offset !== bytes.length) throw invalid();
  return metadata;
}

/** Bounded structural/header validation, not a pixel decoder or antivirus scan. */
export function inspectImage(bytes: Uint8Array, claimedMime: string): ImageMetadata {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let metadata: ImageMetadata;
  if (bytes.length >= 8 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a) metadata = png(bytes, view);
  else if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) metadata = jpeg(bytes, view);
  else if (bytes.length >= 12 && fourCC(bytes, 0) === 'RIFF' && fourCC(bytes, 8) === 'WEBP') metadata = webp(bytes, view);
  else throw invalid();
  if (metadata.mime !== claimedMime) throw new ApiError(415, 'O tipo informado não corresponde ao conteúdo da imagem. SVG e outros formatos não são aceitos.');
  return metadata;
}
