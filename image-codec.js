/**
 * BUM16 - Image Codec Module
 * Downsamples, quantizes (16-color palette with dithering),
 * compresses (RLE vs Raw 4-bit packed), and decodes images.
 */

// Premium retro-modern 16-color palette
const PALETTE = [
  [0, 0, 0],         // 0: Black
  [255, 255, 255],   // 1: White
  [128, 128, 128],   // 2: Gray
  [255, 0, 85],      // 3: Neon Pink/Red
  [0, 255, 204],     // 4: Neon Cyan
  [170, 255, 0],     // 5: Lime Green
  [0, 34, 255],      // 6: Deep Blue
  [255, 170, 0],     // 7: Orange
  [119, 0, 170],     // 8: Purple
  [255, 0, 170],     // 9: Magenta
  [0, 170, 0],       // 10: Dark Green
  [136, 85, 51],     // 11: Brown
  [255, 204, 204],   // 12: Peach/Skin
  [0, 85, 119],      // 13: Dark Teal
  [255, 255, 0],     // 14: Yellow
  [51, 51, 51]       // 15: Dark Gray
];

// Helper to find the closest palette color index
function getClosestColorIndex(r, g, b) {
  let minIndex = 0;
  let minDistance = Infinity;
  for (let i = 0; i < PALETTE.length; i++) {
    const pr = PALETTE[i][0];
    const pg = PALETTE[i][1];
    const pb = PALETTE[i][2];
    // Simple Euclidean distance in RGB space
    const dist = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (dist < minDistance) {
      minDistance = dist;
      minIndex = i;
    }
  }
  return minIndex;
}

/**
 * Compress an HTML5 Image or Canvas to the custom BUM16 byte format.
 * @param {HTMLImageElement|HTMLCanvasElement} sourceImage 
 * @param {number} targetWidth 
 * @param {number} targetHeight 
 * @param {boolean} useDithering 
 * @returns {Uint8Array} Compressed image bytes
 */
function encodeImage(sourceImage, targetWidth, targetHeight, useDithering = true) {
  // Create a temporary canvas to resize the image
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  
  // Draw and resize
  ctx.drawImage(sourceImage, 0, 0, targetWidth, targetHeight);
  const imgData = ctx.getImageData(0, 0, targetWidth, targetHeight);
  const pixels = imgData.data; // RGBA array

  // Copy RGB values into a floating point array for dithering error distribution
  const len = targetWidth * targetHeight;
  const rArr = new Float32Array(len);
  const gArr = new Float32Array(len);
  const bArr = new Float32Array(len);

  for (let i = 0; i < len; i++) {
    rArr[i] = pixels[i * 4];
    gArr[i] = pixels[i * 4 + 1];
    bArr[i] = pixels[i * 4 + 2];
  }

  const paletteIndices = new Uint8Array(len);

  // Apply Floyd-Steinberg dithering or direct quantization
  for (let y = 0; y < targetHeight; y++) {
    for (let x = 0; x < targetWidth; x++) {
      const idx = y * targetWidth + x;
      const r = Math.max(0, Math.min(255, rArr[idx]));
      const g = Math.max(0, Math.min(255, gArr[idx]));
      const b = Math.max(0, Math.min(255, bArr[idx]));

      const colorIdx = getClosestColorIndex(r, g, b);
      paletteIndices[idx] = colorIdx;

      if (useDithering) {
        // Calculate quantization error
        const pr = PALETTE[colorIdx][0];
        const pg = PALETTE[colorIdx][1];
        const pb = PALETTE[colorIdx][2];

        const errR = r - pr;
        const errG = g - pg;
        const errB = b - pb;

        // Distribute error to neighbors
        // Right: (x+1, y)
        if (x + 1 < targetWidth) {
          const nIdx = idx + 1;
          rArr[nIdx] += errR * 7 / 16;
          gArr[nIdx] += errG * 7 / 16;
          bArr[nIdx] += errB * 7 / 16;
        }
        // Bottom-Left: (x-1, y+1)
        if (x - 1 >= 0 && y + 1 < targetHeight) {
          const nIdx = idx - 1 + targetWidth;
          rArr[nIdx] += errR * 3 / 16;
          gArr[nIdx] += errG * 3 / 16;
          bArr[nIdx] += errB * 3 / 16;
        }
        // Bottom: (x, y+1)
        if (y + 1 < targetHeight) {
          const nIdx = idx + targetWidth;
          rArr[nIdx] += errR * 5 / 16;
          gArr[nIdx] += errG * 5 / 16;
          bArr[nIdx] += errB * 5 / 16;
        }
        // Bottom-Right: (x+1, y+1)
        if (x + 1 < targetWidth && y + 1 < targetHeight) {
          const nIdx = idx + 1 + targetWidth;
          rArr[nIdx] += errR * 1 / 16;
          gArr[nIdx] += errG * 1 / 16;
          bArr[nIdx] += errB * 1 / 16;
        }
      }
    }
  }

  // Choose encoding: Raw Packed vs RLE
  // 1. Raw Packed bytes (2 pixels per byte)
  const rawPackedSize = Math.ceil(len / 2);
  const rawPackedData = new Uint8Array(rawPackedSize);
  for (let i = 0; i < len; i += 2) {
    const p1 = paletteIndices[i];
    const p2 = (i + 1 < len) ? paletteIndices[i + 1] : 0;
    rawPackedData[i >> 1] = (p1 & 0x0F) | ((p2 & 0x0F) << 4);
  }

  // 2. RLE compression
  // Each byte: bits 0-3 = color, bits 4-7 = length-1 (0 to 15)
  const rleList = [];
  let currentVal = paletteIndices[0];
  let runLength = 1;

  for (let i = 1; i < len; i++) {
    if (paletteIndices[i] === currentVal && runLength < 16) {
      runLength++;
    } else {
      rleList.push((currentVal & 0x0F) | (((runLength - 1) & 0x0F) << 4));
      currentVal = paletteIndices[i];
      runLength = 1;
    }
  }
  // push final run
  rleList.push((currentVal & 0x0F) | (((runLength - 1) & 0x0F) << 4));
  const rleData = new Uint8Array(rleList);

  // Assemble packet: [Width (1B)] + [Height (1B)] + [Encoding Mode (1B)] + [Data]
  // Encoding Mode: 0 = Raw Packed, 1 = RLE
  const useRle = rleData.length < rawPackedData.length;
  const dataPayload = useRle ? rleData : rawPackedData;
  const finalBytes = new Uint8Array(3 + dataPayload.length);
  
  finalBytes[0] = targetWidth;
  finalBytes[1] = targetHeight;
  finalBytes[2] = useRle ? 1 : 0;
  finalBytes.set(dataPayload, 3);

  return finalBytes;
}

