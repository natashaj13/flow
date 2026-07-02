#!/usr/bin/env node
const { program } = require('commander');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
// Briefing pulls in the Google AI SDK. It's an optional feature and isn't wired
// to a command yet, so don't let a missing/broken SDK take down the whole CLI.
let generateBriefing;
try { ({ generateBriefing } = require('./briefing')); } catch (e) { /* optional */ }
const os = require('os');
const pm2 = require('pm2');
const net = require('net');

const port = 7382; // Default port for the Hub

// Where Chrome records the map of profile directory ("Default", "Profile 1", …)
// to the account signed into it. We read this to translate a saved profile's
// email / gaia id into the --profile-directory flag Chrome needs.
function chromeLocalStatePath() {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome', 'Local State');
  }
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data', 'Local State');
  }
  return path.join(os.homedir(), '.config', 'google-chrome', 'Local State');
}

// Build { byGaia: {gaiaId: dir}, byEmail: {email: dir} } from Chrome's Local State.
function loadProfileMap() {
  const map = { byGaia: {}, byEmail: {} };
  try {
    const state = JSON.parse(fs.readFileSync(chromeLocalStatePath(), 'utf8'));
    const cache = (state.profile && state.profile.info_cache) || {};
    for (const [dir, info] of Object.entries(cache)) {
      if (info.gaia_id) map.byGaia[info.gaia_id] = dir;
      if (info.user_name) map.byEmail[info.user_name.toLowerCase()] = dir;
    }
  } catch (e) { /* no Local State (Chrome never run?) — fall back to default profile */ }
  return map;
}

function chromeBinary() {
  if (process.platform === 'darwin') {
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  }
  if (process.platform === 'win32') {
    return path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe');
  }
  return 'google-chrome'; // resolved via PATH
}

// Open one window of URLs in a specific profile. Launching the binary directly
// (rather than `open -n`) routes the window into Chrome's existing instance when
// it's already running, and opens the target profile with no picker.
function launchChromeWindow(dir, urls) {
  if (urls.length === 0) return;
  const args = [];
  if (dir) args.push(`--profile-directory=${dir}`);
  args.push('--new-window', ...urls);
  try {
    const child = spawn(chromeBinary(), args, { detached: true, stdio: 'ignore' });
    // A missing binary surfaces as an async 'error' event, not a sync throw — an
    // unhandled one would crash the whole CLI, so swallow it with a message.
    child.on('error', (e) => console.error(`Failed to launch Chrome: ${e.message}`));
    child.unref();
  } catch (e) {
    console.error(`Failed to launch Chrome: ${e.message}`);
  }
}

// Cap at 7399: the Chrome extension only scans 7382-7399 and its manifest only
// grants host permissions for that range, so a hub above it would be unreachable.
function findAvailablePort(startPort, maxPort = 7399) {
  return new Promise((resolve, reject) => {
    if (startPort > maxPort) {
      return reject(new Error(`No free port available in range 7382-${maxPort}`));
    }
    const server = net.createServer();
    server.unref();
    server.on('error', () => resolve(findAvailablePort(startPort + 1, maxPort)));
    server.listen(startPort, () => {
      server.close(() => resolve(startPort));
    });
  });
}

async function ensureHubIsRunning() {
  return new Promise((resolve, reject) => {
    pm2.connect(async (err) => {
      if (err) return reject("PM2 Connection Error");

      pm2.describe('flow-hub', async (err, desc) => {
        // PEEK: Is it already online?
        if (desc && desc.length > 0 && desc[0].pm2_env.status === 'online') {
          // pm2 doesn't always surface injected env vars under pm2_env.PORT,
          // so prefer the port file the Hub writes on boot; fall back to pm2.
          let existingPort = desc[0].pm2_env.PORT;
          const portFile = path.join(os.homedir(), '.flow_port');
          if (fs.existsSync(portFile)) {
            const filePort = fs.readFileSync(portFile, 'utf8').trim();
            if (filePort) existingPort = filePort;
          }
          existingPort = existingPort || port;
          pm2.disconnect();
          //console.log(`🔗 Connected to existing Hub on port: ${existingPort}`);
          return resolve(existingPort);
        }

        // RECOVERY: If it's stopped/errored or never existed, start it
        //console.log("🚀 Hub is offline. Finding a port and waking it up...");
        try {
          const freePort = await findAvailablePort(7382);
          const hubPath = path.join(__dirname, '../../hub/index.js');

          pm2.start({
            script: hubPath,
            name: 'flow-hub',
            env: { PORT: freePort } // Inject the port into the Hub's process.env
          }, (err) => {
            pm2.disconnect();
            if (err) return reject(err);
            resolve(freePort);
          });
        } catch (e) {
          pm2.disconnect();
          reject(e);
        }
      });
    });
  });
}

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

// Reject names that could read/delete files outside ~/.flow_capsules.
function isValidCapsuleName(name) {
  return typeof name === 'string' && name.length > 0 && name.length <= 128
    && !/[\/\\]/.test(name) && !/[\x00-\x1f]/.test(name)  // no separators / control / null bytes
    && !name.includes('..') && !name.startsWith('.');
}

