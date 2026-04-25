import * as vscode from 'vscode';
import axios from 'axios';

export function activate(context: vscode.ExtensionContext) {
    console.log("🚀 FLOW EXTENSION IS STARTING..."); // Add this
    
    const HUB_URL = 'http://127.0.0.1:3000';
    let lastProcessedId: number | null = null; // Track what we've already saved

    setInterval(async () => {
        try {
            const res = await axios.get(`${HUB_URL}/check-save`);
            const { shouldSave, saveId } = res.data;

            // Only trigger if the flag is UP and this is a NEW save request
            if (shouldSave && saveId !== lastProcessedId) {
                lastProcessedId = saveId;
                await captureAndSubmit();
            }
        } catch (e) { /* Hub offline */ }
    }, 2000);

    async function captureAndSubmit() {
        const tabs = vscode.window.tabGroups.all
            .flatMap(g => g.tabs)
            .filter(t => t.input instanceof vscode.TabInputText)
            .map(t => (t.input as vscode.TabInputText).uri.fsPath);

        const payload = {
            type: 'vscode', // So the Hub knows where to put it in the JSON
            data: {
                openFiles: tabs,
                activeFile: vscode.window.activeTextEditor?.document.fileName
            }
        };

        await axios.post(`${HUB_URL}/snapshot`, payload);
        vscode.window.setStatusBarMessage("✅ Flow: Auto-Saved!", 3000);
    }
}