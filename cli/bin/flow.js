#!/usr/bin/env node
'use strict';

const { program } = require('commander');
const fs = require('fs');
const path = require('path');

const CAPSULES_DIR = path.join(__dirname, '../../shared/capsules');

program
  .name('flow')
  .description('Save and resume your dev context')
  .version('1.0.0');

program
  .command('resume <name>')
  .description('Restore a saved workspace')
  .option('--describe', 'List saved VS Code files and Chrome tabs without resuming')
  .action((name, opts) => {
    const capsulePath = path.join(CAPSULES_DIR, `${name}.json`);

    if (!fs.existsSync(capsulePath)) {
      console.error(`No capsule found for "${name}" at ${capsulePath}`);
      process.exit(1);
    }

    const capsule = JSON.parse(fs.readFileSync(capsulePath, 'utf8'));

    if (opts.describe) {
      const saved = capsule.lastUpdated
        ? new Date(capsule.lastUpdated).toLocaleString()
        : 'unknown';
      console.log(`\nCapsule: ${name}  (saved: ${saved})\n`);

      // VS Code files
      const openFiles =
        capsule.vscode?.openFiles ||
        capsule.vscode?.files ||
        [];

      if (openFiles.length > 0) {
        console.log('VS Code files:');
        openFiles.forEach(f => console.log(`  ${f}`));
      } else {
        console.log('VS Code files:  (none saved)');
      }

      console.log('');

      // Chrome tabs
      const rawBrowser = capsule.browser || capsule.chrome;
      const tabs = Array.isArray(rawBrowser)
        ? rawBrowser
        : (rawBrowser?.urls ?? []);

      if (tabs.length > 0) {
        console.log('Chrome tabs:');
        tabs.forEach(t => console.log(`  ${t}`));
      } else {
        console.log('Chrome tabs:  (none saved)');
      }

      console.log('');
      return;
    }

    // Normal resume — reopen files and tabs
    const { exec } = require('child_process');

    const openFiles =
      capsule.vscode?.openFiles ||
      capsule.vscode?.files ||
      [];

    if (openFiles.length) {
      console.log('Reopening VS Code...');
      const files = openFiles.map(f => `"${f}"`).join(' ');
      exec(`code ${files}`);
    }

    const rawBrowser = capsule.browser || capsule.chrome;
    const tabs = Array.isArray(rawBrowser)
      ? rawBrowser
      : (rawBrowser?.urls ?? []);

    if (tabs.length) {
      console.log('Reopening browser tabs...');
      tabs.forEach(url => exec(`open "${url}"`));
    }
  });

program.parse(process.argv);
