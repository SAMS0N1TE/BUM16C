/**
 * BUM16 - Ultrasonic Audio Modem Engine
 * Handles multi-protocol modulation, WAV generation, Goertzel filtering,
 * and multi-frequency sync auto-detection.
 */

// CRC32 implementation for packet integrity verification
const CRC32_TABLE = new Int32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
  }
  CRC32_TABLE[i] = c;
}

function crc32(data) {
  let crc = 0 ^ -1;
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ data[i]) & 0xFF];
  }
  return (crc ^ -1) >>> 0;
}

// Modem configuration constants
const F_BASE = 16500;      // Hz (Start frequency)
const F_STEP = 150;        // Hz (Spacing between bins)

// Synchronization carrier frequencies per protocol
const F_SYNC_STD = 19000;  // Hz (Sync for Standard 16-FSK)
const F_SYNC_PAR = 19150;  // Hz (Sync for Parallel FSK)
const F_SYNC_FEC = 19300;  // Hz (Sync for FEC Robust)

class BUM16_Modem {
  constructor(sampleRate = 44100, symbolDuration = 0.08) {
    this.sampleRate = sampleRate;
    this.symbolDuration = symbolDuration;
    this.samplesPerSymbol = Math.round(this.sampleRate * this.symbolDuration);
    
    // Setup Channel A (Primary) Frequencies
    this.freqs = [];
    for (let i = 0; i < 16; i++) {
      this.freqs.push(F_BASE + i * F_STEP);
    }

    // Setup Channel B (Secondary Interleaved) Frequencies
    this.freqsB = [];
    for (let i = 0; i < 16; i++) {
      this.freqsB.push(F_BASE + 75 + i * F_STEP);
    }
    
    // Configurable configuration: 'auto', 'std', 'par', 'fec'
    this.manualProtocol = 'auto';
    this.lockedProtocol = null;

    // Event callbacks
    this.onLog = (msg) => console.log(msg);
    this.onProgress = (pct) => {};
    this.onSuccess = (type, payload) => {};
    this.onFailure = (reason) => {};
    
    // Demodulator state variables
    this.resetDecoderState();
  }

  /**
   * Initialize or update the sample rate and symbol duration.
   */
  updateConfig(sampleRate, symbolDuration) {
    this.sampleRate = sampleRate;
    this.symbolDuration = symbolDuration;
    this.samplesPerSymbol = Math.round(this.sampleRate * this.symbolDuration);
    this.resetDecoderState();
  }

  resetDecoderState() {
    this.state = 'IDLE'; // IDLE, SYNCING, DECODING
    this.ringBuffer = new Float32Array(this.sampleRate * 2); // 2-second ring buffer
    this.ringWriteIdx = 0;
    this.ringReadIdx = 0;
    this.samplesAccumulated = 0;
    
    // Preamble tracking
    this.preambleHistory = []; // Stores alternating f0/f15 matches
    
    // Synchronization
    this.syncSearchStartIdx = 0;
    this.maxSyncEnergy = 0;
    this.maxSyncEnergyIdx = 0;
    this.decodeSampleIdx = 0;
    this.nextDecodeIdx = 0;
    
    // Data Assembly
    this.nibbles = [];
    this.decodedBytes = [];
    this.dataType = null;
    this.expectedLen = null;
    this.expectedCrc = null;

    // FEC soft-decision buffer
    this.fecBuffer = [];
  }

