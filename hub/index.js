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
    const { type, data, profile, saveId } = req.body || {};

    // Only accept the two known payload types — anything else would become a
    // stray capsule key (and 'type' is client-supplied).
    if (type !== 'browser' && type !== 'vscode') {
        console.error(`Rejected: unknown snapshot type "${type}".`);
        return res.status(400).send('Unknown snapshot type');
    }

    // A snapshot tagged with a superseded saveId belongs to an older directive
    // (a new `flow save` landed mid-capture) — don't mix it into this capsule.
    // Clients that don't send saveId are accepted as before.
    if (saveId != null && lastSaveId != null && saveId !== lastSaveId) {
        console.warn(`Rejected: stale saveId ${saveId} (current is ${lastSaveId}).`);
        return res.status(409).send('Stale save directive');
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
        // Every VS Code window reports separately, so store one entry per
        // window, merged by windowId. A new save cycle (different saveId)
        // starts a fresh list — otherwise windows closed since the last save
        // would linger in the capsule forever.
        const entry = (data && typeof data === 'object' && !Array.isArray(data)) ? data : null;
        const hasContent = entry && (
            (Array.isArray(entry.openFiles) && entry.openFiles.length > 0) ||
            entry.activeFile || entry.projectRoot
        );
        if (!hasContent) {
            console.warn('Empty vscode capture ignored; keeping existing data.');
        } else {
            const cycleId = saveId != null ? saveId : lastSaveId;
            const windowId = entry.windowId != null ? entry.windowId : 'unknown';
            let windows = (capsule.vscodeSaveId === cycleId && Array.isArray(capsule.vscode))
                ? capsule.vscode
                : [];
            windows = windows.filter(w => (w.windowId != null ? w.windowId : 'unknown') !== windowId);
            windows.push({ ...entry, windowId });
            capsule.vscode = windows;
            capsule.vscodeSaveId = cycleId;
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

    // Do NOT lower shouldSave here even when both types have reported: several
    // VS Code windows share one poll cycle, and dropping the flag after the
    // first one would make the others (polling up to 2s later) miss the save.
    // Clients dedupe by saveId, so leaving the flag up until the grace timer
    // expires can't cause double-saves.
    if (checklist.vscode && checklist.browser) {
        console.log(`Both client types synced for ${activeCapsule}.`);
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