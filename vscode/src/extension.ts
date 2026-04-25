import * as vscode from 'vscode';
import axios from 'axios';

export function activate(context: vscode.ExtensionContext) {
    const HUB_URL = 'http://localhost:3000';

    // Check for the "Save Flag" every 2 seconds
    setInterval(async () => {
        try {
            const res = await axios.get(`${HUB_URL}/check-save`);
            if (res.data.shouldSave) {
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