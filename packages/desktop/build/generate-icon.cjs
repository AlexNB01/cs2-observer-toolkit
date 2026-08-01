const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

function makePng(size, draw) {
  const width = size, height = size;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = draw(x, y, width, height);
      const off = rowStart + 1 + x * 4;
      raw[off] = r; raw[off + 1] = g; raw[off + 2] = b; raw[off + 3] = a;
    }
  }
  const idatData = zlib.deflateSync(raw, { level: 9 });

  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[n] = c >>> 0;
  }
  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function makeChunk(type, data) {
    const typeBuf = Buffer.from(type, "ascii");
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
  }

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([sig, makeChunk("IHDR", ihdr), makeChunk("IDAT", idatData), makeChunk("IEND", Buffer.alloc(0))]);
}

function draw(x, y, w, h) {
  const cx = w / 2, cy = h / 2;
  const dx = x - cx, dy = y - cy;
  const r = Math.sqrt(dx * dx + dy * dy);
  const outerR = w * 0.48;
  if (r > outerR) return [0, 0, 0, 0];

  const bg = [16, 20, 28, 255];
  const accent = [255, 122, 26, 255];

  const armLen = w * 0.30;
  const gap = w * 0.08;
  const thickness = w * 0.045;
  const onVerticalArm = Math.abs(dx) < thickness && Math.abs(dy) > gap && Math.abs(dy) < gap + armLen;
  const onHorizontalArm = Math.abs(dy) < thickness && Math.abs(dx) > gap && Math.abs(dx) < gap + armLen;
  const onCenterDot = r < thickness * 1.1;

  if (onVerticalArm || onHorizontalArm || onCenterDot) return accent;
  return bg;
}

const outDir = __dirname;
fs.writeFileSync(path.join(outDir, "icon.png"), makePng(256, draw));
fs.writeFileSync(path.join(outDir, "tray-icon.png"), makePng(32, draw));
console.log("wrote icon.png and tray-icon.png to", outDir);
