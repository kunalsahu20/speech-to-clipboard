/**
 * api-key.js — API key prompt and input window.
 *
 * Handles the dialog flow for setting/updating the Groq API key,
 * including the mini settings window with a password input.
 */

const { BrowserWindow, dialog, ipcMain } = require("electron");
const path = require("path");

/**
 * Shows a message box asking the user if they want to set/update their API key.
 * If confirmed, opens the key input window.
 *
 * @param {Function} getStore - Async function returning the electron-store instance
 * @param {Function} refreshTray - Callback to rebuild tray menu after key change
 */
async function promptForApiKey(getStore, refreshTray) {
    const s = await getStore();
    const currentKey = s.get("groqApiKey") || "";

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
        await showApiKeyInputWindow(getStore, refreshTray);
    }
}

/**
 * Opens a small BrowserWindow with a password input field for the API key.
 * Resolves when the window is closed (whether saved or cancelled).
 *
 * @param {Function} getStore - Async function returning the electron-store instance
 * @param {Function} refreshTray - Callback to rebuild tray menu after key change
 */
function showApiKeyInputWindow(getStore, refreshTray) {
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
                preload: path.join(__dirname, "..", "preload.js"),
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

        const handler = async (_event, key) => {
            if (key && key.trim()) {
                const s = await getStore();
                s.set("groqApiKey", key.trim());
                await refreshTray();
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

module.exports = { promptForApiKey };
