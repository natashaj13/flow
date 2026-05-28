#!/usr/bin/env node
const { program } = require('commander');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const os = require('os');
const pm2 = require('pm2');
const net = require('net');

const PORT_FILE = path.join(os.homedir(), '.flow_port');

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
    // If the port file exists, assume it's running on that port to prevent race conditions
    if (fs.existsSync(PORT_FILE)) {
      const savedPort = parseInt(fs.readFileSync(PORT_FILE, 'utf8').trim(), 10);
      if (savedPort) return resolve(savedPort);
    }

    pm2.connect(async (err) => {
      if (err) return resolve(7382); // Fallback to default port if PM2 has issues

      pm2.describe('flow-hub', async (err, desc) => {
        if (desc && desc.length > 0 && desc[0].pm2_env.status === 'online') {
          const existingPort = desc[0].pm2_env.PORT || 7382;
          pm2.disconnect();
          return resolve(existingPort);
        }

        const freePort = await findAvailablePort(7382);
        const hubPath = path.join(__dirname, '../../hub/index.js');

        pm2.start({
          script: hubPath,
          name: 'flow-hub',
          env: { PORT: freePort } 
        }, (err) => {
          pm2.disconnect();
          fs.writeFileSync(PORT_FILE, freePort.toString());
          if (err) return reject(err);
          resolve(freePort);
        });
      });
    });
  });
}

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

program
  .command('save [args...]')
  .description('Snapshot the current workspace')
  .allowUnknownOption()
  .action(async (args) => {
    const name = args[0]; 

    if (!name) {
      console.error("❌ Error: Please provide a capsule name. Example: flow save my-capsule");
      return;
    }

    const port = await ensureHubIsRunning();
    const HUB_URL = `http://localhost:${port}/set-active`;
    
    const rawArgs = process.argv;
    const summaryIndex = rawArgs.indexOf('-summary');
    let summaryText = null;

    if (summaryIndex !== -1 && rawArgs[summaryIndex + 1]) {
      summaryText = rawArgs[summaryIndex + 1];
    }

    try {
      let attempts = 0;
      while (attempts < 3) {
        try {
          const response = await axios.post(HUB_URL, { name, summary: summaryText });
          if (response.status === 200) {
            console.log(`✅ Snapshotting ${name}`);
            return; 
          }
        } catch (err) {
          attempts++;
          if (attempts === 3) {
            console.error("❌ Failed to reach Hub after 3 attempts. Try running 'pm2 logs flow-hub'.");
          } else {
            await sleep(500); 
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

    const data = JSON.parse(fs.readFileSync(capsulePath, 'utf8'));

    console.log(`\n===================================`);
    console.log(`📦 Loading Capsule: ${name}`);
    console.log(`📝 Summary: ${data.summary || "No summary provided."}`);
    console.log(`===================================\n`);

    if (data.browser) {
      data.browser.forEach(tab => exec(`open "${tab.url || tab}"`, (err) => {}));
    }

    if (data.vscode && data.vscode.openFiles) {
      const { projectRoot, openFiles } = data.vscode;
      let command = 'code -n'; 

      if (projectRoot) {
          command += ` "${projectRoot}"`;
      }

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
            const updated = data.lastUpdated ? new Date(data.lastUpdated).toLocaleString() : 'unknown';
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

program.parse(process.argv);