import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const iconDir = resolve(root, "public/icons");
const sizes = [16, 32, 48, 128, 256, 512];

mkdirSync(iconDir, { recursive: true });

for (const size of sizes) {
  writeFileSync(resolve(iconDir, `icon-${size}.png`), createIcon(size));
}

function createIcon(size) {
  const margin = Math.max(1, Math.round(size * 0.09));
  const radius = Math.round(size * 0.18);
  const data = Buffer.alloc((size * 4 + 1) * size);

  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    data[row] = 0;
    for (let x = 0; x < size; x += 1) {
      const pixel = row + 1 + x * 4;
      const color = pixelColor(x, y, size, margin, radius);
      data[pixel] = color[0];
      data[pixel + 1] = color[1];
      data[pixel + 2] = color[2];
      data[pixel + 3] = color[3];
    }
  }

  return encodePng(size, size, data);
}

function pixelColor(x, y, size, margin, radius) {
  if (!insideRoundedRect(x, y, margin, margin, size - margin, size - margin, radius)) {
    return [0, 0, 0, 0];
  }

  const t = y / Math.max(1, size - 1);
  let color = mix([22, 83, 181], [19, 148, 133], t);

  const pageLeft = Math.round(size * 0.28);
  const pageTop = Math.round(size * 0.19);
  const pageRight = Math.round(size * 0.74);
  const pageBottom = Math.round(size * 0.78);
  if (insideRoundedRect(x, y, pageLeft, pageTop, pageRight, pageBottom, Math.round(size * 0.04))) {
    color = [247, 250, 252];
  }

  const foldSize = Math.round(size * 0.15);
  if (
    x >= pageRight - foldSize &&
    x <= pageRight &&
    y >= pageTop &&
    y <= pageTop + foldSize &&
    x + y >= pageRight + pageTop
  ) {
    color = [201, 213, 225];
  }

  const lineLeft = Math.round(size * 0.36);
  const lineRight = Math.round(size * 0.66);
  for (const lineY of [0.39, 0.51, 0.63].map((value) => Math.round(size * value))) {
    if (x >= lineLeft && x <= lineRight && Math.abs(y - lineY) <= Math.max(1, Math.round(size * 0.012))) {
      color = [22, 83, 181];
    }
  }

  const arrowY = Math.round(size * 0.64);
  const arrowCenter = Math.round(size * 0.5);
  const arrowWidth = Math.round(size * 0.18);
  if (
    Math.abs(x - arrowCenter) <= Math.max(1, Math.round(size * 0.018)) &&
    y >= Math.round(size * 0.47) &&
    y <= arrowY
  ) {
    color = [236, 94, 66];
  }
  if (
    y >= arrowY - Math.round(size * 0.08) &&
    y <= arrowY + Math.round(size * 0.02) &&
    Math.abs(x - arrowCenter) <= arrowWidth - Math.abs(y - arrowY) * 2
  ) {
    color = [236, 94, 66];
  }

  return [...color, 255];
}

function insideRoundedRect(x, y, left, top, right, bottom, radius) {
  if (x < left || x > right || y < top || y > bottom) return false;
  const cx = x < left + radius ? left + radius : x > right - radius ? right - radius : x;
  const cy = y < top + radius ? top + radius : y > bottom - radius ? bottom - radius : y;
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

function mix(from, to, t) {
  return from.map((value, index) => Math.round(value + (to[index] - value) * t));
}

function encodePng(width, height, rawData) {
  const chunks = [
    chunk("IHDR", ihdr(width, height)),
    chunk("IDAT", deflateSync(rawData, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ];
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ...chunks]);
}

function ihdr(width, height) {
  const buffer = Buffer.alloc(13);
  buffer.writeUInt32BE(width, 0);
  buffer.writeUInt32BE(height, 4);
  buffer[8] = 8;
  buffer[9] = 6;
  buffer[10] = 0;
  buffer[11] = 0;
  buffer[12] = 0;
  return buffer;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

function crc(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}
