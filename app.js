/**
 * BUM16 - Benn's Ultrasonic Modem Controller
 * Coordinates UI states, canvas visualizations, file handling, and self-tests.
 */

// App State
let audioContext = null;
let liveModem = null;
let generatedAudioBuffer = null;
let currentMode = 'transmit'; // transmit, receive, settings
let micStream = null;
let micSourceNode = null;
let analyserNode = null;
let audioPlayerSource = null;
let isListening = false;
let isPlayingPreview = false;
let uploadedImageBytes = null; // Uint8Array of compressed image data
let uploadedImageObj = null;   // Original Image object

// Embed Steganography State
let embedBaseAudioBuffer = null;
let mixedAudioBytes = null;
let mixedAudioBuffer = null;
let isPlayingMixedPreview = false;
let mixedSourceNode = null;
let embedVideoFile = null;
let stegoVideoBlobUrl = null;
let stegoVideoExt = 'mp4';
let isRecordingStegoVideo = false;
let stegoVideoRecorder = null;
let stegoVideoChunks = [];

// Tab Audio Capture State
let isCapturingTab = false;
let tabStream = null;
let tabSourceNode = null;

// Video Recorder State
let isRecordingVideo = false;
let videoRecorder = null;
let videoChunks = [];
let recordingCanvas = null;
let recordingCtx = null;
let recordingAnimationId = null;
let generatedVideoBlobUrl = null;
let generatedVideoExt = 'mp4';

// Zoomed Waterfall Spectrograph State
let waterfallAnimationId = null;
let tempCanvas = document.createElement('canvas');
let tempCtx = tempCanvas.getContext('2d');

// Decoded Payload cache (for decryption)
let encryptedPayloadCache = null;

// Initialize app when DOM loads
window.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  setupEventListeners();
  setupTerminal();
  logToTerminal('BUM16 System Initialized.', 'info');
  logToTerminal('Ready for transmission/reception.', 'info');
  
  // Default values
  document.getElementById('symbol-dur-span').textContent = '80ms';
  document.getElementById('vol-span').textContent = '80%';
});

// Setup sidebar tabs switching
function setupTabs() {
  const navItems = document.querySelectorAll('.nav-item');
  const tabs = document.querySelectorAll('.tab-content');

  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const tabId = item.getAttribute('data-tab');
      
      navItems.forEach(nav => nav.classList.remove('active'));
      tabs.forEach(tab => tab.classList.remove('active'));
      
      item.classList.add('active');
      const activeTab = document.getElementById(`${tabId}-tab`);
      if (activeTab) activeTab.classList.add('active');
      
      currentMode = tabId;
      
      // Stop mic when switching away from receive
      if (currentMode !== 'receive' && isListening) {
        toggleMicrophone(false);
      }
      
      // Stop mixed playback when switching tabs
      if (isPlayingMixedPreview) {
        stopMixedPlayback();
      }
    });
  });
}

// Log messages into the scrolling terminal
function logToTerminal(msg, type = 'info') {
  const consoleEl = document.getElementById('terminal-console');
  if (!consoleEl) return;

  const line = document.createElement('div');
  line.className = `terminal-line ${type}`;
  
  const timestamp = new Date().toLocaleTimeString();
  line.textContent = `[${timestamp}] ${msg}`;
  
  consoleEl.appendChild(line);
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

function setupTerminal() {
  const consoleEl = document.getElementById('terminal-console');
  if (consoleEl) consoleEl.innerHTML = '';
}

// Coordinate events
function setupEventListeners() {
  // Transmit inputs toggle
  const txTypeSelect = document.getElementById('tx-type');
  const textGroup = document.getElementById('text-input-group');
  const imageGroup = document.getElementById('image-input-group');
  const encryptToggleGroup = document.getElementById('encrypt-toggle-group');

  txTypeSelect.addEventListener('change', () => {
    const val = txTypeSelect.value;
    if (val === 'text') {
      textGroup.style.display = 'block';
      imageGroup.style.display = 'none';
      encryptToggleGroup.style.display = 'flex';
      document.getElementById('tx-password-group').style.display = 
        document.getElementById('tx-encrypt-chk').checked ? 'block' : 'none';
    } else if (val === 'image') {
      textGroup.style.display = 'none';
      imageGroup.style.display = 'block';
      encryptToggleGroup.style.display = 'none';
      document.getElementById('tx-password-group').style.display = 'none';
    }
  });

  // Encryption Checkbox toggle
  const encryptChk = document.getElementById('tx-encrypt-chk');
  encryptChk.addEventListener('change', () => {
    document.getElementById('tx-password-group').style.display = 
      encryptChk.checked ? 'block' : 'none';
  });

  // Image Upload File Dialog
  const uploadZone = document.getElementById('upload-zone');
  const imageFileInput = document.getElementById('image-file-input');

  uploadZone.addEventListener('click', () => imageFileInput.click());

  uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('dragover');
  });

  uploadZone.addEventListener('dragleave', () => {
    uploadZone.classList.remove('dragover');
  });

  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      handleImageFile(e.dataTransfer.files[0]);
    }
  });

  imageFileInput.addEventListener('change', () => {
    if (imageFileInput.files.length > 0) {
      handleImageFile(imageFileInput.files[0]);
    }
  });

  // Dithering toggle changes image quantization live
  document.getElementById('img-dither-chk').addEventListener('change', () => {
    if (uploadedImageObj) {
      processUploadedImage(uploadedImageObj);
    }
  });

  // Resolution selection changes quantization
  document.getElementById('img-res-select').addEventListener('change', () => {
    if (uploadedImageObj) {
      processUploadedImage(uploadedImageObj);
    }
  });

  // Generate Audio Button
  document.getElementById('btn-generate-audio').addEventListener('click', generateUltrasonicAudio);

  // WAV Download Button
  document.getElementById('btn-download-wav').addEventListener('click', downloadWavFile);

  // Playback Preview Buttons
  document.getElementById('btn-play-preview').addEventListener('click', togglePreviewPlayback);

  // Microphone toggle button
  document.getElementById('btn-mic-toggle').addEventListener('click', () => {
    toggleMicrophone(!isListening);
  });

  // Decoded WAV File Upload Decode
  const wavFileInput = document.getElementById('wav-file-input');
  document.getElementById('btn-upload-wav-decode').addEventListener('click', () => wavFileInput.click());
  wavFileInput.addEventListener('change', handleWavUpload);

  // Decryption Overlay Button
  document.getElementById('btn-decrypt-payload').addEventListener('click', decryptCachedPayload);

  // Settings inputs
  const speedControl = document.getElementById('modem-speed-select');
  const volSlider = document.getElementById('volume-slider');

  speedControl.addEventListener('change', () => {
    const val = speedControl.value;
    let label = '80ms';
    if (val === 'extreme') label = '200ms';
    else if (val === 'slow') label = '120ms';
    else if (val === 'fast') label = '50ms';
    document.getElementById('symbol-dur-span').textContent = label;
  });

  volSlider.addEventListener('input', () => {
    document.getElementById('vol-span').textContent = `${volSlider.value}%`;
  });

  // Settings protocol listeners
  const protocolControl = document.getElementById('modem-protocol-select');
  protocolControl.addEventListener('change', () => {
    const val = protocolControl.value;
    const topVal = document.getElementById('top-protocol-val');
    if (val === 'auto') topVal.textContent = 'AUTO-DETECT';
    else if (val === 'std') topVal.textContent = '16-FSK (MANUAL)';
    else if (val === 'par') topVal.textContent = 'PARALLEL FSK';
    else if (val === 'fec') topVal.textContent = 'FEC ROBUST';
  });

  document.getElementById('btn-protocol-info').addEventListener('click', () => {
    document.getElementById('protocol-modal').style.display = 'flex';
  });

  document.getElementById('btn-close-modal').addEventListener('click', () => {
    document.getElementById('protocol-modal').style.display = 'none';
  });

  // Self Test Button
  document.getElementById('btn-run-selftest').addEventListener('click', runSelfTest);

  // Tab capture and URL decode listeners
  document.getElementById('btn-capture-tab-audio').addEventListener('click', () => {
    toggleTabCapture(!isCapturingTab);
  });
  document.getElementById('btn-url-decode').addEventListener('click', decodeFromUrl);
  document.getElementById('btn-download-video').addEventListener('click', recordVideoFile);
  document.getElementById('btn-download-video-file').addEventListener('click', downloadVideoFile);
  document.getElementById('btn-close-video-preview').addEventListener('click', closeVideoPreview);
  document.getElementById('btn-export-stego-video').addEventListener('click', recordStegoVideoFile);
  document.getElementById('btn-download-stego-video-file').addEventListener('click', downloadStegoVideoFile);
  document.getElementById('btn-close-embed-video-preview').addEventListener('click', closeStegoVideoPreview);

  // Embed Tab Event Listeners
  const embedFileZone = document.getElementById('embed-file-zone');
  const embedFileInput = document.getElementById('embed-file-input');

  embedFileZone.addEventListener('click', () => embedFileInput.click());
  embedFileZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    embedFileZone.classList.add('dragover');
  });
  embedFileZone.addEventListener('dragleave', () => {
    embedFileZone.classList.remove('dragover');
  });
  embedFileZone.addEventListener('drop', (e) => {
    e.preventDefault();
    embedFileZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      handleEmbedFile(e.dataTransfer.files[0]);
    }
  });
  embedFileInput.addEventListener('change', () => {
    if (embedFileInput.files.length > 0) {
      handleEmbedFile(embedFileInput.files[0]);
    }
  });

  document.getElementById('embed-encrypt-chk').addEventListener('change', (e) => {
    document.getElementById('embed-password-group').style.display = 
      e.target.checked ? 'block' : 'none';
  });

  const embedDelaySlider = document.getElementById('embed-delay-slider');
  embedDelaySlider.addEventListener('input', () => {
    document.getElementById('embed-delay-span').textContent = `${embedDelaySlider.value}s`;
  });

  const embedGainSlider = document.getElementById('embed-gain-slider');
  embedGainSlider.addEventListener('input', () => {
    document.getElementById('embed-gain-span').textContent = `${embedGainSlider.value}%`;
  });

  document.getElementById('btn-process-embed').addEventListener('click', processAudioEmbedding);
  document.getElementById('btn-download-embedded-wav').addEventListener('click', downloadEmbeddedWav);
  document.getElementById('btn-play-embedded-audio').addEventListener('click', toggleMixedPlayback);
}