  /**
   * Modulate data into a Float32 waveform
   * @param {Uint8Array} payload 
   * @param {number} type (0 = Text, 1 = Encrypted, 2 = Image)
   * @param {string} protocol ('std', 'par', 'fec')
   * @returns {Float32Array} modulated audio buffer
   */
  modulate(payload, type, protocol = 'std') {
    this.lockedProtocol = protocol;
    const len = payload.length;
    const header = new Uint8Array(7);
    header[0] = type;
    const view = new DataView(header.buffer);
    view.setUint16(1, len, false); // Length (Big-Endian)
    
    const checksum = crc32(payload);
    view.setUint32(3, checksum, false); // CRC32 (Big-Endian)
    
    // Combined packet
    const packet = new Uint8Array(header.length + payload.length);
    packet.set(header, 0);
    packet.set(payload, header.length);
    
    // Determine sync frequency based on protocol
    let syncFreq = F_SYNC_STD;
    if (protocol === 'par') syncFreq = F_SYNC_PAR;
    else if (protocol === 'fec') syncFreq = F_SYNC_FEC;

    // Generate symbol list
    const symbols = [];
    
    // Preamble: 4 symbols alternating F0 and F15 (always on Channel A)
    symbols.push(
      { type: 'single', val: 0 },
      { type: 'single', val: 15 },
      { type: 'single', val: 0 },
      { type: 'single', val: 15 }
    );
    
    // Sync marker symbol
    symbols.push({ type: 'sync' });
    
    if (protocol === 'std') {
      for (let i = 0; i < packet.length; i++) {
        const b = packet[i];
        symbols.push({ type: 'single', val: (b >> 4) & 0x0F });
        symbols.push({ type: 'single', val: b & 0x0F });
      }
    } else if (protocol === 'fec') {
      for (let i = 0; i < packet.length; i++) {
        const b = packet[i];
        const high = (b >> 4) & 0x0F;
        const low = b & 0x0F;
        // FEC: repeat each symbol twice
        symbols.push({ type: 'single', val: high });
        symbols.push({ type: 'single', val: high });
        symbols.push({ type: 'single', val: low });
        symbols.push({ type: 'single', val: low });
      }
    } else if (protocol === 'par') {
      for (let i = 0; i < packet.length; i++) {
        const b = packet[i];
        symbols.push({
          type: 'parallel',
          valA: (b >> 4) & 0x0F,
          valB: b & 0x0F
        });
      }
    }
    
    const totalSamples = symbols.length * this.samplesPerSymbol;
    const audio = new Float32Array(totalSamples);
    
    let phase = 0;
    let phaseB = 0;
    const rampDuration = 0.005; // 5ms cosine window ramp at edges to eliminate clicks
    const rampSamples = Math.round(this.sampleRate * rampDuration);
    
    for (let sIdx = 0; sIdx < symbols.length; sIdx++) {
      const sym = symbols[sIdx];
      const startSample = sIdx * this.samplesPerSymbol;
      
      let freqA = 0;
      let freqB = 0;
      let isParallel = false;
      
      if (sym.type === 'sync') {
        freqA = syncFreq;
      } else if (sym.type === 'single') {
        freqA = this.freqs[sym.val];
      } else if (sym.type === 'parallel') {
        freqA = this.freqs[sym.valA];
        freqB = this.freqsB[sym.valB];
        isParallel = true;
      }
      
      for (let i = 0; i < this.samplesPerSymbol; i++) {
        const t = i / this.sampleRate;
        let amplitude = 0.8; // Safe headroom
        
        // Apply raised-cosine (Hanning) envelope taper at boundaries
        if (i < rampSamples) {
          amplitude *= Math.sin((Math.PI * i) / (2 * rampSamples)) ** 2;
        } else if (i > this.samplesPerSymbol - rampSamples) {
          const samplesFromEnd = this.samplesPerSymbol - i;
          amplitude *= Math.sin((Math.PI * samplesFromEnd) / (2 * rampSamples)) ** 2;
        }
        
        if (isParallel) {
          // Split amplitude equally to maintain combined peak <= 0.8
          const sigA = 0.4 * Math.sin(2 * Math.PI * freqA * t + phase);
          const sigB = 0.4 * Math.sin(2 * Math.PI * freqB * t + phaseB);
          audio[startSample + i] = amplitude * (sigA + sigB);
        } else {
          audio[startSample + i] = amplitude * Math.sin(2 * Math.PI * freqA * t + phase);
        }
      }
      
      // Update phase value to maintain continuity
      phase = (phase + 2 * Math.PI * freqA * this.symbolDuration) % (2 * Math.PI);
      if (isParallel) {
        phaseB = (phaseB + 2 * Math.PI * freqB * this.symbolDuration) % (2 * Math.PI);
      }
    }
    
    return audio;
  }

