# Speech to Cursor

A lightweight Windows desktop application that transcribes your speech and pastes the corrected text at your cursor position in any application.

Built with Electron. Powered by [Groq](https://groq.com/) (Whisper + Llama 3.70b).

---

## How It Works

1. Press **Alt + .** (or click the system tray icon) to open the overlay.
2. Click the microphone button to start recording.
3. Speak naturally — the app records your voice.
4. Click stop. The audio is sent to the Groq API:
   - **Whisper** transcribes the speech to raw text.
   - **Llama 3.70b** corrects grammar, punctuation, and formatting.
5. The corrected text is copied to your clipboard and automatically pasted at your cursor.

---

## Download

Head to the [Releases](https://github.com/kunalsahu20/speech-to-clipboard/releases) page and download `Speech-to-Cursor-v1.0.0-win-x64.zip`.

1. **Extract** the zip file.
2. Open the folder and run `Speech to Cursor.exe`.

> **Note:** If Windows SmartScreen says "Windows protected your PC", click **More info** → **Run anyway**. This appears because the app is not code-signed (which costs ~$400/year). The app is safe and open source.

---

## Requirements

- Windows 10 or later
- A microphone
- A free [Groq API key](https://console.groq.com/keys)

---

## Setup

1. Download and run `Speech to Cursor.exe` from [Releases](https://github.com/kunalsahu20/speech-to-clipboard/releases).
2. On first launch, you will be prompted to enter your Groq API key.
3. You can update the key anytime by right-clicking the tray icon and selecting **Set API Key**.

Your API key is stored locally on your machine using encrypted storage. It is never sent anywhere except directly to the Groq API over HTTPS.

## Troubleshooting

### "Windows protected your PC" / Virus Warning
This is Microsoft Defender SmartScreen flagging the app because it enters the "unknown publisher" category (no code signing certificate).
- **Solution:** Click **More info** → **Run anyway**.

### "Invalid file descriptor to ICU data received"
This error means you tried to run the `.exe` without its dependency files. Electron apps need the full folder to run.
- **Solution:** Make sure you extract the **entire .zip file** and run the executable from inside the folder. Do not move the `.exe` file out of the folder.

---

## Build from Source

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or later)
- [npm](https://www.npmjs.com/)

### Steps

```bash
git clone https://github.com/kunalsahu20/speech-to-clipboard.git
cd speech-to-clipboard
npm install
```

**Run in development mode:**

```bash
npm start
```

**Build the executable:**

```bash
npx electron-packager . "Speech to Cursor" --platform=win32 --arch=x64 --out=dist --overwrite --asar
```

The output will be in `dist/Speech to Cursor-win32-x64/`.

---

## Configuration

| Setting | Default | Notes |
|---|---|---|
| Global Shortcut | `Alt + .` | Toggle the overlay bar |
| Transcription Model | Whisper Large v3 Turbo | Via Groq API |
| Correction Model | Llama 3.70b Versatile | Via Groq API |

To change the shortcut key, edit the `SHORTCUT` constant in `main.js` and rebuild.

---

## Architecture

```
main.js        Electron main process — tray, shortcuts, IPC, clipboard, paste
preload.js     Secure bridge between main and renderer (contextBridge)
overlay.html   Overlay UI structure
overlay.css    Overlay styling and animations
overlay.js     Renderer logic — recording, API calls, waveform
```

The app follows Electron security best practices:

- `contextIsolation: true` — renderer is sandboxed from Node.js
- `nodeIntegration: false` — no direct Node.js access in the renderer
- `sandbox: true` — Chromium-level process sandboxing
- Content Security Policy — restricts loaded resources
- DevTools disabled in production builds
- API key encrypted at rest with a machine-derived key

---

## Privacy

- Audio is recorded locally and sent only to the Groq API for transcription.
- No data is stored on any server. No telemetry. No analytics.
- Your API key is stored locally in an encrypted file on your machine.
- All network requests use HTTPS.

---

## License

This project is licensed under the [MIT License](LICENSE).

---

## Contributing

Contributions are welcome. Please read the [Contributing Guide](CONTRIBUTING.md) before submitting a pull request.

---

## Acknowledgments

- [Electron](https://www.electronjs.org/) — desktop application framework
- [Groq](https://groq.com/) — fast AI inference API
- [Whisper](https://openai.com/research/whisper) — speech recognition model
- [Llama](https://llama.meta.com/) — large language model by Meta
