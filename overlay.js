/**
 * overlay.js — Overlay Renderer Process
 *
 * Handles:
 * - Record/Stop toggle
 * - MediaRecorder with noise suppression
 * - Groq Whisper transcription → LLM correction
 * - Sends corrected text to main process for paste-at-cursor
 */

// ── Constants ──────────────────────────────────────────────
const GROQ_TRANSCRIPTION_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
const WHISPER_MODEL = "whisper-large-v3";
const LLM_MODEL = "llama-3.3-70b-versatile";

// ── DOM ────────────────────────────────────────────────────
const recordBtn = document.getElementById("recordBtn");
const recIcon = document.getElementById("recIcon");
const waveformCanvas = document.getElementById("waveform");
const statusEl = document.getElementById("status");
const closeBtn = document.getElementById("closeBtn");
const toastEl = document.getElementById("toast");

// ── State ──────────────────────────────────────────────────
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let isProcessing = false;
let audioContext = null;
let analyser = null;
let animationFrameId = null;

// ── Event Listeners ────────────────────────────────────────
recordBtn.addEventListener("click", () => {
    if (isProcessing) return;
    if (isRecording) {
        stopRecording();
    } else {
        startRecording();
    }
});

closeBtn.addEventListener("click", () => {
    if (isRecording) stopRecording();
    window.electronAPI.hideOverlay();
});

document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
        if (isRecording) stopRecording();
        window.electronAPI.hideOverlay();
    }
});

// ── IPC Listeners ──────────────────────────────────────────
window.electronAPI.onResetUI(() => {
    resetUI();
});

window.electronAPI.onCheckRecordingStatus(() => {
    window.electronAPI.sendRecordingStatus(isRecording);
});

// ── Recording ──────────────────────────────────────────────
async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 16000,
            },
        });

        const mimeType = getSupportedMimeType();
        mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
        audioChunks = [];

        mediaRecorder.addEventListener("dataavailable", (e) => {
            if (e.data.size > 0) audioChunks.push(e.data);
        });

        mediaRecorder.addEventListener("stop", handleRecordingStop);
        mediaRecorder.start();
        isRecording = true;

        // UI
        recordBtn.classList.add("recording");
        recIcon.textContent = "⏹️";
        setStatus("Recording…", "recording");
        setupWaveform(stream);
    } catch (err) {
        console.error("Mic error:", err);
        setStatus("Mic error", "error");
    }
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach((t) => t.stop());
    }
    isRecording = false;
    recordBtn.classList.remove("recording");
    recIcon.textContent = "🎙️";
    stopWaveform();
}

// ── Processing Pipeline ────────────────────────────────────
async function handleRecordingStop() {
    if (audioChunks.length === 0) {
        setStatus("No audio", "error");
        return;
    }

    isProcessing = true;
    recordBtn.classList.add("processing");

    const mimeType = mediaRecorder.mimeType || "audio/webm";
    const audioBlob = new Blob(audioChunks, { type: mimeType });
    const ext = getExtensionFromMime(mimeType);

    try {
        // Get API key
        const apiKey = await window.electronAPI.getApiKey();
        if (!apiKey) {
            setStatus("No API key!", "error");
            return;
        }

        // Step 1: Whisper
        setStatus("Transcribing…", "processing");
        const whisperResult = await transcribeAudio(audioBlob, `rec.${ext}`, apiKey);
        const rawText = whisperResult.text || "";

        if (!rawText.trim()) {
            setStatus("No speech", "error");
            return;
        }

        // Step 2: LLM correction
        setStatus("Correcting…", "processing");
        const correctedText = await correctWithLLM(rawText, apiKey);

        // Step 3: Paste at cursor
        setStatus("Pasting…", "processing");
        const result = await window.electronAPI.pasteText(correctedText);

        if (result.success) {
            setStatus("✓ Done!", "success");
            showToast("✅", "Copied & pasted at cursor!");
        } else {
            setStatus("Paste failed", "error");
        }
    } catch (err) {
        console.error("Pipeline error:", err);
        setStatus("Error!", "error");
    } finally {
        isProcessing = false;
        recordBtn.classList.remove("processing");
    }
}

