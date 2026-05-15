#!/usr/bin/env node
const { program } = require('commander');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { generateBriefing } = require('./briefing');
const os = require('os');
const pm2 = require('pm2');
const net = require('net');

const port = 7382; // Default port for the Hub

function findAvailablePort(startPort) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on('error', () => resolve(findAvailablePort(startPort + 1)));
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
          const existingPort = desc[0].pm2_env.PORT;
          pm2.disconnect();
          //console.log(`🔗 Connected to existing Hub on port: ${existingPort}`);
          return resolve(existingPort);
        }

        // RECOVERY: If it's stopped/errored or never existed, start it
        //console.log("🚀 Hub is offline. Finding a port and waking it up...");
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
      });
    });
  });
}

const sleep = (ms) => new Promise(res => setTimeout(res, ms));


program
  .command('save <name>')
  .description('Snapshot the current workspace')
  .action(async (name) => {
    const port = await ensureHubIsRunning();
    const HUB_URL = `http://localhost:${port}/set-active`;
    try {
      // Try the request up to 3 times
      let attempts = 0;
      while (attempts < 3) {
        try {
          await axios.post(HUB_URL, { name });
          console.log(`✅ Snapshotting ${name}`);
          return; // Success! Exit the function
        } catch (err) {
          attempts++;
          if (attempts === 3) {
            console.error("❌ Failed to reach Hub after 3 attempts. Try running 'pm2 logs flow-hub' to see if it crashed.");
          } else {
            await sleep(500); // Wait a bit before retrying
          }
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
    const capsulePath = path.join(os.homedir(), `.flow_capsules/${name}.json`);
    
    if (!fs.existsSync(capsulePath)) {
      console.error("Capsule not found!");
      return;
    }

    const data = JSON.parse(fs.readFileSync(capsulePath));

    //await generateBriefing(data);

    // Restore Browser Tabs
    if (data.browser) {
      data.browser.forEach(tab => exec(`open "${tab.url}"`, (err) => {
        //if (err) console.error(`Failed to open ${tab.url}:`, err);
      }));
    }

    // Restore VS Code Files
    if (data.vscode && data.vscode.openFiles) {
      // const files = data.vscode.openFiles.map(f => `"${f}"`).join(' ');
      // exec(`code -n ${files}`);
      const { projectRoot, openFiles } = data.vscode;
        
      let command = 'code -n'; // -n for new window

        // Add the folder (Sidebar)
      if (projectRoot) {
          command += ` "${projectRoot}"`;
      }

        // Add the specific files (Tabs)
      if (openFiles && openFiles.length > 0) {
          const files = openFiles.map(f => `"${f}"`).join(' ');
          command += ` ${files}`;
      }

      console.log(`Restoring Workspace: ${projectRoot || 'Files only'}`);
      exec(command);
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
            const data = JSON.parse(fs.readFileSync(path.join(capsules, f), 'utf8'));
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
      const capsulePath = path.join(os.homedir(), `.flow_capsules/${name}.json`);
      if (!fs.existsSync(capsulePath)) {
        console.error("Capsule not found!");
        return;
      }
      const port = await ensureHubIsRunning();
      const HUB_URL = `http://localhost:${port}`;
      await axios.delete(`${HUB_URL}/clear/${name}`);
      console.log(`Deleted workspace ${name}`);
    } catch (error) {
      console.error(`Failed to clear capsule: ${error.message}`);
    }
  });


program
  .command('describe <name>')
  .description('Describe a saved capsule')
  .action(async (name) => {
    const capsulePath = path.join(os.homedir(), `.flow_capsules/${name}.json`);
    if (!fs.existsSync(capsulePath)) {
        console.error("Capsule not found!");
        return;
    }

    const data = JSON.parse(fs.readFileSync(capsulePath));

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
        tabs.forEach(t => console.log(`  ${t.url || t}`));
      } else {
        console.log('  (none saved)');
      }
      console.log('');
      return;
  });

program.parse(process.argv);