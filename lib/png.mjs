import { inflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CHANNELS_BY_COLOR_TYPE = new Map([
  [0, 1],
  [2, 3],
  [3, 1],
  [4, 2],
  [6, 4],
]);
const MAX_PIXELS = 40_000_000;

export function inspectPng(value) {
  const bytes = Buffer.from(value);
  if (bytes.length < PNG_SIGNATURE.length || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('Screenshot response is not a PNG file.');
  }

  let offset = PNG_SIGNATURE.length;
  let header;
  let sawImageData = false;
  let sawEnd = false;
  const imageData = [];

  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) {
      throw new Error('Screenshot PNG ends inside a chunk header.');
    }

    const length = bytes.readUInt32BE(offset);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > bytes.length) {
      throw new Error('Screenshot PNG contains a truncated chunk.');
    }

    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    const type = typeBytes.toString('ascii');
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    const expectedCrc = bytes.readUInt32BE(offset + 8 + length);
    const actualCrc = crc32(Buffer.concat([typeBytes, data]));
    if (actualCrc !== expectedCrc) {
      throw new Error(`Screenshot PNG has an invalid ${type} checksum.`);
    }

    if (!header) {
      if (type !== 'IHDR' || length !== 13) {
        throw new Error('Screenshot PNG does not start with a valid IHDR chunk.');
      }
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12],
      };
      validateHeader(header);
    } else if (type === 'IHDR') {
      throw new Error('Screenshot PNG contains more than one IHDR chunk.');
    }

    if (type === 'IDAT') {
      sawImageData = true;
      imageData.push(data);
    }
    if (type === 'IEND') {
      if (length !== 0) throw new Error('Screenshot PNG has an invalid IEND chunk.');
      sawEnd = true;
      offset = chunkEnd;
      break;
    }
    offset = chunkEnd;
  }

  if (!header || !sawImageData || !sawEnd) {
    throw new Error('Screenshot PNG is missing required image chunks.');
  }
  if (offset !== bytes.length) {
    throw new Error('Screenshot PNG contains data after IEND.');
  }

  const pixels = decodePixels(header, imageData);
  if (isUniform(pixels, CHANNELS_BY_COLOR_TYPE.get(header.colorType))) {
    throw new Error('Screenshot PNG is blank (every pixel has the same value).');
  }

  return { width: header.width, height: header.height };
}

function validateHeader(header) {
  if (header.width < 1 || header.height < 1) {
    throw new Error('Screenshot PNG has invalid dimensions.');
  }
  if (header.width > 16_384 || header.height > 16_384) {
    throw new Error('Screenshot PNG dimensions exceed the validation limit.');
  }
  if (header.width * header.height > MAX_PIXELS) {
    throw new Error('Screenshot PNG pixel count exceeds the validation limit.');
  }
  if (header.bitDepth !== 8 || !CHANNELS_BY_COLOR_TYPE.has(header.colorType)) {
    throw new Error(
      `Screenshot PNG uses unsupported bit depth/color type ${header.bitDepth}/${header.colorType}.`,
    );
  }
  if (header.compression !== 0 || header.filter !== 0 || header.interlace !== 0) {
    throw new Error('Screenshot PNG uses an unsupported compression, filter, or interlace method.');
  }
}

function decodePixels(header, chunks) {
  let inflated;
  try {
    const channels = CHANNELS_BY_COLOR_TYPE.get(header.colorType);
    const expectedSize = (header.width * channels + 1) * header.height;
    inflated = inflateSync(Buffer.concat(chunks), { maxOutputLength: expectedSize });
  } catch (error) {
    throw new Error('Screenshot PNG image data could not be decompressed.', { cause: error });
  }

  const channels = CHANNELS_BY_COLOR_TYPE.get(header.colorType);
  const rowBytes = header.width * channels;
  const expectedSize = (rowBytes + 1) * header.height;
  if (inflated.length !== expectedSize) {
    throw new Error('Screenshot PNG image data has an unexpected size.');
  }

  const pixels = Buffer.alloc(rowBytes * header.height);
  for (let row = 0; row < header.height; row += 1) {
    const sourceOffset = row * (rowBytes + 1);
    const targetOffset = row * rowBytes;
    const filter = inflated[sourceOffset];
    if (filter > 4) throw new Error(`Screenshot PNG uses invalid row filter ${filter}.`);

    for (let column = 0; column < rowBytes; column += 1) {
      const raw = inflated[sourceOffset + 1 + column];
      const left = column >= channels ? pixels[targetOffset + column - channels] : 0;
      const up = row > 0 ? pixels[targetOffset - rowBytes + column] : 0;
      const upperLeft = row > 0 && column >= channels
        ? pixels[targetOffset - rowBytes + column - channels]
        : 0;
      pixels[targetOffset + column] = unfilter(filter, raw, left, up, upperLeft);
    }
  }
  return pixels;
}

function unfilter(filter, raw, left, up, upperLeft) {
  if (filter === 0) return raw;
  if (filter === 1) return (raw + left) & 0xff;
  if (filter === 2) return (raw + up) & 0xff;
  if (filter === 3) return (raw + Math.floor((left + up) / 2)) & 0xff;
  return (raw + paeth(left, up, upperLeft)) & 0xff;
}

function paeth(left, up, upperLeft) {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  return upDistance <= upperLeftDistance ? up : upperLeft;
}

function isUniform(pixels, channels) {
  for (let offset = channels; offset < pixels.length; offset += channels) {
    for (let channel = 0; channel < channels; channel += 1) {
      if (pixels[offset + channel] !== pixels[channel]) return false;
    }
  }
  return true;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
