/**
 * main.js — Electron Main Process
 *
 * Responsibilities:
 * - System tray icon with context menu
 * - Global shortcut (Ctrl+Shift+Space) to toggle overlay
 * - Frameless always-on-top overlay window
 * - IPC: paste text at cursor via clipboard + PowerShell SendKeys
 * - API key storage via electron-store
 */

const {
    app,
    BrowserWindow,
    Tray,
    Menu,
    globalShortcut,
    ipcMain,
    clipboard,
    nativeImage,
    dialog,
    screen,
} = require("electron");
const path = require("path");
const { exec } = require("child_process");
const crypto = require("crypto");

// Lazy-load electron-store (ESM module)
let store = null;
async function getStore() {
    if (!store) {
        const Store = (await import("electron-store")).default;
        /**
         * Derive encryption key from machine identity rather than hardcoding.
         * This ensures the store is tied to this machine and no secret
         * leaks into source code.
         */
        const machineId = `${require("os").hostname()}-${require("os").userInfo().username}`;
        const derivedKey = crypto.createHash("sha256").update(machineId).digest("hex");
        try {
            store = new Store({ encryptionKey: derivedKey });
            // Force a read to verify data is decryptable
            store.get("groqApiKey");
        } catch (err) {
            console.warn("[SpeechToCursor] Config corrupt, creating fresh store:", err.message);
            // Delete corrupt config and recreate
            const configPath = app.getPath("userData");
            const fs = require("fs");
            const configFile = path.join(configPath, "config.json");
            try { fs.unlinkSync(configFile); } catch { /* file may not exist */ }
            store = new Store({ encryptionKey: derivedKey });
        }
    }
    return store;
}

// ── State ──────────────────────────────────────────────────
let tray = null;
let overlayWindow = null;
let isOverlayVisible = false;
let targetWindowHandle = null;
const SHORTCUT = "Alt+.";
const OVERLAY_WIDTH = 520;
const OVERLAY_HEIGHT = 140;

// ── Single Instance Lock ───────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
}

// ── App Ready ──────────────────────────────────────────────
app.whenReady().then(async () => {
    // Hide dock icon on macOS (irrelevant on Windows but good practice)
    if (process.platform === "darwin") {
        app.dock.hide();
    }

    await createTray();
    createOverlayWindow();
    registerShortcut();

    console.log(`[SpeechToCursor] Ready. Press ${SHORTCUT} to activate.`);
});

// ── Tray ───────────────────────────────────────────────────
async function createTray() {
    const iconPath = path.join(__dirname, "assets", "tray-icon.png");
    let trayIcon;

    try {
        trayIcon = nativeImage.createFromPath(iconPath);
        // Resize for tray (16x16 on Windows)
        trayIcon = trayIcon.resize({ width: 16, height: 16 });
    } catch {
        // Fallback: create a simple colored square if icon not found
        trayIcon = nativeImage.createEmpty();
    }

    tray = new Tray(trayIcon);
    tray.setToolTip("Speech to Cursor");

    const s = await getStore();
    let hasKey = false;
    try {
        hasKey = Boolean(s.get("groqApiKey"));
    } catch (err) {
        // Old data encrypted with different key — clear and start fresh
        console.warn("[SpeechToCursor] Store decryption failed, resetting:", err.message);
        s.clear();
    }

    const contextMenu = Menu.buildFromTemplate([
        {
            label: hasKey ? "✅ API Key Set" : "⚠️ Set API Key",
            click: () => promptForApiKey(),
        },
        { type: "separator" },
        {
            label: `Activate (${SHORTCUT})`,
            click: () => toggleOverlay(),
        },
        { type: "separator" },
        {
            label: "Quit",
            click: () => {
                app.isQuitting = true;
                app.quit();
            },
        },
    ]);

    tray.setContextMenu(contextMenu);

    tray.on("double-click", () => {
        toggleOverlay();
    });

    // Prompt for API key on first launch
    if (!hasKey) {
        promptForApiKey();
    }
}

// ── API Key Prompt ─────────────────────────────────────────
async function promptForApiKey() {
    const s = await getStore();
    const currentKey = s.get("groqApiKey") || "";

    // Use a simple input dialog
    const result = await dialog.showMessageBox({
        type: "question",
        title: "Groq API Key",
        message: "Enter your Groq API key:",
        detail: currentKey
            ? "A key is already saved. Enter a new one to replace it, or click Cancel."
            : "Get your key from console.groq.com/keys",
        buttons: ["Cancel", "Save"],
        defaultId: 1,
        cancelId: 0,
    });

    if (result.response === 1) {
        // Since showMessageBox doesn't have an input field,
        // we'll use a mini window for input
        await showApiKeyInputWindow();
    }
}