// Read + parse a capsule file, returning null (with a message) if it's corrupt.
function readCapsule(capsulePath) {
  try {
    return JSON.parse(fs.readFileSync(capsulePath, 'utf8'));
  } catch (e) {
    console.error(`Capsule is unreadable or corrupted: ${e.message}`);
    return null;
  }
}


program.addHelpText('after', `
Save Command Extension:
  flow save <name> -m <summary>   (Summary flag is optional)
`);

program
  .command('save [args...]')
  .description('Snapshot the current workspace')
  .allowUnknownOption()
  .action(async (args) => {
    let name = args[0];

    if (!name) {
      console.error("❌ Error: Please provide a capsule name. Example: flow save my-capsule");
      return;
    }

    name = name.trim(); // Match the hub, which trims before writing the file.

    if (!isValidCapsuleName(name)) {
      console.error(`❌ Error: "${name}" isn't a valid capsule name (no slashes, no "..", no leading dot, keep it under 128 chars).`);
      console.error(`   Tip: quote names with spaces or shell characters, e.g. flow save "my cap"`);
      return;
    }

    let port;
    try {
      port = await ensureHubIsRunning();
    } catch (e) {
      console.error(`❌ Couldn't start the Flow hub: ${e && e.message ? e.message : e}`);
      return;
    }
    const HUB_URL = `http://localhost:${port}/set-active`;

    const rawArgs = process.argv;
    const summaryIndex = rawArgs.indexOf('-m');
    let summaryText = null;

    if (summaryIndex !== -1 && rawArgs[summaryIndex + 1]) {
      summaryText = rawArgs[summaryIndex + 1];
    }

    try {
      let attempts = 0;
      let success = false;
      while (attempts < 3) {
        try {
          const response = await axios.post(HUB_URL, { name, summary: summaryText });
          if (response.status === 200) {
            success = true;
            break; 
          }
        } catch (err) {
          attempts++;
          if (attempts === 3) {
            console.error("Failed to connect");
            return;
          } else {
            await sleep(500); 
          }
        }
      }

      if (success) {
        console.log(`Saving workspace ${name}`);
        // Poll the Hub until both clients have reported in, instead of a blind
        // sleep that could race the VS Code 2s poll interval.
        const STATUS_URL = `http://localhost:${port}/check-save`;
        const deadline = Date.now() + 10000; // 10s max
        let checklist = { vscode: false, browser: false };
        while (Date.now() < deadline) {
          await sleep(500);
          try {
            const { data } = await axios.get(STATUS_URL);
            checklist = data.checklist || checklist;
            if (data.shouldSave === false) break; // Hub lowers this when both are in
          } catch (e) { /* transient; keep polling */ }
        }

        const saved = Object.entries(checklist)
          .filter(([, done]) => done)
          .map(([client]) => client);
        if (saved.length > 0) {
          console.log(`Save complete (${saved.join(', ')})`);
        } else {
          console.log(`Save complete, but no editor/browser reported in — is the VS Code extension or Chrome extension running?`);
        }
      }
    } catch (err) {
      console.error(err);    
    }
  });


program
  .command('load <name>')
  .description('Restore a workspace')
  .action(async (name) => {
    name = name.trim(); // Match the hub, which trims names before writing files.
    if (!isValidCapsuleName(name)) {
      console.error("Invalid capsule name.");
      return;
    }
    const capsulePath = path.join(os.homedir(), `.flow_capsules/${name}.json`);

    if (!fs.existsSync(capsulePath)) {
      console.error("Capsule not found!");
      return;
    }

    const data = readCapsule(capsulePath);
    if (!data) return;

    console.log(`Loading workspace ${name}`);
    console.log(`Summary: ${data.summary || "No summary provided."}`);

    if (data.browser && data.browser.length > 0) {
      // Only http(s) and file URLs can be reopened; chrome://, chrome-extension://,
      // devtools://, about: etc. either fail or are blocked from the command line.
      const isRestorable = (u) => /^(https?|file):/i.test(u);

      const profileMap = loadProfileMap();

      // Group tabs first by the profile they were captured in, then by window,
      // so each profile's windows are recreated in that exact profile.
      const groups = new Map(); // profileKey -> { email, gaiaId, windows: Map(windowId -> urls[]) }
      for (const tab of data.browser) {
        const url = tab.url || tab;
        if (!isRestorable(url)) continue;
        const gaiaId = (tab && tab.gaiaId) || null;
        const email = (tab && tab.email) || null;
        const pKey = gaiaId || email || '__unknown__';
        if (!groups.has(pKey)) groups.set(pKey, { email, gaiaId, windows: new Map() });
        const g = groups.get(pKey);
        const wKey = (tab && tab.windowId != null) ? tab.windowId : 'default';
        if (!g.windows.has(wKey)) g.windows.set(wKey, []);
        g.windows.get(wKey).push(url);
      }

      let total = 0;
      for (const g of groups.values()) {
        // Resolve which on-disk profile directory these tabs belong to.
        let dir = null;
        if (g.gaiaId && profileMap.byGaia[g.gaiaId]) {
          dir = profileMap.byGaia[g.gaiaId];
        } else if (g.email && profileMap.byEmail[g.email.toLowerCase()]) {
          dir = profileMap.byEmail[g.email.toLowerCase()];
        }

        if (!dir) {
          const who = g.email || g.gaiaId;
          if (who) {
            console.warn(`⚠️  Couldn't match profile "${who}" to a local Chrome profile — opening its tabs in Chrome's default profile.`);
          } else {
            console.warn(`⚠️  Some tabs were saved from a profile not signed into Google — opening them in Chrome's default profile.`);
          }
        } else {
          console.log(`Restoring ${g.email || dir} → profile "${dir}"`);
        }

        // Stagger launches so a cold-starting Chrome has time to grab its
        // singleton lock before the next window is requested.
        for (const urls of g.windows.values()) {
          launchChromeWindow(dir, urls);
          total += urls.length;
          await sleep(400);
        }
      }
      if (total > 0) {
        console.log(`Restored ${total} tab(s) across ${groups.size} profile(s)`);
      }
    }

    if (data.vscode && data.vscode.openFiles) {
      const { projectRoot, openFiles } = data.vscode;

      // Pass paths as spawn args (no shell) so a filename like `$(...)` can't be
      // interpreted as a command during restore.
      const codeBin = process.platform === 'win32' ? 'code.cmd' : 'code';
      const args = ['-n'];
      if (projectRoot) args.push(projectRoot);
      if (Array.isArray(openFiles) && openFiles.length > 0) args.push(...openFiles);

      console.log(`Restoring Workspace: ${projectRoot || 'Files only'}`);
      try {
        const child = spawn(codeBin, args, { detached: true, stdio: 'ignore' });
        child.on('error', (e) => console.error(`Failed to launch VS Code (is the 'code' command on your PATH?): ${e.message}`));
        child.unref();
      } catch (e) {
        console.error(`Failed to launch VS Code: ${e.message}`);
      }
    }
  });


