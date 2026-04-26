#!/usr/bin/env node
const { program } = require('commander');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { generateBriefing } = require('./briefing');

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
    const capsulePath = path.join(__dirname, `../../shared/capsules/${name}.json`);
    
    if (!fs.existsSync(capsulePath)) {
      console.error("Capsule not found!");
      return;
    }

    const data = JSON.parse(fs.readFileSync(capsulePath));

    await generateBriefing(data);

    // Restore relevant tabs if available, otherwise fall back to all tabs
    const tabs = data.relevantBrowser || data.browser;
    if (tabs) {
      tabs.forEach(url => exec(`open "${url}"`));
    }

    // Restore VS Code Files
    if (data.vscode && data.vscode.openFiles) {
      const files = data.vscode.openFiles.map(f => `"${f}"`).join(' ');
      exec(`code ${files}`);
    }

  });

program.parse(process.argv);