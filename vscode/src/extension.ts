import * as vscode from 'vscode';
import axios, { get } from 'axios';
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
    
    let lastProcessedId: number | null = null; 

    setInterval(async () => {
        if (!vscode.window.state.focused) return;
        
        // 1. CRITICAL: Calculate the URL INSIDE the loop
        const DYNAMIC_HUB_URL = getHubUrl(); 
        
        try {
            const res = await axios.get(`${DYNAMIC_HUB_URL}/check-save`);
            const { shouldSave, saveId } = res.data;

            if (shouldSave && saveId !== lastProcessedId) {
                lastProcessedId = saveId;
                console.log(`📥 Valid directive caught! Saving state to Hub via ${DYNAMIC_HUB_URL}...`);
                await captureAndSubmit(DYNAMIC_HUB_URL); // Pass it down so submission hits the right port too
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
            projectRoot: vscode.workspace.workspaceFolders?.[0].uri.fsPath
        }
    };

    await axios.post(`${url}/snapshot`, payload);
    vscode.window.setStatusBarMessage("✅ Flow: Auto-Saved!", 3000);
}