/**
 * preload.js — Secure bridge between main and renderer processes.
 * Exposes only the specific IPC methods the overlay needs.
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
    /** Send corrected text to main process for paste-at-cursor */
    pasteText: (text) => ipcRenderer.invoke("paste-text", text),

    /** Get the stored Groq API key */
    getApiKey: () => ipcRenderer.invoke("get-api-key"),

    /** Hide the overlay window */
    hideOverlay: () => ipcRenderer.send("hide-overlay"),

    /** Save API key (from key input window) */
    saveApiKey: (key) => ipcRenderer.send("save-api-key", key),

    /** Close the key input window */
    closeKeyWindow: () => ipcRenderer.send("close-key-window"),

    /**
     * Listen for UI reset command from main process.
     * Removes previous listeners before registering to prevent stacking.
     */
    onResetUI: (callback) => {
        ipcRenderer.removeAllListeners("reset-ui");
        ipcRenderer.on("reset-ui", () => callback());
    },
});
