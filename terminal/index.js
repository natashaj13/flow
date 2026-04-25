#!/usr/bin/env node
const { program } = require('commander');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const axios = require('axios');
const open = require('open');
const inquirer = require('inquirer');
const { generateBriefing } = require('../cli/briefing');
const openApp = open.default || open;

const CONFIG_PATH = path.join(os.homedir(), '.flow_cache.json');
const HUB_URL = 'http://localhost:3000';

// --- SAVE COMMAND ---
program
  .command('save')
  .description('Snapshot the current workspace state')
  .action(async () => {
    try {
      console.log('🚀 Triggering Flow Save...');
      
      // Send the current directory to the Hub
      await axios.post(`${HUB_URL}/trigger`, { 
        cwd: process.cwd() 
      });
      
      console.log('✅ Signal sent to Hub!');
      console.log('💡 Keep your Hub running; it will save once VS Code and Chrome report back.');
    } catch (err) {
      console.error('❌ Error: Could not connect to the Hub. Is it running on port 3000?');
    }
  });

// --- LOAD COMMAND ---
program
  .command('load')
  .description('Choose and restore a past snapshot')
  .action(async () => {
    const SNAPSHOT_DIR = path.join(os.homedir(), '.flow_snapshots');

    // 1. Check if the directory exists and has snapshots
    if (!fs.existsSync(SNAPSHOT_DIR) || fs.readdirSync(SNAPSHOT_DIR).length === 0) {
        console.error('❌ No snapshots found. Run "flow save" first.');
        return;
    }

    // 2. Read all files and sort by newest first
    const files = fs.readdirSync(SNAPSHOT_DIR)
        .filter(f => f.endsWith('.json'))
        .sort((a, b) => b.split('_')[1].split('.')[0] - a.split('_')[1].split('.')[0]);

    // 3. Map files to a clean list for the menu
    const choices = files.map(file => {
        const fullPath = path.join(SNAPSHOT_DIR, file);
        const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
        return {
            name: `${data.timestamp} — [Dir: ${path.basename(data.cwd)}]`,
            value: data // Pass the actual data object as the value
        };
    });

    // 4. Prompt the user
    const answer = await inquirer.prompt([
        {
            type: 'list',
            name: 'flowData',
            message: 'Which workspace would you like to restore?',
            choices: choices
        }
    ]);

    const data = answer.flowData;
    console.log(`\n🌊 Flowing back into: ${data.timestamp}...`);

    // 5. AI Briefing
    await generateBriefing(data);

    // 6. Execution Logic
    if (data.vscode && data.vscode.files) {
        console.log('🖥️  Opening VS Code...');
        data.vscode.files.forEach(file => exec(`code "${file}"`));
    }

    if (data.chrome && data.chrome.urls) {
        console.log('🌐 Opening Chrome...');
        data.chrome.urls
            .filter(url => !url.startsWith('chrome://'))
            .forEach(url => openApp(url));
    }

    console.log(`\n📍 Last Directory: ${data.cwd}`);
    console.log(`👉 To go back: cd ${data.cwd}`);
  });

  // --- CLEAR COMMAND ---
program
  .command('clear')
  .description('Delete all saved snapshots')
  .action(() => {
    const SNAPSHOT_DIR = path.join(os.homedir(), '.flow_snapshots');
    if (fs.existsSync(SNAPSHOT_DIR)) {
      const files = fs.readdirSync(SNAPSHOT_DIR);
      files.forEach(file => fs.unlinkSync(path.join(SNAPSHOT_DIR, file)));
      console.log('🗑️  All snapshots deleted.');
    }
  });
// Commander automatically handles the 'help' command, 
// so we just need to parse the arguments at the end.
program.parse(process.argv);