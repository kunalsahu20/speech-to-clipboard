/**
 * paste.js — Window capture, focus restoration, and paste simulation.
 *
 * Uses PowerShell / Win32 API to:
 * 1. Capture the foreground window handle before overlay steals focus
 * 2. Restore focus to that window after transcription
 * 3. Simulate Ctrl+V via SendKeys
 */

const { exec, execSync } = require("child_process");

let targetWindowHandle = null;

/**
 * Captures the foreground window handle BEFORE the overlay steals focus.
 * This lets us restore focus to the user's target app after transcription.
 */
function captureTargetWindow() {
    try {
        const result = execSync(
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

module.exports = { captureTargetWindow, restoreTargetWindow, simulatePaste };
