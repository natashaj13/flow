const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { getTabs } = require('../chrome');
const app = express();
const port = 3000;

app.use(express.json());

// This is where snapshots will live
const SNAPSHOT_DIR = path.join(os.homedir(), '.flow_snapshots');

// Create the directory if it doesn't exist
if (!fs.existsSync(SNAPSHOT_DIR)) {
    fs.mkdirSync(SNAPSHOT_DIR);
}

let currentSnapshot = null;

// 1. CLI triggers a new save — Chrome tabs are grabbed immediately via CDP
app.post('/trigger', async (req, res) => {
    console.log("🚀 Save sequence started...");

    let chromeTabs = null;
    try {
        const tabs = await getTabs();
        chromeTabs = { urls: tabs.map(t => t.url) };
        console.log(chromeTabs);
        
    } catch (err) {
        console.error("⚠️  Could not reach Chrome (is it running with --remote-debugging-port=9222?):", err.message);
    }

    currentSnapshot = {
        timestamp: new Date().toLocaleString(),
        cwd: req.body.cwd,
        vscode: null,
        chrome: chromeTabs
    };

    res.status(200).send({ message: "Hub is recording..." });
});

// 2. VS Code polls to see if it should grab data
app.get('/poll', (req, res) => {
    const needsData = currentSnapshot && !currentSnapshot.vscode;
    res.json({ active: !!needsData });
});

// 3. VS Code submits its open files
app.post('/submit/vscode', (req, res) => {
    if (!currentSnapshot) return res.status(400).send("No active save trigger.");

    console.log(`📥 Received data from vscode`);
    currentSnapshot.vscode = req.body;

    const filename = `flow_${Date.now()}.json`;
    const savePath = path.join(SNAPSHOT_DIR, filename);

    fs.writeFileSync(savePath, JSON.stringify(currentSnapshot, null, 2));
    console.log(`✅ Snapshot saved: ${filename}`);
    currentSnapshot = null;

    res.sendStatus(200);
});

app.listen(port, () => {
    console.log(`📡 Flow Hub Online: http://localhost:${port}`);
    console.log(`📂 Snapshots stored in: ${SNAPSHOT_DIR}`);
});