  /**
   * Generate an uncompressed 16-bit Mono PCM WAV file from modulated audio
   */
  generateWav(audio) {
    const buffer = new ArrayBuffer(44 + audio.length * 2);
    const view = new DataView(buffer);
    
    const writeString = (v, offset, str) => {
      for (let i = 0; i < str.length; i++) {
        v.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + audio.length * 2, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // Raw PCM
    view.setUint16(22, 1, true); // Mono
    view.setUint32(24, this.sampleRate, true);
    view.setUint32(28, this.sampleRate * 2, true); // Byte rate
    view.setUint16(32, 2, true); // Block align
    view.setUint16(34, 16, true); // 16-bit
    writeString(view, 36, 'data');
    view.setUint32(40, audio.length * 2, true);
    
    let offset = 44;
    for (let i = 0; i < audio.length; i++, offset += 2) {
      const s = Math.max(-1, Math.min(1, audio[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    
    return new Uint8Array(buffer);
  }

  /**
   * Run Goertzel energy filter on samples for a target frequency
   */
  goertzel(samples, targetFreq) {
    const N = samples.length;
    const omega = (2 * Math.PI * targetFreq) / this.sampleRate;
    const coeff = 2 * Math.cos(omega);
    
    let q0 = 0, q1 = 0, q2 = 0;
    for (let i = 0; i < N; i++) {
      q0 = coeff * q1 - q2 + samples[i];
      q2 = q1;
      q1 = q0;
    }
    
    return q1 * q1 + q2 * q2 - q1 * q2 * coeff;
  }

  /**
   * Process a chunk of live microphone Float32 samples.
   */
  processAudioChunk(chunk) {
    for (let i = 0; i < chunk.length; i++) {
      this.ringBuffer[this.ringWriteIdx] = chunk[i];
      this.ringWriteIdx = (this.ringWriteIdx + 1) % this.ringBuffer.length;
      this.samplesAccumulated++;
    }

    const N = 512;
    const stepSize = 128;
    
    while (this.samplesAccumulated >= N) {
      const analysisSamples = new Float32Array(N);
      let rIdx = this.ringReadIdx;
      for (let i = 0; i < N; i++) {
        analysisSamples[i] = this.ringBuffer[rIdx];
        rIdx = (rIdx + 1) % this.ringBuffer.length;
      }

      this.processAnalysisWindow(analysisSamples);

      this.ringReadIdx = (this.ringReadIdx + stepSize) % this.ringBuffer.length;
      this.samplesAccumulated -= stepSize;
      this.decodeSampleIdx += stepSize;
    }
  }

  /**
   * Process a single analysis window (512 samples)
   */
  processAnalysisWindow(samples) {
    const e0 = this.goertzel(samples, this.freqs[0]);
    const e15 = this.goertzel(samples, this.freqs[15]);
    
    // Sync tones for all protocols
    const eSyncStd = this.goertzel(samples, F_SYNC_STD);
    const eSyncPar = this.goertzel(samples, F_SYNC_PAR);
    const eSyncFec = this.goertzel(samples, F_SYNC_FEC);

    const energies = this.freqs.map(f => this.goertzel(samples, f));
    let maxIdx = 0;
    let maxEnergy = 0;
    for (let i = 0; i < 16; i++) {
      if (energies[i] > maxEnergy) {
        maxEnergy = energies[i];
        maxIdx = i;
      }
    }
    
    let sumRest = 0;
    for (let i = 0; i < 16; i++) {
      if (i !== maxIdx) sumRest += energies[i];
    }
    const avgRest = sumRest / 15;
    const snr = maxEnergy / (avgRest + 1e-9);

    if (this.state === 'IDLE') {
      const isF0 = e0 > e15 * 3 && snr > 4.0;
      const isF15 = e15 > e0 * 3 && snr > 4.0;
      
      if (isF0 || isF15) {
        const currentSymbol = isF0 ? 0 : 15;
        const lastIdx = this.preambleHistory.length - 1;
        
        if (this.preambleHistory.length === 0 || this.preambleHistory[lastIdx].sym !== currentSymbol) {
          this.preambleHistory.push({
            sym: currentSymbol,
            startSample: this.decodeSampleIdx
          });
          
          if (this.preambleHistory.length > 8) {
            this.preambleHistory.shift();
          }

          if (this.preambleHistory.length >= 3) {
            let matches = true;
            for (let i = 1; i < this.preambleHistory.length; i++) {
              if (this.preambleHistory[i].sym === this.preambleHistory[i - 1].sym) {
                matches = false;
              }
            }
            if (matches) {
              this.state = 'SYNCING';
              this.onLog(`[PREAMBLE] Locked alternating carriers. Searching sync boundary...`);
              this.syncSearchStartIdx = this.decodeSampleIdx;
              this.maxSyncEnergy = 0;
              this.maxSyncEnergyIdx = 0;
              this.lockedProtocol = null;
            }
          }
        }
      }
    } else if (this.state === 'SYNCING') {
      // Determine which sync frequencies we are listening to
      let checkStd = false;
      let checkPar = false;
      let checkFec = false;

      if (this.manualProtocol === 'std') checkStd = true;
      else if (this.manualProtocol === 'par') checkPar = true;
      else if (this.manualProtocol === 'fec') checkFec = true;
      else {
        // Auto-detect mode: listen for any sync tone
        checkStd = true;
        checkPar = true;
        checkFec = true;
      }

      let maxSyncThisWindow = 0;
      let selectedProt = null;

      if (checkStd && eSyncStd > maxSyncThisWindow) {
        maxSyncThisWindow = eSyncStd;
        selectedProt = 'std';
      }
      if (checkPar && eSyncPar > maxSyncThisWindow) {
        maxSyncThisWindow = eSyncPar;
        selectedProt = 'par';
      }
      if (checkFec && eSyncFec > maxSyncThisWindow) {
        maxSyncThisWindow = eSyncFec;
        selectedProt = 'fec';
      }

      const syncSnr = maxSyncThisWindow / (avgRest + 1e-9);
      
      if (maxSyncThisWindow > this.maxSyncEnergy && syncSnr > 3.0) {
        this.maxSyncEnergy = maxSyncThisWindow;
        this.maxSyncEnergyIdx = this.decodeSampleIdx;
        this.lockedProtocol = selectedProt;
      }

      const samplesWaited = this.decodeSampleIdx - this.syncSearchStartIdx;
      if (samplesWaited > this.samplesPerSymbol * 2.0) {
        if (this.maxSyncEnergy > 0 && this.lockedProtocol) {
          this.state = 'DECODING';
          this.onLog(`[SYNC] Sync tone locked. Protocol auto-detected: ${this.lockedProtocol.toUpperCase()}`);
          
          this.nextDecodeIdx = this.maxSyncEnergyIdx + Math.round(this.samplesPerSymbol * 1.5);
          
          this.nibbles = [];
          this.decodedBytes = [];
          this.dataType = null;
          this.expectedLen = null;
          this.expectedCrc = null;
          this.fecBuffer = [];
        } else {
          this.onLog(`[SYNC] Sync tone detection timed out.`);
          this.resetDecoderState();
        }
      }
    } else if (this.state === 'DECODING') {
      if (this.decodeSampleIdx >= this.nextDecodeIdx) {
        if (this.lockedProtocol === 'std' || this.lockedProtocol === 'fec') {
          // Standard / FEC modes: single tone on Channel A
          let bestNibble = 0;
          let bestEnergy = 0;
          for (let i = 0; i < 16; i++) {
            if (energies[i] > bestEnergy) {
              bestEnergy = energies[i];
              bestNibble = i;
            }
          }
          
          let sumRest = 0;
          for (let i = 0; i < 16; i++) {
            if (i !== bestNibble) sumRest += energies[i];
          }
          const symbolSnr = bestEnergy / (sumRest / 15 + 1e-9);

          if (this.lockedProtocol === 'std') {
            this.nibbles.push(bestNibble);
            this.assembleBytes();
          } else {
            // FEC: combine copy 1 and copy 2 using soft Goertzel SNR
            this.fecBuffer.push({ val: bestNibble, snr: symbolSnr });
            if (this.fecBuffer.length === 2) {
              const resolved = (this.fecBuffer[0].snr >= this.fecBuffer[1].snr) ? this.fecBuffer[0].val : this.fecBuffer[1].val;
              this.fecBuffer = [];
              this.nibbles.push(resolved);
              this.assembleBytes();
            }
          }
        } else if (this.lockedProtocol === 'par') {
          // Parallel mode: 2 channels decoded simultaneously
          // Channel A: energies[0..15]
          let bestA = 0;
          let bestEnergyA = 0;
          for (let i = 0; i < 16; i++) {
            if (energies[i] > bestEnergyA) {
              bestEnergyA = energies[i];
              bestA = i;
            }
          }
          
          // Channel B: energiesB[0..15]
          const energiesB = this.freqsB.map(f => this.goertzel(samples, f));
          let bestB = 0;
          let bestEnergyB = 0;
          for (let i = 0; i < 16; i++) {
            if (energiesB[i] > bestEnergyB) {
              bestEnergyB = energiesB[i];
              bestB = i;
            }
          }
          
          const val = (bestA << 4) | bestB;
          this.decodedBytes.push(val);
          this.parseHeaderAndCheckCompletion();
        }
        
        this.nextDecodeIdx += this.samplesPerSymbol;
      }
    }
  }

  assembleBytes() {
    if (this.nibbles.length % 2 === 0) {
      const highNibble = this.nibbles[this.nibbles.length - 2];
      const lowNibble = this.nibbles[this.nibbles.length - 1];
      const val = (highNibble << 4) | lowNibble;
      this.decodedBytes.push(val);
      this.parseHeaderAndCheckCompletion();
    }
  }

  parseHeaderAndCheckCompletion() {
    if (this.decodedBytes.length === 7 && this.dataType === null) {
      this.dataType = this.decodedBytes[0];
      
      const lenVal = (this.decodedBytes[1] << 8) | this.decodedBytes[2];
      this.expectedLen = lenVal;

      const crcVal = ((this.decodedBytes[3] << 24) | 
                      (this.decodedBytes[4] << 16) | 
                      (this.decodedBytes[5] << 8)  | 
                      this.decodedBytes[6]) >>> 0;
      this.expectedCrc = crcVal;

      this.onLog(`[HEADER] Protocol: ${this.lockedProtocol.toUpperCase()} | Type: ${this.dataType} | Payload: ${this.expectedLen} bytes.`);
      
      if (this.expectedLen <= 0 || this.expectedLen > 4096) {
        this.onLog(`[DECODE ERR] Invalid payload length ${this.expectedLen}. Aborting.`);
        this.onFailure("Invalid header length");
        this.resetDecoderState();
        return;
      }
    }

    if (this.expectedLen !== null) {
      const totalExpectedBytes = 7 + this.expectedLen;
      const progress = Math.min(100, Math.round((this.decodedBytes.length / totalExpectedBytes) * 100));
      this.onProgress(progress);

      if (this.decodedBytes.length >= totalExpectedBytes) {
        const payloadBytes = new Uint8Array(this.decodedBytes.slice(7));
        const computedCrc = crc32(payloadBytes);

        if (computedCrc === this.expectedCrc) {
          this.onLog(`[SUCCESS] Decoded successfully! Checksum OK.`);
          this.onSuccess(this.dataType, payloadBytes);
        } else {
          this.onLog(`[DECODE ERR] Checksum mismatch! Expected ${this.expectedCrc.toString(16)}, got ${computedCrc.toString(16)}.`);
          this.onFailure("Checksum mismatch");
        }
        this.resetDecoderState();
      }
    }
  }

  /**
   * Instantly decodes an entire offline audio buffer (mono samples)
   */
  decodeBuffer(samples, sampleRate) {
    this.updateConfig(sampleRate, this.symbolDuration);
    this.resetDecoderState();
    
    const step = 128;
    for (let offset = 0; offset < samples.length - 512; offset += step) {
      const window = samples.subarray(offset, offset + 512);
      this.processAnalysisWindow(window);
      this.decodeSampleIdx += step;
    }
  }
}

// Export modem class to window
window.BUM16_Modem = BUM16_Modem;
window.BUM16_CRC32 = crc32;
