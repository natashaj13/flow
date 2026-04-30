#!/usr/bin/env node
const { program } = require('commander');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { generateBriefing } = require('./briefing');
const os = require('os');

program
  .command('save <name>')
  .description('Snapshot the current workspace')
  .action(async (name) => {
    console.log(`Saving workspace ${name}`);
    try {
      // 1. Set the active name
      await axios.post('http://localhost:3000/set-active', { name });
      
      // 2. Set the "Save Flag" (This wakes up the extension)
      await axios.post('http://localhost:3000/request-save'); 
      
      //console.log(`✅ Signal sent! VS Code should save automatically in a second.`);
    } catch (err) {
      //console.error("Hub not found. Is 'node hub/index.js' running on port 3000?");
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
      data.browser.forEach(url => exec(`open "${url}"`));
    }

    // Restore VS Code Files
    if (data.vscode && data.vscode.openFiles) {
      const files = data.vscode.openFiles.map(f => `"${f}"`).join(' ');
      exec(`code -n ${files}`);
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