// ── Whisper Transcription ──────────────────────────────────
async function transcribeAudio(audioBlob, fileName, apiKey) {
    const formData = new FormData();
    formData.append("file", audioBlob, fileName);
    formData.append("model", WHISPER_MODEL);
    formData.append("response_format", "verbose_json");
    formData.append("language", "en");
    formData.append("temperature", "0");
    formData.append("timestamp_granularities[]", "word");
    formData.append("timestamp_granularities[]", "segment");
    formData.append(
        "prompt",
        "This is a clear, natural conversation. Use proper punctuation and capitalization. Accurately transcribe all words including technical terms."
    );

    const response = await fetch(GROQ_TRANSCRIPTION_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: formData,
    });

    if (!response.ok) {
        const errBody = await response.text();
        let msg = `HTTP ${response.status}`;
        try {
            msg = JSON.parse(errBody).error?.message || msg;
        } catch { /* keep status code */ }
        throw new Error(msg);
    }

    return response.json();
}

// ── LLM Correction ────────────────────────────────────────
async function correctWithLLM(rawText, apiKey) {
    const response = await fetch(GROQ_CHAT_URL, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: LLM_MODEL,
            temperature: 0,
            messages: [
                {
                    role: "system",
                    content: `You are a speech-to-text post-processor. Take raw transcription and produce clean, accurate text.

Rules:
- Fix grammar, punctuation, and capitalization
- Fix obviously misheard words based on context
- Remove filler words (um, uh, like, you know) unless they add meaning
- Keep the original meaning — do NOT add, remove, or change ideas
- Do NOT summarize — output the FULL corrected text
- Output ONLY the corrected text, no commentary
- Preserve technical terms, names, and numbers exactly`,
                },
                { role: "user", content: rawText },
            ],
        }),
    });

    if (!response.ok) {
        const errBody = await response.text();
        let msg = `LLM HTTP ${response.status}`;
        try {
            msg = JSON.parse(errBody).error?.message || msg;
        } catch { /* keep status code */ }
        throw new Error(msg);
    }

    const data = await response.json();
    const corrected = data.choices?.[0]?.message?.content?.trim();
    if (!corrected) throw new Error("LLM returned empty response");
    return corrected;
}

// ── Waveform ───────────────────────────────────────────────
function setupWaveform(stream) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(stream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 128;
    source.connect(analyser);
    drawWaveform();
}

function drawWaveform() {
    if (!analyser) return;

    const canvas = waveformCanvas;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    function render() {
        animationFrameId = requestAnimationFrame(render);
        analyser.getByteFrequencyData(dataArray);

        const w = rect.width;
        const h = rect.height;
        ctx.clearRect(0, 0, w, h);

        const barCount = 32;
        const barWidth = w / barCount;
        const step = Math.floor(bufferLength / barCount);

        for (let i = 0; i < barCount; i++) {
            const value = dataArray[i * step] / 255;
            const barH = Math.max(2, value * (h - 4));
            const x = i * barWidth;
            const y = (h - barH) / 2;

            const hue = 240 + (i / barCount) * 30;
            ctx.fillStyle = `hsla(${hue}, 80%, 70%, ${0.3 + value * 0.7})`;
            ctx.beginPath();
            ctx.roundRect(x + 1, y, barWidth - 2, barH, 2);
            ctx.fill();
        }
    }
    render();
}

function stopWaveform() {
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    if (audioContext) {
        audioContext.close().catch(() => { });
        audioContext = null;
        analyser = null;
    }
    const ctx = waveformCanvas.getContext("2d");
    ctx.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);
}

// ── Helpers ────────────────────────────────────────────────
function setStatus(text, type) {
    statusEl.textContent = text;
    statusEl.className = "status" + (type ? ` ${type}` : "");
}

function resetUI() {
    if (isRecording) stopRecording();
    isProcessing = false;
    recordBtn.classList.remove("recording", "processing");
    recIcon.textContent = "🎙️";
    setStatus("Ready", "");
    stopWaveform();
    hideToast();
}

function getSupportedMimeType() {
    const types = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
        "audio/mp4",
    ];
    for (const t of types) {
        if (MediaRecorder.isTypeSupported(t)) return t;
    }
    return "";
}

function getExtensionFromMime(mime) {
    const map = {
        "audio/webm": "webm",
        "audio/ogg": "ogg",
        "audio/mp4": "mp4",
        "audio/mpeg": "mp3",
        "audio/wav": "wav",
        "audio/flac": "flac",
    };
    const base = mime.split(";")[0].trim();
    return map[base] || "webm";
}

/** Show a toast notification below the overlay bar */
let toastTimer = null;
function showToast(icon, text) {
    if (!toastEl) return;
    toastEl.querySelector(".toast-icon").textContent = icon;
    toastEl.querySelector(".toast-text").textContent = text;
    toastEl.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => hideToast(), 2500);
}

function hideToast() {
    if (!toastEl) return;
    toastEl.classList.remove("visible");
}
