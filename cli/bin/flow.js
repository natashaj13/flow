#!/usr/bin/env node
const { program } = require('commander');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

program
  .command('save <name>')
  .description('Snapshot the current workspace')
  .action(async (name) => {
    console.log(`🚀 Triggering Flow for: ${name}...`);
    try {
      // 1. Set the active name
      await axios.post('http://localhost:3000/set-active', { name });
      
      // 2. Set the "Save Flag" (This wakes up the extension)
      await axios.post('http://localhost:3000/request-save'); 
      
      console.log(`✅ Signal sent! VS Code should save automatically in a second.`);
    } catch (err) {
      console.error("Hub not found. Is 'node hub/index.js' running on port 3000?");
    }
  });

program
  .command('resume <name>')
  .description('Restore a workspace')
  .action((name) => {
    const capsulePath = path.join(__dirname, `../../shared/capsules/${name}.json`);
    
    if (!fs.existsSync(capsulePath)) {
      console.error("Capsule not found!");
      return;
    }

    const data = JSON.parse(fs.readFileSync(capsulePath));

    // Restore Browser Tabs
    if (data.browser) {
      data.browser.forEach(url => exec(`open "${url}"`));
    }

    // Restore VS Code Files
    if (data.vscode && data.vscode.openFiles) {
      const files = data.vscode.openFiles.map(f => `"${f}"`).join(' ');
      exec(`code ${files}`);
    }

    console.log(`Welcome back to ${name}. Briefing coming soon...`);
  });

program.parse(process.argv);