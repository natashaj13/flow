import * as vscode from 'vscode';
import axios from 'axios';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

let cachedPort: string | null = null;

function getHubUrl() {
    if (cachedPort) return `http://localhost:${cachedPort}`;

    const portFile = path.join(os.homedir(), '.flow_port');
    console.log(`Looking for Hub port file at: ${portFile}`);
    if (fs.existsSync(portFile)) {
        cachedPort = fs.readFileSync(portFile, 'utf8').trim();
        return `http://localhost:${cachedPort}`;
    }
    return 'http://localhost:7382'; // Default
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
                await axios.post(`${getHubUrl()}/set-active`, { name: name.trim() });
                vscode.window.setStatusBarMessage(`✅ Flow: saving "${name.trim()}"…`, 3000);
            } catch (e) {
                cachedPort = null; // force re-discovery next time
                vscode.window.showErrorMessage('Flow: could not reach the hub. Is it running? (try `flow save <name>`)');
            }
        })
    );

    let lastProcessedId: number | null = null;
    let processingId: number | null = null;

    setInterval(async () => {
        if (!vscode.window.state.focused) return;

        // 1. CRITICAL: Calculate the URL INSIDE the loop
        const DYNAMIC_HUB_URL = getHubUrl();

        try {
            const res = await axios.get(`${DYNAMIC_HUB_URL}/check-save`);
            const { shouldSave, saveId } = res.data;

            if (shouldSave && saveId !== lastProcessedId && saveId !== processingId) {
                processingId = saveId;
                console.log(`📥 Valid directive caught! Saving state to Hub via ${DYNAMIC_HUB_URL}...`);
                try {
                    // Only mark this directive as done once the submit succeeds — else
                    // a transient failure would be swallowed and never retried.
                    await captureAndSubmit(DYNAMIC_HUB_URL);
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
        }
    }, 2000);
}

async function captureAndSubmit(url: string) {
    const tabs = vscode.window.tabGroups.all
        .flatMap(g => g.tabs)
        .filter(t => t.input instanceof vscode.TabInputText)
        .map(t => (t.input as vscode.TabInputText).uri.fsPath);

    const payload = {
        type: 'vscode', // So the Hub knows where to put it in the JSON
        data: {
            openFiles: tabs,
            activeFile: vscode.window.activeTextEditor?.document.fileName,
            // `?.[0]` guards an undefined list but not an empty [], so `.uri`
            // could still throw — chain through `[0]` optionally too.
            projectRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
        }
    };

    await axios.post(`${url}/snapshot`, payload);
    vscode.window.setStatusBarMessage("✅ Flow: Auto-Saved!", 3000);
}