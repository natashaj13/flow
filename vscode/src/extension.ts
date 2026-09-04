import * as vscode from 'vscode';
import axios from 'axios';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { execFile } from 'child_process';

// Each VS Code window runs its own extension host, so every window has its own
// copy of this extension. This id lets the hub merge snapshots from all windows
// instead of letting the last one to report overwrite the rest.
const WINDOW_ID = crypto.randomUUID();

let cachedPort: string | null = null;

function getHubUrl() {
    if (cachedPort) return `http://localhost:${cachedPort}`;

    const portFile = path.join(os.homedir(), '.flow_port');
    if (fs.existsSync(portFile)) {
        cachedPort = fs.readFileSync(portFile, 'utf8').trim();
        return `http://localhost:${cachedPort}`;
    }
    return 'http://localhost:7382'; // Default
}

// The VS Code API has no "is this window minimized?" signal, so on macOS we ask
// the OS via System Events. Requires the Accessibility permission; every failure
// path (no permission, timeout, other platform) fails OPEN — the window is
// treated as visible and saved, because including a minimized window is
// harmless while dropping a visible one loses work.
const LIST_WINDOWS_SCRIPT = `
on run argv
  set procName to item 1 of argv
  set out to ""
  tell application "System Events"
    if not (exists process procName) then return out
    tell process procName
      repeat with w in windows
        try
          if value of attribute "AXMinimized" of w then
            set out to out & "M\\t" & name of w & "\\n"
          else
            set out to out & "V\\t" & name of w & "\\n"
          end if
        end try
      end repeat
    end tell
  end tell
  return out
end run`;

function listWindowTitles(): Promise<{ minimized: string[]; visible: string[] } | null> {
    return new Promise(resolve => {
        // "Visual Studio Code" runs as the process "Code" ("Code - Insiders" for
        // Insiders); forks like Cursor use their app name as the process name.
        const procName = vscode.env.appName.replace(/^Visual Studio\s+/, '');
        execFile('osascript', ['-e', LIST_WINDOWS_SCRIPT, procName], { timeout: 3000 }, (err, stdout) => {
            if (err) return resolve(null);
            const minimized: string[] = [];
            const visible: string[] = [];
            for (const line of stdout.split('\n')) {
                if (line.startsWith('M\t')) minimized.push(line.slice(2));
                else if (line.startsWith('V\t')) visible.push(line.slice(2));
            }
            resolve({ minimized, visible });
        });
    });
}

async function isThisWindowMinimized(): Promise<boolean> {
    if (vscode.window.state.focused) return false; // focused ⇒ not minimized
    if (process.platform !== 'darwin') return false;

    // With default window.title settings the OS title contains the active file's
    // basename and the workspace name — enough to recognize our own window.
    const tokens: string[] = [];
    if (vscode.workspace.name) tokens.push(vscode.workspace.name);
    const doc = vscode.window.activeTextEditor?.document;
    if (doc && doc.uri.scheme === 'file') tokens.push(path.basename(doc.fileName));
    if (tokens.length === 0) return false;

    const titles = await listWindowTitles();
    if (!titles) return false;

    const matches = (t: string) => tokens.every(tok => t.includes(tok));
    // Only skip when a minimized title matches and no visible title does — if
    // both match (e.g. two same-named folders open), save rather than risk
    // excluding a visible window.
    return titles.minimized.some(matches) && !titles.visible.some(matches);
}

export function activate(context: vscode.ExtensionContext) {
    console.log("🚀 FLOW EXTENSION IS STARTING...");

    // The "flow save" command is declared in package.json — register it so the
    // Command Palette entry actually works instead of throwing "command not found".
    // It kicks off a save through the hub (same path as the `flow save` CLI).
    context.subscriptions.push(
        vscode.commands.registerCommand('vscode.snapshot', async () => {
            const name = await vscode.window.showInputBox({
                prompt: 'Flow: name this capsule',
                placeHolder: 'my-capsule'
            });
            if (!name || !name.trim()) return;
            try {
                await axios.post(`${getHubUrl()}/set-active`, { name: name.trim() }, { timeout: 5000 });
                vscode.window.setStatusBarMessage(`✅ Flow: saving "${name.trim()}"…`, 3000);
            } catch (e) {
                cachedPort = null; // force re-discovery next time
                vscode.window.showErrorMessage('Flow: could not reach the hub. Is it running? (try `flow save <name>`)');
            }
        })
    );

    let lastProcessedId: number | null = null;
    let processingId: number | null = null;
    let ticking = false;

    // Every window polls — the hub merges per-window and clients dedupe by
    // saveId, so unfocused windows must NOT be filtered out here.
    const timer = setInterval(async () => {
        if (ticking) return; // never stack requests if the hub or a save is slow
        ticking = true;

        const DYNAMIC_HUB_URL = getHubUrl();

        try {
            const res = await axios.get(`${DYNAMIC_HUB_URL}/check-save`, { timeout: 1500 });
            const { shouldSave, saveId } = res.data;

            if (shouldSave && saveId !== lastProcessedId && saveId !== processingId) {
                processingId = saveId;
                try {
                    if (await isThisWindowMinimized()) {
                        console.log(`🪟 Window minimized — skipping save ${saveId}.`);
                    } else {
                        console.log(`📥 Valid directive caught! Saving state to Hub via ${DYNAMIC_HUB_URL}...`);
                        // Only mark this directive as done once the submit
                        // succeeds — else a transient failure would be
                        // swallowed and never retried.
                        await captureAndSubmit(DYNAMIC_HUB_URL, saveId);
                    }
                    lastProcessedId = saveId;
                } finally {
                    if (processingId === saveId) processingId = null;
                }
            }
        } catch (e) {
            if (cachedPort) {
                console.log(`❌ Hub lost at port ${cachedPort}. Dropping cache to trigger re-discovery...`);
            }
            cachedPort = null;
        } finally {
            ticking = false;
        }
    }, 2000);

    context.subscriptions.push({ dispose: () => clearInterval(timer) });
}

async function captureAndSubmit(url: string, saveId: number) {
    // Real files only — untitled buffers and virtual documents can't be
    // reopened from a path at restore time. Dedupe: the same file can appear
    // in several editor groups.
    const seen = new Set<string>();
    const openFiles: string[] = [];
    for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
            if (tab.input instanceof vscode.TabInputText && tab.input.uri.scheme === 'file') {
                const p = tab.input.uri.fsPath;
                if (!seen.has(p)) {
                    seen.add(p);
                    openFiles.push(p);
                }
            }
        }
    }

    const doc = vscode.window.activeTextEditor?.document;
    const activeFile = doc && doc.uri.scheme === 'file' ? doc.fileName : undefined;
    const projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    // An empty window (no folder, no files) has nothing worth restoring, and
    // submitting it would only add noise to the capsule.
    if (openFiles.length === 0 && !activeFile && !projectRoot) {
        console.log('Nothing to save in this window; skipping.');
        return;
    }

    const payload = {
        type: 'vscode', // So the Hub knows where to put it in the JSON
        saveId,         // Lets the hub group windows into one save cycle
        data: {
            windowId: WINDOW_ID,
            focused: vscode.window.state.focused,
            openFiles,
            activeFile,
            projectRoot
        }
    };

    await axios.post(`${url}/snapshot`, payload, { timeout: 5000 });
    vscode.window.setStatusBarMessage("✅ Flow: Auto-Saved!", 3000);
}
