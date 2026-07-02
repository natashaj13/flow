const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer } = require('ws');

const app = express();
// Default limit is 100kb — a heavy browser session (hundreds of tabs across
// several profiles) can exceed that and get silently rejected with a 413.
app.use(express.json({ limit: '25mb' }));

// Path to store your capsules in the user's home directory
const CAPSULE_DIR = path.join(os.homedir(), '.flow_capsules');

// Ensure the directory exists when the server starts
if (!fs.existsSync(CAPSULE_DIR)) {
    fs.mkdirSync(CAPSULE_DIR, { recursive: true });
}

let activeCapsule = 'default';
let activeSummary = null;
let checklist = { vscode: false, browser: false };
let lastSaveId = null;
let shouldSave = false;
let saveGraceTimer = null;

// Reject anything that could escape CAPSULE_DIR (path traversal / separators /
// hidden files). Returns the clean name, or null if it isn't a safe filename.
function sanitizeCapsuleName(name) {
    if (typeof name !== 'string') return null;
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 128) return null;
    if (/[\/\\]/.test(trimmed) || /[\x00-\x1f]/.test(trimmed) || trimmed.includes('..') || trimmed.startsWith('.')) return null;
    return trimmed;
}

app.get('/', (req, res) => {
    res.send('Hub is alive');
});

app.post('/set-active', (req, res) => {
    const name = sanitizeCapsuleName((req.body || {}).name);
    if (!name) {
        console.error(`Rejected invalid capsule name: ${req.body.name}`);
        return res.status(400).send('Invalid capsule name');
    }
    activeCapsule = name;
    activeSummary = req.body.summary;
    checklist = { vscode: false, browser: false };
    lastSaveId = Date.now();
    shouldSave = true;
    console.log(`Active Capsule: ${activeCapsule} (ID: ${lastSaveId})`);

    // A save directive must expire. Otherwise, if only one client (e.g. VS Code)
    // is present, the checklist never completes, shouldSave stays true, and a
    // client that connects much later (e.g. Chrome opened hours afterward) would
    // pick up the stale directive and dump unrelated tabs into this capsule.
    if (saveGraceTimer) clearTimeout(saveGraceTimer);
    saveGraceTimer = setTimeout(() => {
        shouldSave = false;
        saveGraceTimer = null;
        console.log(`Save window for ${activeCapsule} expired.`);
    }, 20000);

    wss.clients.forEach(client => {
        if (client.readyState === 1) { // 1 means OPEN
            client.send(JSON.stringify({ 
                action: 'save', 
                summary: activeSummary || "No summary provided.",
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
        saveId: lastSaveId,
        checklist: checklist
    });
});

app.post('/snapshot', (req, res) => {
    const { type, data, profile } = req.body || {};

    // Only accept the two known payload types — anything else would become a
    // stray capsule key (and 'type' is client-supplied).
    if (type !== 'browser' && type !== 'vscode') {
        console.error(`Rejected: unknown snapshot type "${type}".`);
        return res.status(400).send('Unknown snapshot type');
    }

    if (!activeCapsule || activeCapsule === 'undefined') {
        console.error("Rejected: No active capsule name set.");
        return res.sendStatus(400);
    }

    const filePath = path.join(CAPSULE_DIR, `${activeCapsule}.json`);

    // FIX: Changed 'capsulePath' to 'filePath' (it was crashing here before)
    if (!fs.existsSync(path.dirname(filePath))) {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
    }

    // Load existing or create new. A corrupt/half-written file must not crash the
    // request or throw away this snapshot — start fresh if it won't parse.
    let capsule = {};
    if (fs.existsSync(filePath)) {
        try {
            capsule = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch (e) {
            console.error(`Corrupt capsule ${activeCapsule}, starting fresh: ${e.message}`);
            capsule = {};
        }
    }

    if (type === 'browser') {
        // Each Chrome profile reports independently, so merge by profile instead
        // of overwriting — otherwise the last profile to report wipes the others.
        if (Array.isArray(data) && data.length === 0) {
            console.warn('Empty browser capture ignored; keeping existing data.');
        } else {
            const key = (profile && (profile.gaiaId || profile.email)) || null;
            const profKey = (t) => t.gaiaId || t.email || null;
            const existing = Array.isArray(capsule.browser) ? capsule.browser : [];
            // Drop this profile's previous tabs, keep every other profile's, append fresh.
            const kept = existing.filter(t => profKey(t) !== key);
            capsule.browser = kept.concat(Array.isArray(data) ? data : []);
        }
    } else {
        // Never let an empty capture clobber a previously-good snapshot.
        if (Array.isArray(data) && data.length === 0 && capsule[type]) {
            console.warn(`Empty ${type} capture ignored; keeping existing data.`);
        } else {
            capsule[type] = data;
        }
    }
    capsule.name = activeCapsule;
    capsule.summary = activeSummary || capsule.summary || "No summary provided.";
    capsule.lastUpdated = new Date().toISOString();
    
    // Write atomically: a crash mid-write would otherwise leave a half-written,
    // unparseable capsule. Write to a temp file, then rename (atomic on the same fs).
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(capsule, null, 2));
    fs.renameSync(tmpPath, filePath);
    console.log(`Saved ${type} data to ${activeCapsule}`);

    if (checklist.hasOwnProperty(type)) {
        checklist[type] = true;
        console.log(`[${type}] reported in.`);
    }

    if (checklist.vscode && checklist.browser) {
        console.log(`Both synced for ${activeCapsule}. Cycle complete.`);
        shouldSave = false; // Lower the flag now that we are done
        if (saveGraceTimer) { clearTimeout(saveGraceTimer); saveGraceTimer = null; }
    }
    res.sendStatus(200);
});


app.delete('/clear/:name', (req, res) => {
    const capsuleName = sanitizeCapsuleName(req.params.name);
    if (!capsuleName) {
        return res.status(400).send('Invalid capsule name');
    }
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