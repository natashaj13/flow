import * as vscode from 'vscode';
import axios from 'axios';

export function activate(context: vscode.ExtensionContext) {
    // This command ID must match the one in your package.json "contributes" section
    let disposable = vscode.commands.registerCommand('vscode-ext.snapshot', async () => {
        
        // 1. Get all open text document tabs across all editor groups
        const tabs = vscode.window.tabGroups.all
            .flatMap(group => group.tabs)
            .filter(tab => tab.input instanceof vscode.TabInputText)
            .map(tab => (tab.input as vscode.TabInputText).uri.fsPath);

        // 2. Get the specific file currently focused
        const activeFile = vscode.window.activeTextEditor?.document.fileName;

        // 3. Get the workspace root (the project folder)
        const workspaceDir = vscode.workspace.workspaceFolders?.[0].uri.fsPath;

        const payload = {
            type: 'vscode',
            capsuleName: 'debugging-auth-api', // We will make this dynamic later
            data: {
                projectRoot: workspaceDir,
                activeFile: activeFile,
                openFiles: tabs
            }
        };

        try {
            await axios.post('http://localhost:3000/snapshot', payload);
            vscode.window.showInformationMessage('VS Code Snapshot Saved!');
        } catch (error) {
            vscode.window.showErrorMessage('Failed to connect to Flow Hub.');
        }
    });

    context.subscriptions.push(disposable);
}