/**
 * Decode BUM16 image bytes and draw on a canvas.
 * @param {Uint8Array} bytes 
 * @param {HTMLCanvasElement} canvas 
 */
function decodeImage(bytes, canvas) {
  if (bytes.length < 3) return false;

  const width = bytes[0];
  const height = bytes[1];
  const mode = bytes[2];
  const payload = bytes.subarray(3);

  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(width, height);
  const pixels = imgData.data;

  const totalPixels = width * height;
  const paletteIndices = new Uint8Array(totalPixels);

  if (mode === 0) {
    // Raw Packed (4-bit per pixel)
    for (let i = 0; i < payload.length; i++) {
      const byteVal = payload[i];
      const p1 = byteVal & 0x0F;
      const p2 = (byteVal >> 4) & 0x0F;
      if (i * 2 < totalPixels) paletteIndices[i * 2] = p1;
      if (i * 2 + 1 < totalPixels) paletteIndices[i * 2 + 1] = p2;
    }
  } else if (mode === 1) {
    // RLE Decoded
    let writeIdx = 0;
    for (let i = 0; i < payload.length; i++) {
      const byteVal = payload[i];
      const color = byteVal & 0x0F;
      const runLength = ((byteVal >> 4) & 0x0F) + 1;
      for (let r = 0; r < runLength; r++) {
        if (writeIdx < totalPixels) {
          paletteIndices[writeIdx++] = color;
        }
      }
    }
  } else {
    return false; // Unknown encoding mode
  }

  // Draw palette indices to canvas pixels
  for (let i = 0; i < totalPixels; i++) {
    const colorIdx = paletteIndices[i];
    const rgb = PALETTE[colorIdx];
    pixels[i * 4] = rgb[0];
    pixels[i * 4 + 1] = rgb[1];
    pixels[i * 4 + 2] = rgb[2];
    pixels[i * 4 + 3] = 255; // Alpha full
  }

  ctx.putImageData(imgData, 0, 0);
  return true;
}

// Export functions to window scope
window.BUM16_ImageCodec = {
  PALETTE,
  encodeImage,
  decodeImage
};
