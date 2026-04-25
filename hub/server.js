const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
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

// 1. CLI triggers a new save
app.post('/trigger', (req, res) => {
    console.log("🚀 Save sequence started...");
    currentSnapshot = {
        timestamp: new Date().toLocaleString(),
        cwd: req.body.cwd,
        vscode: null,
        chrome: null
    };
    res.status(200).send({ message: "Hub is recording..." });
});

// 2. Extensions poll to see if they should grab data
app.get('/poll', (req, res) => {
    // Only tell extensions to work if we have a trigger but no data yet
    const needsData = currentSnapshot && (!currentSnapshot.vscode || !currentSnapshot.chrome);
    res.json({ active: !!needsData });
});

// 3. Extensions submit their specific data
app.post('/submit/:source', (req, res) => {
    if (!currentSnapshot) return res.status(400).send("No active save trigger.");

    const source = req.params.source;
    console.log(`📥 Received data from ${source}`);
    currentSnapshot[source] = req.body;

    // CHECK: Do we have both extensions now?
    if (currentSnapshot.vscode && currentSnapshot.chrome) {
        // Generate unique name: flow_1714000000000.json
        const filename = `flow_${Date.now()}.json`;
        const savePath = path.join(SNAPSHOT_DIR, filename);
        
        fs.writeFileSync(savePath, JSON.stringify(currentSnapshot, null, 2));
        console.log(`✅ Snapshot saved: ${filename}`);
        currentSnapshot = null; // Reset
    }

    res.sendStatus(200);
});

app.listen(port, () => {
    console.log(`📡 Flow Hub Online: http://localhost:${port}`);
    console.log(`📂 Snapshots stored in: ${SNAPSHOT_DIR}`);
});