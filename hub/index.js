const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const app = express();

app.use(express.json());

// Path to store your capsules in the user's home directory
const CAPSULE_DIR = path.join(os.homedir(), '.flow_capsules');

// Ensure the directory exists when the server starts
if (!fs.existsSync(CAPSULE_DIR)) {
    fs.mkdirSync(CAPSULE_DIR, { recursive: true });
}

let activeCapsule = 'default';
let checklist = { vscode: false, browser: false };
let lastSaveId = null;
let shouldSave = false;

app.get('/', (req, res) => {
    res.send('Hub is alive');
});

app.post('/set-active', (req, res) => {
    activeCapsule = req.body.name;
    checklist = { vscode: false, browser: false };    
    lastSaveId = Date.now();
    shouldSave = true; 
    console.log(`Active Capsule: ${activeCapsule} (ID: ${lastSaveId})`);
    res.sendStatus(200);
});

app.get('/check-save', (req, res) => {
    // FIX: Removed the 'const' that was re-declaring shouldSave locally
    // We want to return the global state
    res.json({ 
        shouldSave: shouldSave, 
        name: activeCapsule,
        saveId: lastSaveId 
    });
});

app.post('/snapshot', (req, res) => {
    const { type, data } = req.body;
    
    if (!activeCapsule || activeCapsule === 'undefined') {
        console.error("❌ Rejected: No active capsule name set.");
        return res.sendStatus(400);
    }

    const filePath = path.join(CAPSULE_DIR, `${activeCapsule}.json`);

    // FIX: Changed 'capsulePath' to 'filePath' (it was crashing here before)
    if (!fs.existsSync(path.dirname(filePath))) {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
    }

    // Load existing or create new
    let capsule = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath)) : {};
    
    capsule[type] = data;
    capsule.lastUpdated = new Date().toISOString();
    
    fs.writeFileSync(filePath, JSON.stringify(capsule, null, 2));
    console.log(`✅ Saved ${type} data to ${activeCapsule}`);

    if (checklist.hasOwnProperty(type)) {
        checklist[type] = true;
        console.log(`✅ [${type}] reported in.`);
    }

    if (checklist.vscode && checklist.browser) {
        console.log(`🏁 Both synced for ${activeCapsule}. Cycle complete.`);
        shouldSave = false; // Lower the flag now that we are done
    }
    res.sendStatus(200);
});

const PORT_FILE = path.join(os.homedir(), '.flow_port');

const PORT = process.env.PORT || 7382;

app.listen(PORT, () => {
    // Write the port to the system so CLI and VS Code can see it
    fs.writeFileSync(PORT_FILE, PORT.toString());
    console.log(`Hub locked to port ${PORT}`);
});