program
    .command('list')
    .description('List all saved capsules')
    .action(() => {
        const capsules = path.join(os.homedir(), `.flow_capsules/`);
        if (!fs.existsSync(capsules)) {
            console.log('No capsules saved yet.');
            return;
        }
        const files = fs.readdirSync(capsules).filter(f => f.endsWith('.json'));
        if (files.length === 0) {
            console.log('No capsules saved yet.');
            return;
        }
        files.forEach(f => {
            let data;
            try {
                data = JSON.parse(fs.readFileSync(path.join(capsules, f), 'utf8'));
            } catch (e) {
                console.log(`  ${f.replace('.json', '')}  (unreadable)`);
                return;
            }
            const updated = data.lastUpdated
                ? new Date(data.lastUpdated).toLocaleString()
                : 'unknown';
            console.log(`  ${f.replace('.json', '')}  (last saved: ${updated})`);
        });
    });


program
  .command('clear <name>')
  .description('Delete a saved capsule')
  .action(async (name) => {
    try {
      name = name.trim(); // Match the hub, which trims names before writing files.
      if (!isValidCapsuleName(name)) {
        console.error("Invalid capsule name.");
        return;
      }
      const capsulePath = path.join(os.homedir(), `.flow_capsules/${name}.json`);
      if (!fs.existsSync(capsulePath)) {
        console.error("Capsule not found!");
        return;
      }
      const port = await ensureHubIsRunning();
      const HUB_URL = `http://localhost:${port}`;
      await axios.delete(`${HUB_URL}/clear/${encodeURIComponent(name)}`);
      console.log(`Deleted workspace ${name}`);
    } catch (error) {
      console.error(`Failed to clear capsule: ${error.message}`);
    }
  });


program
  .command('describe <name>')
  .description('Describe a saved capsule')
  .action(async (name) => {
    name = name.trim(); // Match the hub, which trims names before writing files.
    if (!isValidCapsuleName(name)) {
        console.error("Invalid capsule name.");
        return;
    }
    const capsulePath = path.join(os.homedir(), `.flow_capsules/${name}.json`);
    if (!fs.existsSync(capsulePath)) {
        console.error("Capsule not found!");
        return;
    }

    const data = readCapsule(capsulePath);
    if (!data) return;

    const saved = data.lastUpdated
        ? new Date(data.lastUpdated).toLocaleString()
        : 'unknown';
      console.log(`\nCapsule: ${name}  (saved: ${saved})\n`);

      const openFiles = data.vscode?.openFiles || [];
      console.log('VS Code files:');
      if (openFiles.length > 0) {
        openFiles.forEach(f => console.log(`  ${f}`));
      } else {
        console.log('  (none saved)');
      }

      console.log('');
      console.log('Chrome tabs:');
      const tabs = Array.isArray(data.browser) ? data.browser : [];
      if (tabs.length > 0) {
        tabs.forEach(t => {
          const who = (t && t.email) ? `  [${t.email}]` : '';
          console.log(`  ${t.url || t}${who}`);
        });
      } else {
        console.log('  (none saved)');
      }
      console.log('');
      return;
  });

program.parse(process.argv);