function showApiKeyInputWindow() {
    return new Promise((resolve) => {
        const keyWin = new BrowserWindow({
            width: 450,
            height: 200,
            resizable: false,
            minimizable: false,
            maximizable: false,
            alwaysOnTop: true,
            title: "Set Groq API Key",
            webPreferences: {
                preload: path.join(__dirname, "preload.js"),
                contextIsolation: true,
                nodeIntegration: false,
            },
        });

        keyWin.setMenuBarVisibility(false);

        const html = `<!DOCTYPE html>
<html><head>
<style>
  body { font-family: "Segoe UI", sans-serif; background: #1a1a2e; color: #e4e4e7; padding: 24px; margin: 0; }
  h3 { margin: 0 0 12px; font-size: 15px; font-weight: 600; }
  input { width: 100%; padding: 10px; border-radius: 8px; border: 1px solid #333; background: #0d0d1a; color: #e4e4e7; font-size: 14px; box-sizing: border-box; outline: none; }
  input:focus { border-color: #6366f1; }
  .btn-row { display: flex; gap: 8px; margin-top: 16px; justify-content: flex-end; }
  button { padding: 8px 20px; border-radius: 8px; border: none; cursor: pointer; font-size: 13px; font-weight: 600; }
  .save { background: #6366f1; color: white; }
  .save:hover { background: #4f46e5; }
  .cancel { background: #333; color: #aaa; }
  .hint { font-size: 11px; color: #666; margin-top: 8px; }
</style>
</head><body>
  <h3>🔑 Groq API Key</h3>
  <input type="password" id="key" placeholder="gsk_xxxxxxxxxxxxxxxxxxxxxxxx" autofocus />
  <p class="hint">Get yours at console.groq.com/keys</p>
  <div class="btn-row">
    <button class="cancel" onclick="window.electronAPI.closeKeyWindow()">Cancel</button>
    <button class="save" onclick="window.electronAPI.saveApiKey(document.getElementById('key').value)">Save</button>
  </div>
</body></html>`;

        keyWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

        // Listen for save from this window
        const handler = async (_event, key) => {
            if (key && key.trim()) {
                const s = await getStore();
                s.set("groqApiKey", key.trim());
                // Rebuild tray menu to show ✅
                await createTray();
            }
            keyWin.close();
        };

        ipcMain.once("save-api-key", handler);
        ipcMain.once("close-key-window", () => keyWin.close());

        keyWin.on("closed", () => {
            ipcMain.removeListener("save-api-key", handler);
            resolve();
        });
    });
}

// ── Overlay Window ─────────────────────────────────────────
function createOverlayWindow() {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth } = primaryDisplay.workAreaSize;

    overlayWindow = new BrowserWindow({
        width: OVERLAY_WIDTH,
        height: OVERLAY_HEIGHT,
        x: Math.round((screenWidth - OVERLAY_WIDTH) / 2),
        y: 12,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        resizable: false,
        movable: true,
        skipTaskbar: true,
        show: false,
        focusable: true,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            devTools: !app.isPackaged,
        },
    });

    /**
     * Content Security Policy — restricts what the renderer can load.
     * Scoped to overlay only (not the API key input window which uses inline styles).
     */
    overlayWindow.webContents.session.webRequest.onHeadersReceived(
        { urls: ["file://*overlay*"] },
        (details, callback) => {
            callback({
                responseHeaders: {
                    ...details.responseHeaders,
                    "Content-Security-Policy": [
                        "default-src 'self'; " +
                        "script-src 'self'; " +
                        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
                        "font-src https://fonts.gstatic.com; " +
                        "connect-src https://api.groq.com; " +
                        "img-src 'self' data:;"
                    ],
                },
            });
        }
    );

    overlayWindow.loadFile("overlay.html");

    overlayWindow.on("blur", () => {
        // Don't hide while recording — only hide if idle
        if (isOverlayVisible) {
            overlayWindow.webContents.send("check-recording-status");
        }
    });

    overlayWindow.on("close", (e) => {
        if (!app.isQuitting) {
            e.preventDefault();
            hideOverlay();
        }
    });
}

function toggleOverlay() {
    if (isOverlayVisible) {
        hideOverlay();
    } else {
        showOverlay();
    }
}

function showOverlay() {
    if (!overlayWindow) return;

    // Capture the currently focused window BEFORE stealing focus
    captureTargetWindow();

    // Re-center at top of primary display
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth } = primaryDisplay.workAreaSize;

    overlayWindow.setPosition(
        Math.round((screenWidth - OVERLAY_WIDTH) / 2),
        12
    );
    overlayWindow.show();
    overlayWindow.focus();
    isOverlayVisible = true;
}

