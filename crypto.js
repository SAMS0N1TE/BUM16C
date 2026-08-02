/**
 * BUM16 - Cryptography Module
 * Pure JS SHA-256 and Counter (CTR) mode stream cipher.
 * Works 100% offline and in non-secure (file://) contexts.
 */

function sha256(buffer) {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49ec543, 0xfc0802c1, 0x1c10d8fe, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  let H = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ];

  const len = buffer.length;
  const bitLen = len * 8;
  const padLen = (len % 64 < 56) ? (64 - (len % 64)) : (128 - (len % 64));
  const padded = new Uint8Array(len + padLen);
  padded.set(buffer);
  padded[len] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 4, bitLen, false);

  const W = new Uint32Array(64);
  for (let chunk = 0; chunk < padded.length; chunk += 64) {
    for (let t = 0; t < 16; t++) {
      W[t] = view.getUint32(chunk + t * 4, false);
    }
    for (let t = 16; t < 64; t++) {
      const s0 = rightRotate(W[t - 15], 7) ^ rightRotate(W[t - 15], 18) ^ (W[t - 15] >>> 3);
      const s1 = rightRotate(W[t - 2], 17) ^ rightRotate(W[t - 2], 19) ^ (W[t - 2] >>> 10);
      W[t] = (W[t - 16] + s0 + W[t - 7] + s1) | 0;
    }

    let [a, b, c, d, e, f, g, h] = H;

    for (let t = 0; t < 64; t++) {
      const S1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[t] + W[t]) | 0;
      const S0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }

    H[0] = (H[0] + a) | 0;
    H[1] = (H[1] + b) | 0;
    H[2] = (H[2] + c) | 0;
    H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0;
    H[5] = (H[5] + f) | 0;
    H[6] = (H[6] + g) | 0;
    H[7] = (H[7] + h) | 0;
  }

  const hashBytes = new Uint8Array(32);
  const hashView = new DataView(hashBytes.buffer);
  for (let i = 0; i < 8; i++) {
    hashView.setUint32(i * 4, H[i], false);
  }
  return hashBytes;

  function rightRotate(v, n) {
    return (v >>> n) | (v << (32 - n));
  }
}

/**
 * Encrypt data using a password
 * @param {Uint8Array} data 
 * @param {string} password 
 * @returns {Uint8Array} salt (8 bytes) + ciphertext
 */
function encrypt(data, password) {
  const encoder = new TextEncoder();
  const passwordBytes = encoder.encode(password);
  const key = sha256(passwordBytes);

  const salt = new Uint8Array(8);
  for (let i = 0; i < 8; i++) {
    salt[i] = Math.floor(Math.random() * 256);
  }

  const encrypted = new Uint8Array(data.length);
  const blockSize = 32;

  for (let offset = 0; offset < data.length; offset += blockSize) {
    const chunkLen = Math.min(blockSize, data.length - offset);
    const blockIndex = Math.floor(offset / blockSize);

    const counterBlock = new Uint8Array(12);
    counterBlock.set(salt, 0);
    const view = new DataView(counterBlock.buffer);
    view.setUint32(8, blockIndex, false);

    const hashInput = new Uint8Array(key.length + counterBlock.length);
    hashInput.set(key, 0);
    hashInput.set(counterBlock, key.length);

    const keystream = sha256(hashInput);

    for (let i = 0; i < chunkLen; i++) {
      encrypted[offset + i] = data[offset + i] ^ keystream[i];
    }
  }

  const result = new Uint8Array(salt.length + encrypted.length);
  result.set(salt, 0);
  result.set(encrypted, salt.length);
  return result;
}

/**
 * Decrypt data using a password
 * @param {Uint8Array} ciphertext 
 * @param {string} password 
 * @returns {Uint8Array|null} decrypted data
 */
function decrypt(ciphertext, password) {
  if (ciphertext.length < 8) return null;

  const salt = ciphertext.subarray(0, 8);
  const encrypted = ciphertext.subarray(8);

  const encoder = new TextEncoder();
  const passwordBytes = encoder.encode(password);
  const key = sha256(passwordBytes);

  const decrypted = new Uint8Array(encrypted.length);
  const blockSize = 32;

  for (let offset = 0; offset < encrypted.length; offset += blockSize) {
    const chunkLen = Math.min(blockSize, encrypted.length - offset);
    const blockIndex = Math.floor(offset / blockSize);

    const counterBlock = new Uint8Array(12);
    counterBlock.set(salt, 0);
    const view = new DataView(counterBlock.buffer);
    view.setUint32(8, blockIndex, false);

    const hashInput = new Uint8Array(key.length + counterBlock.length);
    hashInput.set(key, 0);
    hashInput.set(counterBlock, key.length);

    const keystream = sha256(hashInput);

    for (let i = 0; i < chunkLen; i++) {
      decrypted[offset + i] = encrypted[offset + i] ^ keystream[i];
    }
  }

  return decrypted;
}

// Export functions to window scope for easy global access
window.BUM16_Crypto = {
  sha256,
  encrypt,
  decrypt
};
