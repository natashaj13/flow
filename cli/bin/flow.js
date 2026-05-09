#!/usr/bin/env node
const { program } = require('commander');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { generateBriefing } = require('./briefing');
const os = require('os');
const pm2 = require('pm2');

async function ensureHubIsRunning() {
  return new Promise((resolve, reject) => {
    pm2.connect((err) => {
      if (err) {
        console.error("Could not connect to PM2 manager");
        process.exit(2);
      }

      // Check if the process 'flow-hub' is already running
      pm2.describe('flow-hub', (err, processDescription) => {
        if (err || processDescription.length === 0 || processDescription[0].pm2_env.status !== 'online') {
          console.log("Starting Flow Hub in background...");
          
          // Start the hub (point this to your hub's index.js)
          const hubPath = path.join(__dirname, '../../hub/index.js');
          
          pm2.start({
            script: hubPath,
            name: 'flow-hub',
            autorestart: true, // Re-wakes if it crashes
            watch: false      // Don't watch files in production
          }, (err, apps) => {
            pm2.disconnect();   // Disconnect from PM2 after starting
            if (err) reject(err);
            resolve();
          });
        } else {
          // Already running!
          pm2.disconnect();
          resolve();
        }
      });
    });
  });
}

program
  .command('save <name>')
  .description('Snapshot the current workspace')
  .action(async (name) => {
    await ensureHubIsRunning();
    console.log(`Saving workspace ${name}`);
    try {
      // 1. Set the active name and save flag
      await axios.post('http://localhost:3000/set-active', { name });
      
      //console.log(`✅ Signal sent! VS Code should save automatically in a second.`);
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
      data.browser.forEach(tab => exec(`open "${tab.url}"`));
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

program.parse(process.argv);