// Handle Image File Input loading
function handleImageFile(file) {
  if (!file.type.match('image/png') && !file.type.match('image/jpeg')) {
    alert('Please upload a valid PNG or JPEG image.');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      uploadedImageObj = img;
      document.getElementById('orig-preview-img').src = e.target.result;
      document.getElementById('orig-preview-img').style.display = 'block';
      processUploadedImage(img);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// Scale, quantize and compress loaded image
function processUploadedImage(img) {
  const res = parseInt(document.getElementById('img-res-select').value);
  const useDither = document.getElementById('img-dither-chk').checked;

  // Run BUM16 encoder
  const compressedBytes = window.BUM16_ImageCodec.encodeImage(img, res, res, useDither);
  uploadedImageBytes = compressedBytes;

  logToTerminal(`Image quantized to ${res}x${res}. Compressed size: ${compressedBytes.length} bytes.`, 'info');

  // Preview decoded image in UI
  const previewCanvas = document.getElementById('quant-preview-canvas');
  previewCanvas.style.display = 'block';
  window.BUM16_ImageCodec.decodeImage(compressedBytes, previewCanvas);
}

// Trigger generation of FSK tones
function generateUltrasonicAudio() {
  const txType = document.getElementById('tx-type').value;
  let rawBytes;
  let actualTypeFlag = 0; // 0=Text, 1=Encrypted, 2=Image

  // Check inputs
  if (txType === 'text') {
    const textVal = document.getElementById('tx-text').value.trim();
    if (!textVal) {
      alert('Please enter some text to transmit.');
      return;
    }

    const encoder = new TextEncoder();
    let bytes = encoder.encode(textVal);

    if (document.getElementById('tx-encrypt-chk').checked) {
      const password = document.getElementById('tx-password').value;
      if (!password) {
        alert('Please enter a password for encryption.');
        return;
      }
      bytes = window.BUM16_Crypto.encrypt(bytes, password);
      actualTypeFlag = 1; // Encrypted text
      logToTerminal(`Text encrypted. Cipher size: ${bytes.length} bytes.`, 'info');
    } else {
      actualTypeFlag = 0; // Plain text
    }
    rawBytes = bytes;
  } else if (txType === 'image') {
    if (!uploadedImageBytes) {
      alert('Please upload an image first.');
      return;
    }
    rawBytes = uploadedImageBytes;
    actualTypeFlag = 2; // Compressed image
  }

  // Set configuration
  const audioRate = 44100;
  const speedSetting = document.getElementById('modem-speed-select').value;
  const symbolDur = speedSetting === 'extreme' ? 0.20 : speedSetting === 'slow' ? 0.12 : speedSetting === 'fast' ? 0.05 : 0.08;

  const protocolSetting = document.getElementById('modem-protocol-select').value;
  const encodeProtocol = (protocolSetting === 'auto') ? 'std' : protocolSetting;

  // Initialize temporary modem
  const tempModem = new window.BUM16_Modem(audioRate, symbolDur);
  logToTerminal(`Generating ultrasonic signal via ${encodeProtocol.toUpperCase()}... Frequencies: 16.5 kHz - 19.0 kHz.`, 'info');

  const float32Audio = tempModem.modulate(rawBytes, actualTypeFlag, encodeProtocol);
  generatedAudioBuffer = float32Audio;

  // Show preview stats
  const totalSeconds = (float32Audio.length / audioRate).toFixed(2);
  document.getElementById('preview-duration').textContent = `${totalSeconds}s`;
  document.getElementById('player-card').style.display = 'block';
  document.getElementById('btn-download-wav').removeAttribute('disabled');
  document.getElementById('btn-play-preview').removeAttribute('disabled');
  document.getElementById('btn-download-video').removeAttribute('disabled');
  
  logToTerminal(`Audio generated successfully. Length: ${totalSeconds} seconds (${float32Audio.length} samples).`, 'success');

  // Draw static waveform visualizer
  drawWaveformPreview(float32Audio);
  
  // Render theoretical spectrogram of generated buffer
  drawGeneratedSpectrogram(float32Audio, audioRate, symbolDur);
}

// Draw time domain waveform on preview canvas
function drawWaveformPreview(audioSamples) {
  const canvas = document.getElementById('waveform-canvas');
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);

  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#ffffff';
  ctx.beginPath();

  const step = Math.ceil(audioSamples.length / w);
  const amp = h / 2;

  for (let i = 0; i < w; i++) {
    let min = 1.0;
    let max = -1.0;
    for (let j = 0; j < step; j++) {
      const idx = i * step + j;
      if (idx < audioSamples.length) {
        const val = audioSamples[idx];
        if (val < min) min = val;
        if (val > max) max = val;
      }
    }
    
    // Draw min-max vertical bar for crisp look
    const y1 = amp + min * amp * 0.9;
    const y2 = amp + max * amp * 0.9;
    ctx.moveTo(i, y1);
    ctx.lineTo(i, y2);
  }
  ctx.stroke();
}

// Generate the WAV buffer and trigger download
function downloadWavFile() {
  if (!generatedAudioBuffer) return;

  const speedSetting = document.getElementById('modem-speed-select').value;
  const symbolDur = speedSetting === 'extreme' ? 0.20 : speedSetting === 'slow' ? 0.12 : speedSetting === 'fast' ? 0.05 : 0.08;
  
  const tempModem = new window.BUM16_Modem(44100, symbolDur);
  const wavBytes = tempModem.generateWav(generatedAudioBuffer);
  
  const blob = new Blob([wavBytes], { type: 'audio/wav' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `bum16_transmission_${Date.now()}.wav`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  logToTerminal('WAV file downloaded successfully.', 'success');
}

// Play/Pause encoded audio preview
function togglePreviewPlayback() {
  if (!generatedAudioBuffer) return;

  if (isPlayingPreview) {
    stopPreviewPlayback();
    return;
  }

  // Start AudioContext if needed
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }

  const volPercent = parseFloat(document.getElementById('volume-slider').value) / 100;

  // Create Buffer Node
  const audioBuffer = audioContext.createBuffer(1, generatedAudioBuffer.length, 44100);
  audioBuffer.copyToChannel(generatedAudioBuffer, 0);

  audioPlayerSource = audioContext.createBufferSource();
  audioPlayerSource.buffer = audioBuffer;

  // Gain/Volume node
  const gainNode = audioContext.createGain();
  gainNode.gain.setValueAtTime(volPercent, audioContext.currentTime);

  // Hook up to analyzer so playing also lights up the spectrograph!
  analyserNode = audioContext.createAnalyser();
  analyserNode.fftSize = 2048;

  audioPlayerSource.connect(gainNode);
  gainNode.connect(analyserNode);
  analyserNode.connect(audioContext.destination);

  audioPlayerSource.onended = () => {
    isPlayingPreview = false;
    document.getElementById('btn-play-preview').innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="#000"><path d="M8 5v14l11-7z"/></svg> Play Preview`;
    stopWaterfallSpectrograph();
  };

  audioPlayerSource.start(0);
  isPlayingPreview = true;
  document.getElementById('btn-play-preview').innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="#000"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg> Stop Playback`;

  logToTerminal('Playing preview at ultrasonic frequencies...', 'info');

  // Start waterfall visualizer
  startWaterfallSpectrograph();
}

function stopPreviewPlayback() {
  if (audioPlayerSource) {
    try {
      audioPlayerSource.stop();
    } catch(e) {}
    audioPlayerSource = null;
  }
  isPlayingPreview = false;
  document.getElementById('btn-play-preview').innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="#000"><path d="M8 5v14l11-7z"/></svg> Play Preview`;
  stopWaterfallSpectrograph();
  logToTerminal('Playback stopped.', 'info');
}

// Toggle Mic Listener
function toggleMicrophone(start) {
  if (start) {
    if (isCapturingTab) {
      toggleTabCapture(false);
    }

    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }

    navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      .then(stream => {
        micStream = stream;
        micSourceNode = audioContext.createMediaStreamSource(stream);
        
        analyserNode = audioContext.createAnalyser();
        analyserNode.fftSize = 2048;
        
        micSourceNode.connect(analyserNode);

        // Initialize Live Modem for real-time decoding
        const speedSetting = document.getElementById('modem-speed-select').value;
        const symbolDur = speedSetting === 'extreme' ? 0.20 : speedSetting === 'slow' ? 0.12 : speedSetting === 'fast' ? 0.05 : 0.08;
        
        liveModem = new window.BUM16_Modem(audioContext.sampleRate, symbolDur);
        liveModem.manualProtocol = document.getElementById('modem-protocol-select').value;
        
        // Connect modem callbacks to UI
        liveModem.onLog = (msg) => logToTerminal(msg, 'info');
        liveModem.onProgress = (pct) => {
          document.getElementById('decode-progress-fill').style.width = `${pct}%`;
          logToTerminal(`Decoding: ${pct}% complete...`, 'info');
        };
        liveModem.onSuccess = handleDecodeSuccess;
        liveModem.onFailure = (reason) => {
          logToTerminal(`Decoding Failed: ${reason}`, 'error');
          updateMicLockIndicator('failed');
          setTimeout(() => updateMicLockIndicator('listening'), 2000);
        };

        isListening = true;
        document.getElementById('btn-mic-toggle').textContent = 'Stop Microphone';
        document.getElementById('btn-mic-toggle').className = 'btn btn-danger';
        document.getElementById('btn-capture-tab-audio').setAttribute('disabled', 'true');
        updateMicLockIndicator('listening');
        logToTerminal(`Microphone active. Sample Rate: ${audioContext.sampleRate} Hz. listening...`, 'success');

        // Start processing audio buffer
        startMicProcessingLoop();

        // Start spectrogram waterfall rendering
        startWaterfallSpectrograph();
      })
      .catch(err => {
        console.error(err);
        alert('Could not access microphone. Please check permissions.');
      });
  } else {
    // Stop mic
    if (micStream) {
      micStream.getTracks().forEach(track => track.stop());
      micStream = null;
    }
    isListening = false;
    document.getElementById('btn-mic-toggle').textContent = 'Start Microphone';
    document.getElementById('btn-mic-toggle').className = 'btn btn-primary';
    document.getElementById('btn-capture-tab-audio').removeAttribute('disabled');
    updateMicLockIndicator('idle');
    stopWaterfallSpectrograph();
    logToTerminal('Microphone deactivated.', 'info');
  }
}

function updateMicLockIndicator(state) {
  const ind = document.getElementById('lock-indicator');
  const val = document.getElementById('lock-status-val');
  
  ind.className = 'indicator';
  if (state === 'idle') {
    val.textContent = 'INACTIVE';
  } else if (state === 'listening') {
    ind.classList.add('pulse-cyan');
    val.textContent = 'LISTENING';
  } else if (state === 'syncing') {
    ind.classList.add('pulse-purple');
    val.textContent = 'SYNC LOCK';
  } else if (state === 'decoding') {
    ind.classList.add('pulse-green');
    val.textContent = 'DECODING';
  } else if (state === 'failed') {
    ind.style.backgroundColor = 'var(--accent-red)';
    ind.style.boxShadow = '0 0 8px var(--accent-red)';
    val.textContent = 'ERR CHECKSUM';
  }
}

// Live mic processing loop
let scriptNode = null;
function startMicProcessingLoop() {
  // We can use a ScriptProcessorNode (standard and compatible) 
  // to pipe mic float data directly to our modem
  const bufferSize = 1024;
  scriptNode = audioContext.createScriptProcessor(bufferSize, 1, 1);
  
  scriptNode.onaudioprocess = (audioProcessingEvent) => {
    if (!isListening) return;
    const inputBuffer = audioProcessingEvent.inputBuffer;
    const samples = inputBuffer.getChannelData(0);
    
    // Pipe to live modem state machine
    liveModem.processAudioChunk(samples);
    
    // Update live signal strength meter
    updateVolumeMeter(samples);

    // Update state indicators based on modem status
    if (liveModem.state === 'IDLE') {
      updateMicLockIndicator('listening');
      const protVal = document.getElementById('modem-protocol-select').value;
      document.getElementById('top-protocol-val').textContent = protVal === 'auto' ? 'AUTO-DETECT' : protVal.toUpperCase();
    } else if (liveModem.state === 'SYNCING') {
      updateMicLockIndicator('syncing');
    } else if (liveModem.state === 'DECODING') {
      updateMicLockIndicator('decoding');
      if (liveModem.lockedProtocol) {
        document.getElementById('top-protocol-val').textContent = liveModem.lockedProtocol.toUpperCase() + ' (LOCKED)';
      }
    }
  };

  analyserNode.connect(scriptNode);
  scriptNode.connect(audioContext.destination);
}

// Simple RMS Volume meter
function updateVolumeMeter(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  const rms = Math.sqrt(sum / samples.length);
  const db = 20 * Math.log10(rms + 1e-9);
  
  // Normalize db from -60..0 to 0..100
  let norm = Math.round(((db + 50) / 50) * 100);
  if (norm < 0) norm = 0;
  if (norm > 100) norm = 100;
  
  document.getElementById('mic-level-fill').style.width = `${norm}%`;
}

// Handle decoding from uploaded audio file
function handleWavUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  logToTerminal(`Loading audio file: ${file.name}...`, 'info');

  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }

  const reader = new FileReader();
  reader.onload = (event) => {
    audioContext.decodeAudioData(event.target.result)
      .then(audioBuffer => {
        logToTerminal(`Audio decoded. Channels: ${audioBuffer.numberOfChannels}, Rate: ${audioBuffer.sampleRate} Hz, Length: ${audioBuffer.duration.toFixed(2)}s.`, 'info');
        
        // Convert stereo/multi-channel to mono
        const samples = audioBuffer.getChannelData(0);
        
        logToTerminal(`Running offline demodulator on file samples...`, 'info');
        
        const speedSetting = document.getElementById('modem-speed-select').value;
        const symbolDur = speedSetting === 'extreme' ? 0.20 : speedSetting === 'slow' ? 0.12 : speedSetting === 'fast' ? 0.05 : 0.08;

        const offlineModem = new window.BUM16_Modem(audioBuffer.sampleRate, symbolDur);
        offlineModem.manualProtocol = document.getElementById('modem-protocol-select').value;
        
        // Attach callbacks
        offlineModem.onLog = (msg) => logToTerminal(msg, 'info');
        offlineModem.onSuccess = handleDecodeSuccess;
        offlineModem.onFailure = (reason) => logToTerminal(`Offline decoding failed: ${reason}`, 'error');
        
        // Run full offline search
        const startTime = performance.now();
        offlineModem.decodeBuffer(samples, audioBuffer.sampleRate);
        const elapsed = (performance.now() - startTime).toFixed(1);
        
        logToTerminal(`Finished offline decoding in ${elapsed} ms.`, 'info');
      })
      .catch(err => {
        console.error(err);
        alert('Could not decode uploaded audio file. Ensure it is a valid WAV or MP3.');
      });
  };
  reader.readAsArrayBuffer(file);
}

// Handle Successful FSK packet decode
function handleDecodeSuccess(type, payload) {
  logToTerminal(`Decoded packet payload of type: ${type}. Size: ${payload.length} bytes.`, 'success');

  const placeholder = document.getElementById('decode-placeholder');
  const resultText = document.getElementById('decode-result-text');
  const resultImg = document.getElementById('decode-result-image');
  const decryptPrompt = document.getElementById('decrypt-prompt');

  // Reset outputs
  placeholder.style.display = 'none';
  resultText.style.display = 'none';
  resultImg.style.display = 'none';
  decryptPrompt.style.display = 'none';

  if (type === 0) {
    // Plain text
    const text = new TextDecoder().decode(payload);
    resultText.textContent = text;
    resultText.style.display = 'block';
  } else if (type === 1) {
    // Encrypted message
    encryptedPayloadCache = payload;
    decryptPrompt.style.display = 'flex';
    document.getElementById('rx-decrypt-password').value = '';
    logToTerminal(`Payload is encrypted. Enter key/password to decrypt.`, 'warn');
  } else if (type === 2) {
    // Image
    resultImg.style.display = 'block';
    const decoded = window.BUM16_ImageCodec.decodeImage(payload, resultImg);
    if (!decoded) {
      logToTerminal(`Failed to reconstruct image. Codec parse error.`, 'error');
      placeholder.style.display = 'flex';
    }
  }
}

// Decrypt cached ciphertext payload
function decryptCachedPayload() {
  if (!encryptedPayloadCache) return;

  const password = document.getElementById('rx-decrypt-password').value;
  if (!password) {
    alert('Please enter a password.');
    return;
  }

  logToTerminal('Decrypting payload...', 'info');
  const decrypted = window.BUM16_Crypto.decrypt(encryptedPayloadCache, password);

  if (decrypted) {
    const text = new TextDecoder().decode(decrypted);
    
    // Simple integrity check: does it look like ASCII printable characters?
    // In CTR mode, wrong password decrypts to absolute noise.
    let isNoise = false;
    let printableCount = 0;
    for (let i = 0; i < Math.min(20, text.length); i++) {
      const code = text.charCodeAt(i);
      if ((code >= 32 && code <= 126) || code === 10 || code === 13 || code === 9) {
        printableCount++;
      }
    }
    if (text.length > 0 && (printableCount / Math.min(20, text.length)) < 0.7) {
      isNoise = true;
    }

    if (isNoise) {
      logToTerminal('Decryption failed! Output contains corrupted data. Check password.', 'error');
      alert('Decryption failed. Invalid password/key.');
      return;
    }

    // Display
    document.getElementById('decrypt-prompt').style.display = 'none';
    const resultText = document.getElementById('decode-result-text');
    resultText.textContent = text;
    resultText.style.display = 'block';
    logToTerminal('Decrypted successfully!', 'success');
  } else {
    logToTerminal('Decryption failed. Invalid password/key.', 'error');
    alert('Decryption failed. Invalid password/key.');
  }
}

// Draw static zoomed-in spectrogram for generated audio
function drawGeneratedSpectrogram(audioSamples, sampleRate, symbolDur) {
  const canvas = document.getElementById('spectrogram-canvas');
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);

  // We will divide the audio buffer into symbol blocks, run Goertzel on each FSK frequency, 
  // and render the visual waterfall offline. This is extremely accurate and beautiful!
  const samplesPerSymbol = Math.round(sampleRate * symbolDur);
  const numSymbols = Math.floor(audioSamples.length / samplesPerSymbol);
  
  const F_base = 16500;
  const F_step = 150;
  const F_sync = 19000;

  // Render vertical timeline (left-to-right representation)
  const colWidth = w / numSymbols;
  
  // We want to draw 17 frequency rows: 16 data channels + 1 sync channel
  const rowHeight = h / 17;

  // Let's create a temporary modem for Goertzel calculations
  const tempModem = new window.BUM16_Modem(sampleRate, symbolDur);

  for (let s = 0; s < numSymbols; s++) {
    const startIdx = s * samplesPerSymbol;
    const symbolWindow = audioSamples.subarray(startIdx, startIdx + samplesPerSymbol);

    // Compute energy for each of the 16 FSK frequencies + sync
    const energies = [];
    for (let i = 0; i < 16; i++) {
      energies.push(tempModem.goertzel(symbolWindow, F_base + i * F_step));
    }
    energies.push(tempModem.goertzel(symbolWindow, F_sync));

    // Find max to normalize colors
    const maxVal = Math.max(...energies) + 1e-9;

    for (let r = 0; r < 17; r++) {
      const normVal = Math.min(1.0, energies[r] / maxVal);
      // Monochrome light-gray/white glow
      const color = `rgba(255, 255, 255, ${normVal})`;
      ctx.fillStyle = color;
      
      // Draw grid cell (note: lower frequencies at bottom, higher at top)
      const x = s * colWidth;
      const y = h - (r + 1) * rowHeight;
      ctx.fillRect(x, y, colWidth - 1, rowHeight - 1);
    }
  }

  // Draw frequency boundary labels
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = '8px monospace';
  ctx.fillText('16.5 kHz', 5, h - 5);
  ctx.fillText('19.0 kHz (Sync)', 5, 12);
}

// Real-time microphone/playback zoomed waterfall spectrograph loop
function startWaterfallSpectrograph() {
  if (waterfallAnimationId) {
    cancelAnimationFrame(waterfallAnimationId);
  }

  const canvas = document.getElementById('spectrogram-canvas');
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  // Reset Canvas
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);

  tempCanvas.width = w;
  tempCanvas.height = h;

  const drawLoop = () => {
    if (!analyserNode) return;

    const bufferLength = analyserNode.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyserNode.getByteFrequencyData(dataArray);

    // Shift canvas down by 2px to create waterfall
    tempCtx.drawImage(canvas, 0, 0);
    ctx.drawImage(tempCanvas, 0, 2);

    // Calculate bin zoom parameters
    const sampleRate = audioContext.sampleRate;
    const binWidth = (sampleRate / 2) / bufferLength;

    // Zoom limits: 16.3 kHz to 19.2 kHz (around our 16.5k-19k band)
    const startBin = Math.floor(16300 / binWidth);
    const endBin = Math.ceil(19200 / binWidth);
    const numBins = endBin - startBin;
    const cellWidth = w / numBins;

    // Render new spectrum line at the very top (y=0)
    for (let i = 0; i < numBins; i++) {
      const val = dataArray[startBin + i];
      
      // Grayscale mapping
      ctx.fillStyle = `rgb(${val}, ${val}, ${val})`;
      ctx.fillRect(i * cellWidth, 0, cellWidth + 0.5, 2);
    }

    // Overlay channel indicators (16 carriers + sync)
    // Draw tiny guide ticks at the top border
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    const F_base = 16500;
    const F_step = 150;
    const F_sync = 19000;

    const getXCoord = (freq) => {
      const binIdx = freq / binWidth;
      return ((binIdx - startBin) / numBins) * w;
    };

    for (let i = 0; i < 16; i++) {
      const x = getXCoord(F_base + i * F_step);
      ctx.fillRect(x, 0, 1, 4);
    }
    // Draw sync line indicator (white dash)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    const xSync = getXCoord(F_sync);
    ctx.fillRect(xSync, 0, 1.5, 6);

    waterfallAnimationId = requestAnimationFrame(drawLoop);
  };

  waterfallAnimationId = requestAnimationFrame(drawLoop);
}

function stopWaterfallSpectrograph() {
  if (waterfallAnimationId) {
    cancelAnimationFrame(waterfallAnimationId);
    waterfallAnimationId = null;
  }
}

// In-Memory Modem Self-Test Loop
function runSelfTest() {
  const statusEl = document.getElementById('selftest-status');
  statusEl.innerHTML = '<span style="color:#00e5ff">Running Self-Test suite...</span><br>';
  
  try {
    const testString = "BUM16 SUCCESS! Offline loopback test passed.";
    logSelfTest('1. Input string: "' + testString + '"');

    // 1. Encryption test
    const key = "pass123";
    const encoder = new TextEncoder();
    const plainBytes = encoder.encode(testString);
    const encryptedBytes = window.BUM16_Crypto.encrypt(plainBytes, key);
    logSelfTest('2. Encrypted ciphertext length: ' + encryptedBytes.length + ' bytes.');

    const decryptedBytes = window.BUM16_Crypto.decrypt(encryptedBytes, key);
    const decryptedString = new TextDecoder().decode(decryptedBytes);
    
    if (decryptedString !== testString) {
      throw new Error("Crypto loopback mismatch!");
    }
    logSelfTest('3. Crypto integrity check: PASSED.');

    // 2. Image quantizer test
    const dummyCanvas = document.createElement('canvas');
    dummyCanvas.width = 16;
    dummyCanvas.height = 16;
    const dummyCtx = dummyCanvas.getContext('2d');
    dummyCtx.fillStyle = '#ff0055';
    dummyCtx.fillRect(0, 0, 8, 16);
    dummyCtx.fillStyle = '#00ffcc';
    dummyCtx.fillRect(8, 0, 8, 16);

    const imageBytes = window.BUM16_ImageCodec.encodeImage(dummyCanvas, 16, 16, false);
    logSelfTest('4. Test Image quantized (16x16). Compressed: ' + imageBytes.length + ' bytes.');

    const decodeCanvas = document.createElement('canvas');
    const decodedImg = window.BUM16_ImageCodec.decodeImage(imageBytes, decodeCanvas);
    if (!decodedImg) {
      throw new Error("ImageCodec decode failed!");
    }
    logSelfTest('5. ImageCodec integrity check: PASSED.');

    // 3. Modulation & Demodulation Multi-Protocol Memory Loopback
    const testRate = 44100;
    const testDuration = 0.08;

    // A. Standard 16-FSK Loopback
    logSelfTest('6a. Testing Standard 16-FSK loopback...');
    const modemStd = new window.BUM16_Modem(testRate, testDuration);
    modemStd.manualProtocol = 'std';
    const samplesStd = modemStd.modulate(plainBytes, 0, 'std');
    
    let decodedStd = null;
    modemStd.onSuccess = (type, payload) => { decodedStd = payload; };
    modemStd.onFailure = (reason) => { throw new Error("Std FSK failed: " + reason); };
    modemStd.decodeBuffer(samplesStd, testRate);
    
    if (!decodedStd || new TextDecoder().decode(decodedStd) !== testString) {
      throw new Error("Standard 16-FSK Loopback mismatch!");
    }
    logSelfTest('   - Standard 16-FSK: PASSED.');

    // B. Parallel FSK Loopback
    logSelfTest('6b. Testing Parallel FSK (Double Speed) loopback...');
    const modemPar = new window.BUM16_Modem(testRate, testDuration);
    modemPar.manualProtocol = 'par';
    const samplesPar = modemPar.modulate(plainBytes, 0, 'par');
    
    let decodedPar = null;
    modemPar.onSuccess = (type, payload) => { decodedPar = payload; };
    modemPar.onFailure = (reason) => { throw new Error("Parallel FSK failed: " + reason); };
    modemPar.decodeBuffer(samplesPar, testRate);
    
    if (!decodedPar || new TextDecoder().decode(decodedPar) !== testString) {
      throw new Error("Parallel FSK Loopback mismatch!");
    }
    logSelfTest('   - Parallel FSK: PASSED.');

    // C. FEC Robust Loopback
    logSelfTest('6c. Testing FEC Robust (Soft-Decision Repetition) loopback...');
    const modemFec = new window.BUM16_Modem(testRate, testDuration);
    modemFec.manualProtocol = 'fec';
    const samplesFec = modemFec.modulate(plainBytes, 0, 'fec');
    
    let decodedFec = null;
    modemFec.onSuccess = (type, payload) => { decodedFec = payload; };
    modemFec.onFailure = (reason) => { throw new Error("FEC Robust failed: " + reason); };
    modemFec.decodeBuffer(samplesFec, testRate);
    
    if (!decodedFec || new TextDecoder().decode(decodedFec) !== testString) {
      throw new Error("FEC Robust Loopback mismatch!");
    }
    logSelfTest('   - FEC Robust: PASSED.');

    // D. Multi-Frequency Sync Auto-Detection
    logSelfTest('6d. Testing Sync Auto-Detection (Parallel -> Auto)...');
    const modemAuto = new window.BUM16_Modem(testRate, testDuration);
    modemAuto.manualProtocol = 'auto'; // Receiver in Auto mode
    
    let decodedAuto = null;
    modemAuto.onSuccess = (type, payload) => { decodedAuto = payload; };
    modemAuto.onFailure = (reason) => { throw new Error("Auto-Detection failed: " + reason); };
    // Feed the Parallel FSK modulated signal to the Auto-detecting receiver
    modemAuto.decodeBuffer(samplesPar, testRate);
    
    if (!decodedAuto || new TextDecoder().decode(decodedAuto) !== testString) {
      throw new Error("Sync Auto-Detection mismatch!");
    }
    logSelfTest('   - Sync Auto-Detection: PASSED.');

    logSelfTest('8. Demodulator bitwise verification: ALL PASSED.');
    statusEl.innerHTML += '<br><span style="color:#ffffff; font-weight:bold; background: #555; padding: 2px 4px;">[SUCCESS] ALL SELF-TESTS PASSED!</span>';
    logToTerminal('Modem Self-Test PASSED.', 'success');
  } catch (err) {
    statusEl.innerHTML += `<br><span style="color:#ff1744; font-weight:bold;">[FAILED] ${err.message}</span>`;
    logToTerminal(`Self-Test Failed: ${err.message}`, 'error');
  }

  function logSelfTest(msg) {
    statusEl.innerHTML += `> ${msg}<br>`;
  }
}

// ================= STAGANOGRAPHY EMBEDDING FUNCTIONS =================

/**
 * Handle loading and decoding of uploaded audio/video files to embed secrets in
 */
function handleEmbedFile(file) {
  logToTerminal(`Decoding base media file: ${file.name}...`, 'info');
  document.getElementById('embed-file-info').textContent = `Loading: ${file.name}...`;

  // Track if it is a video file
  if (file.type.startsWith('video/') || file.name.endsWith('.mp4') || file.name.endsWith('.webm') || file.name.endsWith('.mov') || file.name.endsWith('.m4v') || file.name.endsWith('.3gp') || file.name.endsWith('.ogg')) {
    embedVideoFile = file;
    logToTerminal('Detected base file as video container. Stego-video multiplexing will be available.', 'success');
  } else {
    embedVideoFile = null;
  }

  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    audioContext.decodeAudioData(e.target.result)
      .then(audioBuffer => {
        embedBaseAudioBuffer = audioBuffer;
        logToTerminal(`Base file loaded. Rate: ${audioBuffer.sampleRate} Hz, Channels: ${audioBuffer.numberOfChannels}, Duration: ${audioBuffer.duration.toFixed(1)}s.`, 'info');
        
        // Update UI states
        document.getElementById('embed-file-info').textContent = `${file.name} (${audioBuffer.duration.toFixed(1)}s)`;
        document.getElementById('btn-process-embed').removeAttribute('disabled');
        
        // Setup slider constraints
        const delaySlider = document.getElementById('embed-delay-slider');
        delaySlider.max = Math.floor(audioBuffer.duration);
        delaySlider.value = 0;
        document.getElementById('embed-delay-span').textContent = '0s';
      })
      .catch(err => {
        console.error(err);
        document.getElementById('embed-file-info').textContent = 'Loading failed.';
        alert('Could not decode uploaded file. Ensure it is a valid audio/video file.');
      });
  };
  reader.readAsArrayBuffer(file);
}

/**
 * Mix the FSK signal into the pre-existing audio buffer
 */
function processAudioEmbedding() {
  if (!embedBaseAudioBuffer) return;

  const textVal = document.getElementById('embed-text').value.trim();
  if (!textVal) {
    alert('Please enter a secret message to embed.');
    return;
  }

  logToTerminal('Starting secret steganography mix sequence...', 'info');

  let rawBytes;
  let actualTypeFlag = 0; // 0=Text, 1=Encrypted

  const encoder = new TextEncoder();
  let bytes = encoder.encode(textVal);

  if (document.getElementById('embed-encrypt-chk').checked) {
    const password = document.getElementById('embed-password').value;
    if (!password) {
      alert('Please enter a password for encryption.');
      return;
    }
    bytes = window.BUM16_Crypto.encrypt(bytes, password);
    actualTypeFlag = 1;
    logToTerminal(`Payload encrypted. Size: ${bytes.length} bytes.`, 'info');
  }
  rawBytes = bytes;

  // Set modem parameters
  const sampleRate = embedBaseAudioBuffer.sampleRate;
  const speedSetting = document.getElementById('modem-speed-select').value;
  const symbolDur = speedSetting === 'extreme' ? 0.20 : speedSetting === 'slow' ? 0.12 : speedSetting === 'fast' ? 0.05 : 0.08;

  const protocolSetting = document.getElementById('modem-protocol-select').value;
  const encodeProtocol = (protocolSetting === 'auto') ? 'std' : protocolSetting;

  // Generate FSK modulated buffer
  const tempModem = new window.BUM16_Modem(sampleRate, symbolDur);
  const modulatedSignal = tempModem.modulate(rawBytes, actualTypeFlag, encodeProtocol);

  // Mix parameters
  const delaySec = parseFloat(document.getElementById('embed-delay-slider').value);
  const mixGain = parseFloat(document.getElementById('embed-gain-slider').value) / 100;
  
  const startSample = Math.floor(delaySec * sampleRate);
  const numChannels = embedBaseAudioBuffer.numberOfChannels;
  const baseLength = embedBaseAudioBuffer.length;
  const mixedLength = Math.max(baseLength, startSample + modulatedSignal.length);

  // Create mixed AudioBuffer
  mixedAudioBuffer = audioContext.createBuffer(numChannels, mixedLength, sampleRate);

  // Copy and Mix channels
  for (let ch = 0; ch < numChannels; ch++) {
    const baseData = embedBaseAudioBuffer.getChannelData(ch);
    const mixedData = mixedAudioBuffer.getChannelData(ch);

    // Copy original data
    mixedData.set(baseData, 0);

    // Add FSK modulated carrier signal
    for (let i = 0; i < modulatedSignal.length; i++) {
      const idx = startSample + i;
      if (idx < mixedLength) {
        mixedData[idx] += modulatedSignal[i] * mixGain;
      }
    }
  }

  // Auto-normalize if clipping would occur
  let peak = 0;
  for (let ch = 0; ch < numChannels; ch++) {
    const data = mixedAudioBuffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      const absVal = Math.abs(data[i]);
      if (absVal > peak) peak = absVal;
    }
  }

  if (peak > 0.99) {
    const scale = 0.98 / peak;
    for (let ch = 0; ch < numChannels; ch++) {
      const data = mixedAudioBuffer.getChannelData(ch);
      for (let i = 0; i < data.length; i++) {
        data[i] *= scale;
      }
    }
    logToTerminal(`Audio auto-normalized to prevent clipping (scaled by ${(scale * 100).toFixed(1)}%).`, 'info');
  }

  // Encode to WAV format
  logToTerminal('Encoding mixed AudioBuffer to 16-bit PCM WAV...', 'info');
  mixedAudioBytes = audioBufferToWav(mixedAudioBuffer);

  // Show UI state
  document.getElementById('embed-placeholder').style.display = 'none';
  const successUI = document.getElementById('embed-success-ui');
  successUI.style.display = 'flex';

  const exportVideoBtn = document.getElementById('btn-export-stego-video');
  if (embedVideoFile) {
    exportVideoBtn.style.display = 'block';
    exportVideoBtn.removeAttribute('disabled');
    exportVideoBtn.textContent = 'Export Stego-Video';
  } else {
    exportVideoBtn.style.display = 'none';
  }
  
  const originalSizeText = (baseLength * numChannels * 2 / 1024 / 1024).toFixed(2);
  const mixedSizeText = (mixedAudioBytes.length / 1024 / 1024).toFixed(2);
  document.getElementById('embed-success-desc').textContent = 
    `Original Size: ${originalSizeText} MB | Stego-WAV Size: ${mixedSizeText} MB | Duration: ${mixedAudioBuffer.duration.toFixed(1)}s`;

  logToTerminal(`Secret mixed and embedded successfully. Ready to export.`, 'success');
}

/**
 * Download the mixed audio WAV bytes
 */
function downloadEmbeddedWav() {
  if (!mixedAudioBytes) return;

  const blob = new Blob([mixedAudioBytes], { type: 'audio/wav' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `bum16_stego_${Date.now()}.wav`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  logToTerminal('Stego WAV file downloaded successfully.', 'success');
}

/**
 * Toggle playback preview of the mixed audio track
 */
function toggleMixedPlayback() {
  if (!mixedAudioBuffer) return;

  if (isPlayingMixedPreview) {
    stopMixedPlayback();
    return;
  }

  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }

  mixedSourceNode = audioContext.createBufferSource();
  mixedSourceNode.buffer = mixedAudioBuffer;

  analyserNode = audioContext.createAnalyser();
  analyserNode.fftSize = 2048;

  mixedSourceNode.connect(analyserNode);
  analyserNode.connect(audioContext.destination);

  mixedSourceNode.onended = () => {
    isPlayingMixedPreview = false;
    document.getElementById('btn-play-embedded-audio').textContent = 'Play Stego Preview';
    stopWaterfallSpectrograph();
  };

  mixedSourceNode.start(0);
  isPlayingMixedPreview = true;
  document.getElementById('btn-play-embedded-audio').textContent = 'Stop Mixed Playback';

  logToTerminal('Playing mixed stego-audio track...', 'info');
  startWaterfallSpectrograph();
}

function stopMixedPlayback() {
  if (mixedSourceNode) {
    try {
      mixedSourceNode.stop();
    } catch(e) {}
    mixedSourceNode = null;
  }
  isPlayingMixedPreview = false;
  document.getElementById('btn-play-embedded-audio').textContent = 'Play Stego Preview';
  stopWaterfallSpectrograph();
  logToTerminal('Mixed playback stopped.', 'info');
}

/**
 * Custom general AudioBuffer to WAV encoder supporting both Mono and Stereo tracks
 */
function audioBufferToWav(audioBuffer) {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const format = 1; // Uncompressed Integer PCM
  const bitDepth = 16;
  
  let interleavedSamples;
  if (numChannels === 2) {
    const lChannel = audioBuffer.getChannelData(0);
    const rChannel = audioBuffer.getChannelData(1);
    const len = lChannel.length;
    interleavedSamples = new Float32Array(len * 2);
    for (let i = 0; i < len; i++) {
      interleavedSamples[i * 2] = lChannel[i];
      interleavedSamples[i * 2 + 1] = rChannel[i];
    }
  } else {
    interleavedSamples = audioBuffer.getChannelData(0);
  }
  
  const buffer = new ArrayBuffer(44 + interleavedSamples.length * 2);
  const view = new DataView(buffer);
  
  const writeString = (v, offset, str) => {
    for (let i = 0; i < str.length; i++) {
      v.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + interleavedSamples.length * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true); // Byte rate
  view.setUint16(32, numChannels * 2, true); // Block align
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, 'data');
  view.setUint32(40, interleavedSamples.length * 2, true);
  
  let offset = 44;
  for (let i = 0; i < interleavedSamples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, interleavedSamples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  
  return new Uint8Array(buffer);
}

// ================= TAB CAPTURE & URL DECODING FUNCTIONS =================

/**
 * Toggle capturing tab audio digitally using getDisplayMedia
 */
function toggleTabCapture(start) {
  if (start) {
    if (isListening) {
      toggleMicrophone(false);
    }
    
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }

    logToTerminal('[CAPTURE] Select the browser tab (e.g. YouTube, TikTok, Instagram) and check the "Share audio" box!', 'warn');

    navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
      .then(stream => {
        const audioTracks = stream.getAudioTracks();
        if (audioTracks.length === 0) {
          logToTerminal('[CAPTURE ERR] Tab audio sharing was not selected.', 'error');
          alert('Please make sure to check the "Share audio" box when selecting the tab.');
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        // Stop video tracks immediately (saves performance)
        stream.getVideoTracks().forEach(t => t.stop());
        
        tabStream = stream;
        
        // Listen for user stopping stream via browser UI bar
        audioTracks[0].onended = () => {
          if (isCapturingTab) {
            toggleTabCapture(false);
          }
        };

        analyserNode = audioContext.createAnalyser();
        analyserNode.fftSize = 2048;

        tabSourceNode = audioContext.createMediaStreamSource(new MediaStream(audioTracks));
        tabSourceNode.connect(analyserNode);

        // Setup Live Modem
        const speedSetting = document.getElementById('modem-speed-select').value;
        const symbolDur = speedSetting === 'extreme' ? 0.20 : speedSetting === 'slow' ? 0.12 : speedSetting === 'fast' ? 0.05 : 0.08;
        
        liveModem = new window.BUM16_Modem(audioContext.sampleRate, symbolDur);
        liveModem.manualProtocol = document.getElementById('modem-protocol-select').value;
        
        liveModem.onLog = (msg) => logToTerminal(msg, 'info');
        liveModem.onProgress = (pct) => {
          document.getElementById('decode-progress-fill').style.width = `${pct}%`;
        };
        liveModem.onSuccess = handleDecodeSuccess;
        liveModem.onFailure = (reason) => {
          logToTerminal(`Decoding Failed: ${reason}`, 'error');
          updateMicLockIndicator('failed');
          setTimeout(() => updateMicLockIndicator('listening'), 2000);
        };

        isCapturingTab = true;
        document.getElementById('btn-capture-tab-audio').textContent = 'Stop Capturing';
        document.getElementById('btn-capture-tab-audio').className = 'btn btn-danger';
        document.getElementById('btn-mic-toggle').setAttribute('disabled', 'true');
        
        updateMicLockIndicator('listening');
        logToTerminal(`Tab capture active. Digital audio stream running...`, 'success');

        // Start processing audio buffer
        startTabProcessingLoop();
        startWaterfallSpectrograph();
      })
      .catch(err => {
        console.error(err);
        logToTerminal(`[CAPTURE ERR] Screen capture failed: ${err.message}`, 'error');
      });
  } else {
    // Stop Tab stream
    if (tabStream) {
      tabStream.getTracks().forEach(t => t.stop());
      tabStream = null;
    }
    isCapturingTab = false;
    document.getElementById('btn-capture-tab-audio').textContent = 'Capture Tab Audio';
    document.getElementById('btn-capture-tab-audio').className = 'btn';
    document.getElementById('btn-mic-toggle').removeAttribute('disabled');
    
    updateMicLockIndicator('idle');
    stopWaterfallSpectrograph();
    logToTerminal('Tab capture deactivated.', 'info');
  }
}

// Processing loop for tab capture (same as mic)
function startTabProcessingLoop() {
  const bufferSize = 1024;
  scriptNode = audioContext.createScriptProcessor(bufferSize, 1, 1);
  
  scriptNode.onaudioprocess = (audioProcessingEvent) => {
    if (!isCapturingTab) return;
    const inputBuffer = audioProcessingEvent.inputBuffer;
    const samples = inputBuffer.getChannelData(0);
    
    liveModem.processAudioChunk(samples);
    updateVolumeMeter(samples);

    if (liveModem.state === 'IDLE') {
      updateMicLockIndicator('listening');
      const protVal = document.getElementById('modem-protocol-select').value;
      document.getElementById('top-protocol-val').textContent = protVal === 'auto' ? 'AUTO-DETECT' : protVal.toUpperCase();
    } else if (liveModem.state === 'SYNCING') {
      updateMicLockIndicator('syncing');
    } else if (liveModem.state === 'DECODING') {
      updateMicLockIndicator('decoding');
      if (liveModem.lockedProtocol) {
        document.getElementById('top-protocol-val').textContent = liveModem.lockedProtocol.toUpperCase() + ' (LOCKED)';
      }
    }
  };

  analyserNode.connect(scriptNode);
  scriptNode.connect(audioContext.destination);
}

/**
 * Fetch and decode audio from a direct URL
 */
function decodeFromUrl() {
  const url = document.getElementById('rx-url-input').value.trim();
  if (!url) {
    alert('Please enter a URL.');
    return;
  }

  logToTerminal(`[URL] Requesting media file from: ${url}`, 'info');

  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }

  fetch(url)
    .then(response => {
      if (!response.ok) throw new Error(`HTTP error status: ${response.status}`);
      return response.arrayBuffer();
    })
    .then(arrayBuffer => {
      logToTerminal('[URL] Media loaded. Decoding audio track...', 'info');
      return audioContext.decodeAudioData(arrayBuffer);
    })
    .then(audioBuffer => {
      logToTerminal(`[URL] Audio decoded. Rate: ${audioBuffer.sampleRate} Hz, duration: ${audioBuffer.duration.toFixed(1)}s.`, 'info');
      
      const samples = audioBuffer.getChannelData(0);
      
      logToTerminal('Running offline demodulator on URL audio data...', 'info');
      
      const speedSetting = document.getElementById('modem-speed-select').value;
      const symbolDur = speedSetting === 'extreme' ? 0.20 : speedSetting === 'slow' ? 0.12 : speedSetting === 'fast' ? 0.05 : 0.08;

      const offlineModem = new window.BUM16_Modem(audioBuffer.sampleRate, symbolDur);
      offlineModem.manualProtocol = document.getElementById('modem-protocol-select').value;
      offlineModem.onLog = (msg) => logToTerminal(msg, 'info');
      offlineModem.onSuccess = handleDecodeSuccess;
      offlineModem.onFailure = (reason) => logToTerminal(`URL decoding failed: ${reason}`, 'error');
      
      offlineModem.decodeBuffer(samples, audioBuffer.sampleRate);
    })
    .catch(err => {
      console.error(err);
      logToTerminal(`[URL ERR] Network request blocked or failed.`, 'error');
      
      // Educational explanation for CORS block
      if (url.includes('youtube.com') || url.includes('youtu.be') || url.includes('tiktok.com') || url.includes('instagram.com')) {
        logToTerminal(`[CORS SECURITY] Direct fetching from YouTube/TikTok/Instagram is blocked by browser origin security policies.`, 'warn');
        logToTerminal(`💡 SOLUTION: Please click "Capture Tab Audio" instead, select the social media tab, and check "Share audio" to record digitally.`, 'success');
        alert('CORS Blocked: YouTube/TikTok/Instagram do not allow direct client-side fetching.\n\nSolution: Use the "Capture Tab Audio" button in BUM16 to record and decode the video digitally without microphone noise!');
      } else {
        alert(`URL Load Failed: ${err.message}\nEnsure the server allows Cross-Origin requests (CORS).`);
      }
    });
}

// ================= VIDEO EXPORT FUNCTIONS =================

/**
 * Animate and record a cyberpunk hacker status screen video combined with the ultrasonic audio track
 */
function recordVideoFile() {
  if (!generatedAudioBuffer) return;

  logToTerminal('[VIDEO] Initializing video capture pipeline...', 'info');

  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }

  // 1. Create a canvas for video frames
  recordingCanvas = document.createElement('canvas');
  recordingCanvas.width = 1280;
  recordingCanvas.height = 720;
  recordingCtx = recordingCanvas.getContext('2d');

  // 2. Set up Audio Destination stream
  const destNode = audioContext.createMediaStreamDestination();

  // 3. Create Audio source
  const sourceNode = audioContext.createBufferSource();
  const audioRate = 44100;
  const audioBuffer = audioContext.createBuffer(1, generatedAudioBuffer.length, audioRate);
  audioBuffer.copyToChannel(generatedAudioBuffer, 0);
  sourceNode.buffer = audioBuffer;
  sourceNode.connect(destNode);

  // 4. Combine Canvas stream + Audio stream
  const canvasStream = recordingCanvas.captureStream(30); // 30 FPS
  const audioTrack = destNode.stream.getAudioTracks()[0];
  canvasStream.addTrack(audioTrack);

  // 5. Select MIME type based on dropdown
  const exportFormatSetting = document.getElementById('video-export-format').value;
  let mimeType = 'video/mp4;codecs=avc1,mp4a';
  let ext = 'mp4';
  if (exportFormatSetting === 'webm') {
    mimeType = 'video/webm;codecs=vp9,opus';
    ext = 'webm';
  }
  if (!MediaRecorder.isTypeSupported(mimeType)) {
    logToTerminal(`[WARNING] Selected format ${mimeType} is not supported by your browser. Attempting fallback...`, 'warn');
    if (ext === 'mp4') {
      mimeType = 'video/webm;codecs=vp9,opus';
      ext = 'webm';
    } else {
      mimeType = 'video/mp4;codecs=avc1,mp4a';
      ext = 'mp4';
    }
  }
  if (!MediaRecorder.isTypeSupported(mimeType)) {
    mimeType = 'video/webm';
    ext = 'webm';
  }

  logToTerminal(`[VIDEO] Using encoder format: ${mimeType} (.${ext})`, 'info');

  // 6. Setup MediaRecorder
  videoChunks = [];
  try {
    videoRecorder = new MediaRecorder(canvasStream, { mimeType });
  } catch (err) {
    logToTerminal(`[VIDEO ERR] Failed to create MediaRecorder: ${err.message}`, 'error');
    alert('Could not initialize video recorder: ' + err.message);
    return;
  }

  videoRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) {
      videoChunks.push(e.data);
    }
  };

  videoRecorder.onstop = () => {
    // Stop canvas animation
    cancelAnimationFrame(recordingAnimationId);

    // Save video data to blob url
    if (generatedVideoBlobUrl) {
      URL.revokeObjectURL(generatedVideoBlobUrl);
    }

    const blob = new Blob(videoChunks, { type: mimeType });
    generatedVideoBlobUrl = URL.createObjectURL(blob);
    generatedVideoExt = ext;

    // Load URL in video player preview
    const videoPlayer = document.getElementById('video-preview-player');
    videoPlayer.src = generatedVideoBlobUrl;

    document.getElementById('video-preview-container').style.display = 'flex';

    isRecordingVideo = false;
    document.getElementById('btn-download-video').removeAttribute('disabled');
    document.getElementById('btn-download-video').textContent = 'Export Video';
    logToTerminal(`[VIDEO] Video successfully compiled! Ready to preview and download.`, 'success');
  };

  // 7. Start recording and playback
  const startTime = audioContext.currentTime;
  const duration = audioBuffer.duration;

  videoRecorder.start();
  sourceNode.start(0);
  isRecordingVideo = true;

  document.getElementById('btn-download-video').setAttribute('disabled', 'true');

  logToTerminal(`[VIDEO] Recording started. Rendering cyberpunk status screen. Please wait ${duration.toFixed(1)}s...`, 'warn');

  // 8. Render Animation Loop
  const render = () => {
    if (!isRecordingVideo) return;
    const elapsed = audioContext.currentTime - startTime;
    const pct = Math.min(1.0, elapsed / duration);

    drawRecordingFrame(pct, elapsed);

    document.getElementById('btn-download-video').textContent = `Recording: ${Math.round(pct * 100)}%`;

    if (pct < 1.0) {
      recordingAnimationId = requestAnimationFrame(render);
    }
  };

  sourceNode.onended = () => {
    if (videoRecorder.state !== 'inactive') {
      videoRecorder.stop();
    }
  };

  recordingAnimationId = requestAnimationFrame(render);
}

/**
 * Draw a single frame of the cyberpunk status screen on the recording canvas
 */
function drawRecordingFrame(pct, elapsed) {
  const ctx = recordingCtx;
  const w = recordingCanvas.width;
  const h = recordingCanvas.height;

  // Background
  ctx.fillStyle = '#080b10';
  ctx.fillRect(0, 0, w, h);

  // Cyberpunk style grids
  ctx.strokeStyle = 'rgba(0, 229, 255, 0.03)';
  ctx.lineWidth = 1;
  const gridSize = 40;
  for (let x = 0; x < w; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y < h; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  // Border (white solid)
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 4;
  ctx.strokeRect(8, 8, w - 16, h - 16);

  // System title
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 36px monospace';
  ctx.fillText('BUM16 // ULTRASONIC MODEM', 80, 100);

  ctx.fillStyle = '#aaaaaa';
  ctx.font = '18px monospace';
  ctx.fillText('BENN\'S ULTRASONIC DATA MODEM // ACOUSTIC STREAMS INTERRUPT', 80, 130);

  // Blinking dot and status
  const blink = Math.floor(elapsed * 2) % 2 === 0;
  ctx.fillStyle = blink ? '#ffffff' : '#555555';
  ctx.beginPath();
  ctx.arc(80, 180, 8, 0, 2 * Math.PI);
  ctx.fill();

  ctx.fillStyle = '#e6edf3';
  ctx.font = 'bold 20px monospace';
  ctx.fillText('TRANSMITTING ULTRASONIC CARRIER PAYLOAD...', 100, 187);

  // Progress Bar
  const pWidth = w - 160;
  const pHeight = 24;
  const px = 80;
  const py = 230;

  ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.fillRect(px, py, pWidth, pHeight);

  // Solid white fill
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(px, py, pWidth * pct, pHeight);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(px, py, pWidth, pHeight);

  ctx.fillStyle = '#000000';
  ctx.font = '14px monospace';
  ctx.fillText(`${Math.round(pct * 100)}%`, px + pWidth / 2 - 12, py + 17);

  // Oscilloscope wave
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.lineWidth = 3;
  ctx.beginPath();

  const waveY = 410;
  ctx.moveTo(80, waveY);

  const waveWidth = w - 160;
  for (let i = 0; i < waveWidth; i++) {
    const angle = (i / waveWidth) * Math.PI * 10 + elapsed * 8;
    const amplitude = Math.sin(angle) * Math.cos(angle * 0.4) * 60 * Math.sin(pct * Math.PI);
    ctx.lineTo(80 + i, waveY + amplitude);
  }
  ctx.stroke();

  // Draw details box
  ctx.fillStyle = 'rgba(22, 27, 34, 0.7)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  ctx.fillRect(80, 520, w - 160, 120);
  ctx.strokeRect(80, 520, w - 160, 120);

  ctx.fillStyle = '#aaaaaa';
  ctx.font = '15px monospace';

  const speedVal = document.getElementById('modem-speed-select').value;
  ctx.fillText(`BANDWIDTH : 16.50 kHz - 19.00 kHz`, 110, 555);
  ctx.fillText(`MODULATION: 16-FSK CONCURRENT`, 110, 585);
  ctx.fillText(`BAUD RATE : ${speedVal === 'slow' ? '120ms' : speedVal === 'extreme' ? '200ms' : speedVal === 'fast' ? '50ms' : '80ms'} per symbol`, 110, 615);

  ctx.fillText(`SAMPLING  : 44,100 Hz Mono PCM`, w / 2 + 80, 555);
  ctx.fillText(`ENCRYPTION: KEYDER CTR STREAMS`, w / 2 + 80, 585);
  ctx.fillText(`TIMELINE  : ${elapsed.toFixed(1)}s / ${duration.toFixed(1)}s`, w / 2 + 80, 615);
}

/**
 * Triggers the download of the cached generated video file
 */
function downloadVideoFile() {
  if (!generatedVideoBlobUrl) return;

  const a = document.createElement('a');
  a.href = generatedVideoBlobUrl;
  a.download = `bum16_transmission_${Date.now()}.${generatedVideoExt}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  logToTerminal('[VIDEO] Video download started.', 'success');
}

/**
 * Closes the video preview player and revokes the URL resources
 */
function closeVideoPreview() {
  const container = document.getElementById('video-preview-container');
  container.style.display = 'none';

  const videoPlayer = document.getElementById('video-preview-player');
  videoPlayer.pause();
  videoPlayer.src = '';

  if (generatedVideoBlobUrl) {
    URL.revokeObjectURL(generatedVideoBlobUrl);
    generatedVideoBlobUrl = null;
  }
  logToTerminal('[VIDEO] Video preview player closed and resources cleaned.', 'info');
}

// ================= STEGO-VIDEO RE-MUXING EXPORT FUNCTIONS =================

/**
 * Capture and re-mux the uploaded phone video with the newly mixed stego audio track.
 */
function recordStegoVideoFile() {
  if (!embedVideoFile || !mixedAudioBuffer) {
    alert('Please upload a video file and mix the steganography payload first.');
    return;
  }

  logToTerminal('[STEGO-VIDEO] Initializing video re-muxing pipeline...', 'info');

  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }

  // 1. Create a visible floating status monitor player in the DOM
  // This prevents browser compositing engines from throttling or pausing video frame decodes.
  const monitorContainer = document.createElement('div');
  monitorContainer.className = 'stego-mux-monitor';

  const titleBar = document.createElement('div');
  titleBar.className = 'stego-mux-title';
  titleBar.textContent = 'MUXING ULTRASONIC AUDIO';

  const tempVideo = document.createElement('video');
  tempVideo.className = 'stego-mux-video';
  tempVideo.src = URL.createObjectURL(embedVideoFile);
  tempVideo.muted = true;
  tempVideo.playsInline = true;

  const statusLabel = document.createElement('div');
  statusLabel.style.fontSize = '0.75rem';
  statusLabel.style.color = '#ffffff';
  statusLabel.style.textAlign = 'center';
  statusLabel.style.marginTop = '4px';
  statusLabel.textContent = 'Seeking video headers...';

  monitorContainer.appendChild(titleBar);
  monitorContainer.appendChild(tempVideo);
  monitorContainer.appendChild(statusLabel);
  document.body.appendChild(monitorContainer);

  // 2. Set up Audio Destination stream for mixed stego audio
  const destNode = audioContext.createMediaStreamDestination();

  // 3. Create Audio buffer source
  const sourceNode = audioContext.createBufferSource();
  sourceNode.buffer = mixedAudioBuffer;
  sourceNode.connect(destNode);

  // Wait for video metadata to load to capture track
  tempVideo.onloadedmetadata = () => {
    // 4. Capture original video track at a LOCKED constant frame rate (30 FPS)
    // Specifying 30 FPS prevents time-axis compression/drift during browser rendering lags.
    const videoStream = tempVideo.captureStream ? tempVideo.captureStream(30) : tempVideo.mozCaptureStream(30);
    const videoTracks = videoStream.getVideoTracks();

    if (videoTracks.length === 0) {
      logToTerminal('[STEGO-VIDEO ERR] Failed to extract video track from container.', 'error');
      alert('Could not extract video track. Ensure it is a valid video file.');
      document.body.removeChild(monitorContainer);
      return;
    }

    // 5. Combine Video track + Mixed Audio track
    const combinedStream = new MediaStream();
    combinedStream.addTrack(videoTracks[0]);
    combinedStream.addTrack(destNode.stream.getAudioTracks()[0]);

    // 6. Select MIME type based on dropdown
    const exportFormatSetting = document.getElementById('video-export-format').value;
    let mimeType = 'video/mp4;codecs=avc1,mp4a';
    let ext = 'mp4';
    if (exportFormatSetting === 'webm') {
      mimeType = 'video/webm;codecs=vp9,opus';
      ext = 'webm';
    }
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      logToTerminal(`[WARNING] Selected format ${mimeType} is not supported by your browser. Attempting fallback...`, 'warn');
      if (ext === 'mp4') {
        mimeType = 'video/webm;codecs=vp9,opus';
        ext = 'webm';
      } else {
        mimeType = 'video/mp4;codecs=avc1,mp4a';
        ext = 'mp4';
      }
    }
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm';
      ext = 'webm';
    }

    logToTerminal(`[STEGO-VIDEO] Muxing to format: ${mimeType} (.${ext})`, 'info');

    // 7. Setup MediaRecorder
    stegoVideoChunks = [];
    try {
      stegoVideoRecorder = new MediaRecorder(combinedStream, { mimeType });
    } catch (err) {
      logToTerminal(`[STEGO-VIDEO ERR] MediaRecorder creation failed: ${err.message}`, 'error');
      alert('Muxer creation failed: ' + err.message);
      document.body.removeChild(monitorContainer);
      return;
    }

    stegoVideoRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        stegoVideoChunks.push(e.data);
      }
    };

    stegoVideoRecorder.onstop = () => {
      // Clean up temp video element and DOM container
      tempVideo.pause();
      URL.revokeObjectURL(tempVideo.src);
      if (document.body.contains(monitorContainer)) {
        document.body.removeChild(monitorContainer);
      }

      // Save video data to blob url
      if (stegoVideoBlobUrl) {
        URL.revokeObjectURL(stegoVideoBlobUrl);
      }

      const blob = new Blob(stegoVideoChunks, { type: mimeType });
      stegoVideoBlobUrl = URL.createObjectURL(blob);
      stegoVideoExt = ext;

      // Load URL in stego video preview player
      const player = document.getElementById('embed-video-preview-player');
      player.src = stegoVideoBlobUrl;
      document.getElementById('embed-video-preview-container').style.display = 'flex';

      isRecordingStegoVideo = false;
      const exportBtn = document.getElementById('btn-export-stego-video');
      exportBtn.removeAttribute('disabled');
      exportBtn.textContent = 'Export Stego-Video';
      logToTerminal(`[STEGO-VIDEO] Video re-muxing completed successfully! Ready to preview.`, 'success');
    };

    // 8. Start recording and synchronized playback
    const duration = tempVideo.duration || mixedAudioBuffer.duration;
    
    let audioStarted = false;
    const fallbackTimer = setTimeout(() => {
      if (!audioStarted) {
        stegoVideoRecorder.start();
        sourceNode.start(0);
        audioStarted = true;
        isRecordingStegoVideo = true;
        logToTerminal(`[STEGO-VIDEO] Sync fallback activated.`, 'warn');
      }
    }, 1000);

    tempVideo.onplaying = () => {
      clearTimeout(fallbackTimer);
      if (!audioStarted) {
        stegoVideoRecorder.start();
        sourceNode.start(0);
        audioStarted = true;
        isRecordingStegoVideo = true;
        logToTerminal(`[STEGO-VIDEO] Video playback active. Recording audio sync track...`, 'info');
      }
    };

    // Trigger video play
    tempVideo.play();
    const exportBtn = document.getElementById('btn-export-stego-video');
    exportBtn.setAttribute('disabled', 'true');

    logToTerminal(`[STEGO-VIDEO] Muxing audio track. Please wait ${duration.toFixed(1)}s...`, 'warn');

    // Update progress on the button during playback
    tempVideo.ontimeupdate = () => {
      if (isRecordingStegoVideo) {
        const pct = Math.min(1.0, tempVideo.currentTime / duration);
        const pctText = `${Math.round(pct * 100)}%`;
        exportBtn.textContent = `Muxing: ${pctText}`;
        statusLabel.textContent = `Muxing frames: ${pctText} (${tempVideo.currentTime.toFixed(1)}s / ${duration.toFixed(1)}s)`;
      }
    };

    // End when video playback finishes or audio source finishes
    tempVideo.onended = () => {
      clearTimeout(fallbackTimer);
      if (stegoVideoRecorder.state !== 'inactive') {
        stegoVideoRecorder.stop();
      }
    };
    sourceNode.onended = () => {
      clearTimeout(fallbackTimer);
      if (stegoVideoRecorder.state !== 'inactive') {
        stegoVideoRecorder.stop();
      }
    };
  };

  tempVideo.onerror = (err) => {
    logToTerminal('[STEGO-VIDEO ERR] Failed to load source video file.', 'error');
    if (document.body.contains(monitorContainer)) {
      document.body.removeChild(monitorContainer);
    }
  };
}

/**
 * Triggers the download of the cached muxed stego video file
 */
function downloadStegoVideoFile() {
  if (!stegoVideoBlobUrl) return;

  const a = document.createElement('a');
  a.href = stegoVideoBlobUrl;
  a.download = `bum16_stego_mux_${Date.now()}.${stegoVideoExt}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  logToTerminal('[STEGO-VIDEO] Stego-video download started.', 'success');
}

/**
 * Closes the stego video preview player and revokes resources
 */
function closeStegoVideoPreview() {
  const container = document.getElementById('embed-video-preview-container');
  container.style.display = 'none';

  const player = document.getElementById('embed-video-preview-player');
  player.pause();
  player.src = '';

  if (stegoVideoBlobUrl) {
    URL.revokeObjectURL(stegoVideoBlobUrl);
    stegoVideoBlobUrl = null;
  }
  logToTerminal('[STEGO-VIDEO] Stego-video preview closed and resources cleaned.', 'info');
}

