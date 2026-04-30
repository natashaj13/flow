const express = require('express');
const fs = require('fs');
const path = require('path');
const { filterRelevantTabs } = require('../cli/bin/briefing');
const app = express();
const os = require('os');


app.use(express.json());

app.get('/', (req, res) => {
    res.send('Hub is alive');
});

let activeCapsule = 'default';
let checklist = { vscode: false, browser: false }
let lastSaveId = null; // Use a timestamp to prevent double-saves

app.post('/set-active', (req, res) => {
    activeCapsule = req.body.name;
    checklist = { vscode: false, browser: false };    
    lastSaveId = Date.now(); // Create a unique ID for this specific save command
    console.log(`Active Capsule: ${activeCapsule} (ID: ${lastSaveId})`);
    res.sendStatus(200);
});

app.get('/check-save', (req, res) => {
    const shouldSave = !checklist.vscode || !checklist.browser;

    res.json({ 
        shouldSave: shouldSave, 
        name: activeCapsule,
        saveId: lastSaveId 
    });
});

app.post('/snapshot', (req, res) => {
    const { type, data } = req.body;
    
    // 1. Guard against undefined names
    if (!activeCapsule || activeCapsule === 'undefined') {
        console.error("❌ Rejected: No active capsule name set.");
        return res.sendStatus(400);
    }

    const filePath = path.join(os.homedir(), `.flow_capsules/${activeCapsule}.json`);

    // 2. Standard Save Logic
    let capsule = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath)) : {};
    capsule[type] = data;
    capsule.lastUpdated = new Date().toISOString();
    fs.writeFileSync(filePath, JSON.stringify(capsule, null, 2));
    
    console.log(`✅ Saved ${type} data to ${activeCapsule}`);

    // 3. The "Lower the Flag" Logic
    // We only turn off the signal once VS Code has reported in
    if (checklist.hasOwnProperty(type)) {
        checklist[type] = true;
        console.log(`✅ [${type}] reported in.`);
    }
    if (checklist.vscode && checklist.browser) {
        console.log(`🏁 Both synced for ${activeCapsule}. Cycle complete.`);
        const updatedCapsule = JSON.parse(fs.readFileSync(filePath));
        //filterRelevantTabs(updatedCapsule, filePath);
    }
    res.sendStatus(200);
});

app.listen(3000, () => console.log('Hub running on http://localhost:3000'));