function hideOverlay() {
    if (!overlayWindow) return;
    overlayWindow.hide();
    isOverlayVisible = false;
    // Reset UI state in renderer
    overlayWindow.webContents.send("reset-ui");
}

// ── Global Shortcut ────────────────────────────────────────
function registerShortcut() {
    const registered = globalShortcut.register(SHORTCUT, () => {
        toggleOverlay();
    });

    if (!registered) {
        console.error(`[SpeechToCursor] Failed to register shortcut: ${SHORTCUT}`);
    }
}

// ── IPC Handlers ───────────────────────────────────────────

// Get API key for the renderer
ipcMain.handle("get-api-key", async () => {
    const s = await getStore();
    return s.get("groqApiKey") || "";
});

// Save API key from the key input window
ipcMain.on("save-api-key", async (_event, key) => {
    // Handled in showApiKeyInputWindow
});

ipcMain.on("close-key-window", () => {
    // Handled in showApiKeyInputWindow
});

/**
 * Paste text at the current cursor position in whatever app is focused.
 *
 * Strategy:
 * 1. Write corrected text to system clipboard
 * 2. Hide our overlay (so the previous app regains focus)
 * 3. Wait a brief moment for focus to settle
 * 4. Simulate Ctrl+V via PowerShell SendKeys
 */
ipcMain.handle("paste-text", async (_event, text) => {
    try {
        // Step 1: Write to clipboard
        clipboard.writeText(text);

        // Step 2: Hide overlay
        hideOverlay();

        // Step 3: Restore focus to the window user was typing in
        await restoreTargetWindow();

        // Step 4: Wait for focus to settle, then simulate paste
        await sleep(150);

        await simulatePaste();

        return { success: true };
    } catch (err) {
        console.error("[SpeechToCursor] Paste error:", err);
        return { success: false, error: err.message };
    }
});

ipcMain.on("hide-overlay", () => {
    hideOverlay();
});

ipcMain.on("recording-status-response", (_event, isRecording) => {
    if (!isRecording && isOverlayVisible) {
        // Safe to hide on blur if not recording
        // (Disabled for now — let user manually dismiss)
    }
});

// ── Paste Simulation ───────────────────────────────────────
/**
 * Uses PowerShell to simulate Ctrl+V in the foreground application.
 * This avoids any native module dependencies (robotjs, nut-js).
 */
function simulatePaste() {
    return new Promise((resolve, reject) => {
        const psCommand =
            "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')";

        exec(
            `powershell -NoProfile -NonInteractive -Command "${psCommand}"`,
            { timeout: 5000 },
            (error) => {
                if (error) {
                    reject(new Error(`SendKeys failed: ${error.message}`));
                } else {
                    resolve();
                }
            }
        );
    });
}

/**
 * Captures the foreground window handle BEFORE the overlay steals focus.
 * This lets us restore focus to the user's target app after transcription.
 */
function captureTargetWindow() {
    try {
        const result = require("child_process").execSync(
            'powershell -NoProfile -NonInteractive -Command "' +
            "Add-Type -MemberDefinition '[DllImport(\\\"user32.dll\\\")] public static extern IntPtr GetForegroundWindow();' " +
            "-Name Win32 -Namespace Temp -PassThru | Out-Null; " +
            '[Temp.Win32]::GetForegroundWindow()"',
            { timeout: 3000 }
        ).toString().trim();
        targetWindowHandle = result;
        console.log("[SpeechToCursor] Captured target window:", targetWindowHandle);
    } catch (err) {
        console.warn("[SpeechToCursor] Could not capture window handle:", err.message);
        targetWindowHandle = null;
    }
}

/**
 * Restores focus to the window the user was typing in before the overlay appeared.
 */
function restoreTargetWindow() {
    return new Promise((resolve) => {
        if (!targetWindowHandle) {
            resolve();
            return;
        }
        const psScript =
            "Add-Type -MemberDefinition '[DllImport(\\\"user32.dll\\\")] public static extern bool SetForegroundWindow(IntPtr hWnd);' " +
            "-Name Win32 -Namespace Temp2 -PassThru | Out-Null; " +
            `[Temp2.Win32]::SetForegroundWindow([IntPtr]${targetWindowHandle})`;

        exec(
            `powershell -NoProfile -NonInteractive -Command "${psScript}"`,
            { timeout: 3000 },
            (error) => {
                if (error) {
                    console.warn("[SpeechToCursor] Could not restore focus:", error.message);
                }
                resolve();
            }
        );
    });
}

// ── Helpers ────────────────────────────────────────────────
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── App Lifecycle ──────────────────────────────────────────
app.on("will-quit", () => {
    globalShortcut.unregisterAll();
});

app.on("window-all-closed", (e) => {
    // Prevent app from quitting when overlay is hidden
    e.preventDefault();
});
