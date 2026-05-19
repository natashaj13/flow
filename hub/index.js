const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer } = require('ws');

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

    wss.clients.forEach(client => {
        if (client.readyState === 1) { // 1 means OPEN
            client.send(JSON.stringify({ 
                action: 'save', 
                name: activeCapsule, 
                saveId: lastSaveId 
            }));
        }
    });
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
        console.error("Rejected: No active capsule name set.");
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
    console.log(`Saved ${type} data to ${activeCapsule}`);

    if (checklist.hasOwnProperty(type)) {
        checklist[type] = true;
        console.log(`[${type}] reported in.`);
    }

    if (checklist.vscode && checklist.browser) {
        console.log(`Both synced for ${activeCapsule}. Cycle complete.`);
        shouldSave = false; // Lower the flag now that we are done
    }
    res.sendStatus(200);
});


app.delete('/clear/:name', (req, res) => {
    const capsuleName = req.params.name;
    console.log(`Attempting to delete capsule: ${capsuleName}`);
    const filePath = path.join(CAPSULE_DIR, `${capsuleName}.json`);
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath); // Deletes the file
        console.log(`Deleted capsule: ${capsuleName}`);
        res.status(200).send(`Capsule ${capsuleName} cleared.`);
    } else {
        console.error(`${capsuleName} not found.`);
        res.status(404).send('Capsule not found.');
    }
});

const PORT_FILE = path.join(os.homedir(), '.flow_port');

const PORT = process.env.PORT || 7382;

// 3. Capture the HTTP server instance from app.listen
const server = app.listen(PORT, () => {
    fs.writeFileSync(PORT_FILE, PORT.toString());
    console.log(`Hub locked to port ${PORT}`);
});

// 4. Attach WebSocket server to the exact same HTTP instance
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
    console.log('🌐 Browser extension linked via WebSocket stream');

    // Keep-alive heartbeat loop every 20 seconds to prevent Chrome from sleeping
    const pingInterval = setInterval(() => {
        if (ws.readyState === ws.OPEN) {
            ws.ping();
        }
    }, 20000);

    ws.on('close', () => clearInterval(pingInterval));
});