import { Texture } from "../drawing";

const headerDecoder = new TextDecoder("ascii");
const rgbeScales = new Float32Array(256);

for (let exponent = 1; exponent < rgbeScales.length; exponent++) {
  rgbeScales[exponent] = 2 ** (exponent - 136);
}

const readAsciiLine = (bytes: Uint8Array, offset: number) => {
  let end = offset;
  while (end < bytes.length && bytes[end] !== 0x0a) {
    end++;
  }

  if (end >= bytes.length) {
    throw new Error("Unexpected end of HDR header");
  }

  let line = headerDecoder.decode(bytes.subarray(offset, end));
  if (line.endsWith("\r")) {
    line = line.slice(0, -1);
  }

  return {
    line,
    nextOffset: end + 1,
  };
};

const decodeRleScanline = (
  bytes: Uint8Array,
  offset: number,
  width: number,
) => {
  if (
    width < 8 ||
    width > 0x7fff ||
    bytes[offset] !== 2 ||
    bytes[offset + 1] !== 2 ||
    (bytes[offset + 2] & 0x80) !== 0
  ) {
    throw new Error("Unsupported HDR encoding: expected modern RGBE RLE");
  }

  const scanlineWidth = (bytes[offset + 2] << 8) | bytes[offset + 3];
  if (scanlineWidth !== width) {
    throw new Error(
      `Invalid HDR scanline width: expected ${width}, got ${scanlineWidth}`,
    );
  }

  offset += 4;
  const scanline = new Uint8Array(width * 4);

  for (let channel = 0; channel < 4; channel++) {
    let x = 0;
    while (x < width) {
      const count = bytes[offset++];
      if (count === 0) {
        throw new Error("Invalid HDR RLE run length");
      }

      if (count > 128) {
        const runLength = count - 128;
        const value = bytes[offset++];
        for (let i = 0; i < runLength; i++) {
          scanline[(x++ * 4) + channel] = value;
        }
        continue;
      }

      for (let i = 0; i < count; i++) {
        scanline[(x++ * 4) + channel] = bytes[offset++];
      }
    }
  }

  return { scanline, nextOffset: offset };
};

export const loadHdrTexture = async (imageURL: string) => {
  const response = await fetch(imageURL);
  if (!response.ok) {
    throw new Error(
      `Failed to load HDR environment: ${imageURL} (${response.status} ${response.statusText})`,
    );
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  let offset = 0;

  const signature = readAsciiLine(bytes, offset);
  offset = signature.nextOffset;
  if (signature.line !== "#?RADIANCE" && signature.line !== "#?RGBE") {
    throw new Error(`Unsupported HDR signature: ${signature.line}`);
  }

  let format = "";
  while (offset < bytes.length) {
    const { line, nextOffset } = readAsciiLine(bytes, offset);
    offset = nextOffset;

    if (!line) {
      break;
    }

    if (line.startsWith("FORMAT=")) {
      format = line.slice("FORMAT=".length);
    }
  }

  if (format !== "32-bit_rle_rgbe") {
    throw new Error(`Unsupported HDR format: ${format || "unknown"}`);
  }

  const resolution = readAsciiLine(bytes, offset);
  offset = resolution.nextOffset;
  const match = resolution.line.match(/^-Y\s+(\d+)\s+\+X\s+(\d+)$/);
  if (!match) {
    throw new Error(`Unsupported HDR resolution line: ${resolution.line}`);
  }

  const height = Number(match[1]);
  const width = Number(match[2]);
  const data = new Float32Array(width * height * 3);

  for (let y = 0; y < height; y++) {
    const decoded = decodeRleScanline(bytes, offset, width);
    offset = decoded.nextOffset;

    for (let x = 0; x < width; x++) {
      const scanlineBase = x * 4;
      const exponent = decoded.scanline[scanlineBase + 3];
      const outputBase = (y * width + x) * 3;
      const scale = rgbeScales[exponent];

      if (scale === 0) {
        data[outputBase] = 0;
        data[outputBase + 1] = 0;
        data[outputBase + 2] = 0;
        continue;
      }

      data[outputBase] = decoded.scanline[scanlineBase] * scale;
      data[outputBase + 1] = decoded.scanline[scanlineBase + 1] * scale;
      data[outputBase + 2] = decoded.scanline[scanlineBase + 2] * scale;
    }
  }

  return new Texture(data, width, height);
};
