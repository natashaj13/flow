#!/usr/bin/env node
'use strict';

const { program } = require('commander');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
// const { exec } = require('child_process');
const inquirer = require('inquirer');
const { generateBriefing } = require('../briefing');

program
  .command('save <name>')
  .description('Snapshot the current workspace')
  .action(async (name) => {
    console.log(`Triggering Flow for: ${name}...`);
    try {
      await axios.post('http://localhost:3000/set-active', { name });
      await axios.post('http://localhost:3000/request-save');
      console.log(`Signal sent! VS Code will save the snapshot shortly.`);
    } catch (err) {
      console.error("Hub not found. Is 'node hub/index.js' running on port 3000?");
    }
  });

program
  .command('resume <name>')
  .description('Restore a workspace with an AI briefing')
  .action(async (name) => {
    const capsulePath = path.join(__dirname, `../../shared/capsules/${name}.json`);

    if (!fs.existsSync(capsulePath)) {
      console.error(`Capsule "${name}" not found at ${capsulePath}`);
      process.exit(1);
    }

    const capsule = JSON.parse(fs.readFileSync(capsulePath, 'utf8'));

    // Stream the Gemini briefing and capture the text for the agent
    const summary = await generateBriefing(capsule);

    // Ask whether to notify teammates via Fetch.ai agents
    const { notifyTeam } = await inquirer.prompt([{
      type: 'confirm',
      name: 'notifyTeam',
      message: 'Notify your team via Fetch.ai agents?',
      default: false,
    }]);

    if (notifyTeam) {
      try {
        console.log('Finding team agents on Agentverse...');
        const resp = await axios.post('http://localhost:8001/brief', {
          summary,
          snapshot: JSON.stringify(capsule),
        });
        const result = resp.data;
        if (result.teammates_notified > 0) {
          console.log(`Notified ${result.teammates_notified} teammate(s).`);
        } else if (result.status === 'no_addresses') {
          console.log(`No teammate addresses found in fetch/team.json.`);
          console.log(`Have each teammate run 'python3 fetch/agent.py' and share their agent1q... address with you.`);
        } else if (result.status === 'send_failed') {
          console.log(`Found teammates but failed to send — check agent terminal for the error.`);
          console.log(`Most likely cause: mailbox not created. Visit the inspector URL printed when agent.py starts.`);
        } else {
          console.log(`Unexpected response from agent: ${JSON.stringify(result)}`);
        }
      } catch (err) {
        if (err.code === 'ECONNREFUSED') {
          console.error('Flow agent not running. Start it with: python3 fetch/agent.py');
        } else {
          console.error('Error notifying team:', err.message);
        }
      }
    }

    // // Reopen VS Code files
    // if (capsule.vscode && capsule.vscode.openFiles && capsule.vscode.openFiles.length) {
    //   console.log('Reopening VS Code...');
    //   const files = capsule.vscode.openFiles.map(f => `"${f}"`).join(' ');
    //   exec(`code ${files}`);
    // }

    // // Reopen browser tabs
    // const rawBrowser = capsule.browser;
    // const tabs = Array.isArray(rawBrowser)
    //   ? rawBrowser
    //   : (rawBrowser && Array.isArray(rawBrowser.urls) ? rawBrowser.urls : []);

    // if (tabs.length) {
    //   console.log('Reopening browser tabs...');
    //   tabs.forEach(url => exec(`open "${url}"`));
    // }
  });

program.parse(process.argv);
