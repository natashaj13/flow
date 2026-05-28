const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const app = express();

app.use(express.json());

const CAPSULE_DIR = path.join(os.homedir(), '.flow_capsules');

if (!fs.existsSync(CAPSULE_DIR)) {
    fs.mkdirSync(CAPSULE_DIR, { recursive: true });
}

let activeCapsule = 'default';
let activeSummary = null; 
let checklist = { vscode: false, browser: false };
let lastSaveId = null;
let shouldSave = false;

app.get('/', (req, res) => {
    res.send('Hub is alive');
});

// Endpoint triggered instantly by 'flow save'
app.post('/set-active', (req, res) => {
    activeCapsule = req.body.name;
    activeSummary = req.body.summary; 
    checklist = { vscode: false, browser: false };    
    lastSaveId = Date.now();
    shouldSave = true; 
    console.log(`Active Capsule: ${activeCapsule} | Summary: ${activeSummary}`);
    
    // --- FIX: Instantly write the base file to disk so 'flow list' sees it immediately ---
    const filePath = path.join(CAPSULE_DIR, `${activeCapsule}.json`);
    
    // Load existing data if it exists, otherwise start fresh
    let capsule = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath)) : {};
    
    capsule.name = activeCapsule;
    capsule.summary = activeSummary || "No summary provided.";
    capsule.lastUpdated = new Date().toISOString();
    
    // Write it to disk right now!
    fs.writeFileSync(filePath, JSON.stringify(capsule, null, 2));
    // -----------------------------------------------------------------------------------

    return res.status(200).json({ success: true });
});

app.get('/check-save', (req, res) => {
    res.json({ 
        shouldSave: shouldSave, 
        name: activeCapsule,
        saveId: lastSaveId 
    });
});

app.post('/snapshot', (req, res) => {
    const { type, data } = req.body;
    
    if (!activeCapsule || activeCapsule === 'undefined') {
        console.error("Rejected: No active capsule name set.");
        return res.status(400).json({ error: "No active capsule set" });
    }

    const filePath = path.join(CAPSULE_DIR, `${activeCapsule}.json`);

    let capsule = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath)) : {};
    
    capsule.name = activeCapsule;
    capsule.summary = activeSummary || "No summary provided.";
    capsule[type] = data; // Updates 'vscode' or 'browser' data inside the file safely
    capsule.lastUpdated = new Date().toISOString();
    
    fs.writeFileSync(filePath, JSON.stringify(capsule, null, 2));
    console.log(`Saved ${type} data to ${activeCapsule}`);

    if (checklist.hasOwnProperty(type)) {
        checklist[type] = true;
    }

    if (checklist.vscode && checklist.browser) {
        shouldSave = false; 
    }
    
    return res.status(200).json({ success: true });
});

app.delete('/clear/:name', (req, res) => {
    const capsuleName = req.params.name;
    const filePath = path.join(CAPSULE_DIR, `${capsuleName}.json`);
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath); 
        res.status(200).send(`Capsule ${capsuleName} cleared.`);
    } else {
        res.status(404).send('Capsule not found.');
    }
});

const PORT_FILE = path.join(os.homedir(), '.flow_port');
const PORT = process.env.PORT || 7382;

app.listen(PORT, () => {
    fs.writeFileSync(PORT_FILE, PORT.toString());
    console.log(`Hub locked to port ${PORT}`);
});