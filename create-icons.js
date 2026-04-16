const fs = require('fs');
const path = require('path');

// Generate a proper RGBA PNG (required by Tauri for all icons)
// This creates a minimal valid RGBA PNG at a given size
function createRGBAPng(width, height) {
  const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

  function uint32BE(n) {
    const b = Buffer.allocUnsafe(4);
    b.writeUInt32BE(n, 0);
    return b;
  }

  function crc32(data) {
    let crc = 0xFFFFFFFF;
    const table = [];
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[i] = c;
    }
    for (let i = 0; i < data.length; i++) crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function chunk(type, data) {
    const typeBytes = Buffer.from(type, 'ascii');
    const crcData = Buffer.concat([typeBytes, data]);
    const crcVal = crc32(crcData);
    return Buffer.concat([uint32BE(data.length), typeBytes, data, uint32BE(crcVal)]);
  }

  // IHDR: width, height, bitDepth=8, colorType=6 (RGBA)
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type: RGBA
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace

  // IDAT: raw pixel data (zlib compressed)
  // Each row starts with filter byte 0x00, then RGBA pixels
  const rowSize = 1 + width * 4; // filter byte + RGBA pixels
  const raw = Buffer.alloc(height * rowSize, 0);
  for (let y = 0; y < height; y++) {
    const rowStart = y * rowSize;
    raw[rowStart] = 0; // filter type: None
    // Fill with a deep blue color (RGBA: 30, 50, 120, 255)
    for (let x = 0; x < width; x++) {
      const px = rowStart + 1 + x * 4;
      raw[px] = 30;     // R
      raw[px + 1] = 50; // G
      raw[px + 2] = 120; // B
      raw[px + 3] = 255; // A
    }
  }

  // Simple zlib compress using Node's built-in (sync)
  const zlib = require('zlib');
  const compressed = zlib.deflateSync(raw, { level: 9 });

  const ihdrChunk = chunk('IHDR', ihdr);
  const idatChunk = chunk('IDAT', compressed);
  const iendChunk = chunk('IEND', Buffer.alloc(0));

  return Buffer.concat([PNG_HEADER, ihdrChunk, idatChunk, iendChunk]);
}

// Simple ICO generator with 1x1 RGBA pixel
function createIco() {
  // Minimal ICO with one 1x1 icon
  return Buffer.from([
    0x00, 0x00,             // Reserved
    0x01, 0x00,             // Type: ICO
    0x01, 0x00,             // Image count: 1
    0x01,                   // Width: 1
    0x01,                   // Height: 1
    0x00,                   // Color count
    0x00,                   // Reserved
    0x01, 0x00,             // Planes
    0x20, 0x00,             // Bit count: 32
    0x28, 0x00, 0x00, 0x00, // Size of image data
    0x16, 0x00, 0x00, 0x00, // Offset: 22
    // BITMAPINFOHEADER
    0x28, 0x00, 0x00, 0x00, // Header size: 40
    0x01, 0x00, 0x00, 0x00, // Width: 1
    0x02, 0x00, 0x00, 0x00, // Height: 2 (XOR + AND)
    0x01, 0x00,             // Planes: 1
    0x20, 0x00,             // Bit count: 32
    0x00, 0x00, 0x00, 0x00, // Compression: none
    0x00, 0x00, 0x00, 0x00, // Image size
    0x00, 0x00, 0x00, 0x00, // X pixels per meter
    0x00, 0x00, 0x00, 0x00, // Y pixels per meter
    0x00, 0x00, 0x00, 0x00, // Colors used
    0x00, 0x00, 0x00, 0x00, // Colors important
    // 1x1 RGBA pixel: B=120, G=50, R=30, A=255
    0x78, 0x32, 0x1E, 0xFF,
    // AND mask (1 byte, padded to 4)
    0x00, 0x00, 0x00, 0x00
  ]);
}

const iconsDir = path.join(__dirname, 'desktop', 'src-tauri', 'icons');
fs.mkdirSync(iconsDir, { recursive: true });

// Generate proper RGBA PNGs at correct sizes
const sizes = [
  { name: '32x32.png', w: 32, h: 32 },
  { name: '128x128.png', w: 128, h: 128 },
  { name: '128x128@2x.png', w: 256, h: 256 },
];

for (const { name, w, h } of sizes) {
  const png = createRGBAPng(w, h);
  fs.writeFileSync(path.join(iconsDir, name), png);
  console.log(`Created RGBA PNG: ${name} (${w}x${h})`);
}

// ICO for Windows
fs.writeFileSync(path.join(iconsDir, 'icon.ico'), createIco());
console.log('Created: icon.ico');

// Minimal ICNS for macOS (just a placeholder header)
const icns = Buffer.from([
  0x69, 0x63, 0x6E, 0x73, // 'icns' magic
  0x00, 0x00, 0x00, 0x14, // Size: 20 bytes
  0x69, 0x63, 0x30, 0x38, // ic08 type (128x128)
  0x00, 0x00, 0x00, 0x0C, // Icon size: 12
  0x89, 0x50, 0x4E, 0x47  // PNG magic (start of embedded PNG)
]);
fs.writeFileSync(path.join(iconsDir, 'icon.icns'), icns);
console.log('Created: icon.icns');

console.log('\n✅ All RGBA icons generated successfully!');
