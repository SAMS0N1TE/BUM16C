# 🔊 BUM16 - Benn's Ultrasonic Modem (16-FSK)

**BUM16** is an offline, browser-based modem that lets you send text, encrypted messages, and small pixel art images over sound waves using near-ultrasonic frequencies (**16.5 kHz to 19.0 kHz**). 

It is built with plain old HTML5, CSS3, and JavaScript. There's nothing to install and it should work entirely in-browser. 

---

## 🛠️ How it Works

Under the hood, BUM16 runs a full digital acoustic pipeline to process and decode audio:

```mermaid
graph TD
    subgraph TX_INPUT ["1. Input & Compression"]
        A[Input Text or Image] --> B[RLE Compression / Encryption]
    end

    subgraph TX_MOD ["2. Framing & Modulation"]
        C[Packet Assembly & CRC32] --> D[16-FSK Modulator]
    end

    subgraph TX_AUDIO ["3. Audio Signal Generation"]
        E[Smooth Sine Gen + Hanning Window] --> F[Uncompressed WAV File]
    end

    subgraph RX_IN ["4. Audio Capture & Buffer"]
        G[Microphone Input / WAV Upload] --> H[Sliding Window Ring Buffer]
    end

    subgraph RX_SYNC ["5. Sync & Filtering"]
        I[Preamble & Sync Tone Detection] --> J[Goertzel Energy Filter Array]
    end

    subgraph RX_OUT ["6. Demodulation & Payload Extraction"]
        K[Symbol Demodulation & Reassembly] --> L[CRC32 Check & Decryption/RLE Decompress]
        L --> M[Decoded Output Text or Image]
    end

    %% Pipeline flow between rows
    B --> C
    D --> E
    F -. Acoustic or Digital Path .-> G
    H --> I
    J --> K
