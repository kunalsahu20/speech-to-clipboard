/**
 * main.js — Electron Main Process
 *
 * Responsibilities:
 * - System tray icon with context menu
 * - Global shortcut (Alt+.) to toggle overlay
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
    screen,
} = require("electron");
const path = require("path");
const crypto = require("crypto");

const { captureTargetWindow, restoreTargetWindow, simulatePaste } = require("./src/paste");
const { promptForApiKey } = require("./src/api-key");

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
        trayIcon = trayIcon.resize({ width: 16, height: 16 });
    } catch {
        trayIcon = nativeImage.createEmpty();
    }

    tray = new Tray(trayIcon);
    tray.setToolTip("Speech to Cursor");

    const s = await getStore();
    let hasKey = false;
    try {
        hasKey = Boolean(s.get("groqApiKey"));
    } catch (err) {
        console.warn("[SpeechToCursor] Store decryption failed, resetting:", err.message);
        s.clear();
    }

    const contextMenu = Menu.buildFromTemplate([
        {
            label: hasKey ? "✅ API Key Set" : "⚠️ Set API Key",
            click: () => promptForApiKey(getStore, createTray),
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

    if (!hasKey) {
        promptForApiKey(getStore, createTray);
    }
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

ipcMain.handle("get-api-key", async () => {
    const s = await getStore();
    return s.get("groqApiKey") || "";
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
        clipboard.writeText(text);
        hideOverlay();
        await restoreTargetWindow();
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
