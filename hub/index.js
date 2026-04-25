const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();

app.use(express.json());

app.get('/', (req, res) => {
    res.send('Hub is alive and listening on port 3000!');
});

let activeCapsule = 'default';
let shouldSave = false; // The flag

app.post('/set-active', (req, res) => {
    activeCapsule = req.body.name;
    console.log(`🎯 Active: ${activeCapsule}`);
    res.sendStatus(200);
});

// CLI calls this to raise the flag
app.post('/request-save', (req, res) => {
    shouldSave = true;
    res.sendStatus(200);
});

// Extension calls this every 2 seconds to check the flag
app.get('/check-save', (req, res) => {
    res.json({ shouldSave: shouldSave });
});

// This endpoint collects data from Chrome or VS Code
app.post('/snapshot', (req, res) => {
    const { type, data, capsuleName } = req.body;
    const filePath = path.join(__dirname, `../shared/capsules/${capsuleName}.json`);

    // Ensure the shared directory exists
    if (!fs.existsSync(path.join(__dirname, '../shared/capsules'))) {
        fs.mkdirSync(path.join(__dirname, '../shared/capsules'), { recursive: true });
    }

    // Read existing data or start fresh
    let capsule = {};
    if (fs.existsSync(filePath)) {
        capsule = JSON.parse(fs.readFileSync(filePath));
    }

    // Update the capsule with new data (browser or vscode)
    capsule[type] = data;
    capsule.lastUpdated = new Date().toISOString();

    fs.writeFileSync(filePath, JSON.stringify(capsule, null, 2));
    console.log(`Saved ${type} data to ${capsuleName}`);
    shouldSave = false; // Reset the flag after saving
    res.sendStatus(200);
});

app.listen(3000, () => console.log('Hub running on http://localhost:3000'));