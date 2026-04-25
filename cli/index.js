#!/usr/bin/env node
'use strict';

const { Command } = require('commander');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { generateBriefing } = require('./briefing');

const CAPSULES_DIR = path.join(__dirname, '../shared/capsules');

const program = new Command();

program
    .name('flow')
    .description('Save and resume your dev context with an AI briefing')
    .version('1.0.0');

// ── flow save <capsule-name> ──────────────────────────────────────────────────
// Writes a trigger file that the VS Code extension watches.
// The extension sees the file change, runs its snapshot logic, and POSTs to
// the Hub with the given capsule name.
program
    .command('save <capsule-name>')
    .description('Snapshot your current VS Code + browser state')
    .action((capsuleName) => {
        const triggerPath = path.join(os.homedir(), '.flow-trigger');
        fs.writeFileSync(
            triggerPath,
            JSON.stringify({ capsuleName, timestamp: Date.now() }),
        );
        console.log(`Trigger written → ${triggerPath}`);
        console.log(`VS Code extension will save snapshot as "${capsuleName}".`);
        console.log('Also click the Flow Capsule icon in Chrome to snapshot your tabs.');
    });

// ── flow resume <capsule-name> ────────────────────────────────────────────────
// 1. Reads the saved capsule JSON
// 2. Streams an AI briefing (the wow factor)
// 3. Reopens VS Code files and browser tabs
program
    .command('resume <capsule-name>')
    .description('Resume a saved session with an AI briefing')
    .option('--no-open', 'Print briefing only, skip reopening files/tabs')
    .action(async (capsuleName, opts) => {
        const capsulePath = path.join(CAPSULES_DIR, `${capsuleName}.json`);

        if (!fs.existsSync(capsulePath)) {
            console.error(`No capsule found for "${capsuleName}" at ${capsulePath}`);
            process.exit(1);
        }

        let capsule;
        try {
            capsule = JSON.parse(fs.readFileSync(capsulePath, 'utf8'));
        } catch (err) {
            console.error('Failed to parse capsule:', err.message);
            process.exit(1);
        }

        // ── THE WOW FACTOR ──
        await generateBriefing(capsule);

        if (!opts.open) return;

        // ── Reopen VS Code files ──
        if (capsule.vscode?.openFiles?.length) {
            console.log('Reopening VS Code files...');
            for (const file of capsule.vscode.openFiles) {
                try {
                    execSync(`code "${file}"`, { stdio: 'ignore' });
                } catch (_) {}
            }
            if (capsule.vscode.projectRoot) {
                try {
                    execSync(`code "${capsule.vscode.projectRoot}"`, { stdio: 'ignore' });
                } catch (_) {}
            }
        }

        // ── Reopen browser tabs ──
        if (capsule.browser?.length) {
            console.log('Reopening browser tabs...');
            const openModule = require('open');
            for (const url of capsule.browser) {
                try { await openModule(url); } catch (_) {}
            }
        }
    });

// ── flow list ─────────────────────────────────────────────────────────────────
program
    .command('list')
    .description('List all saved capsules')
    .action(() => {
        if (!fs.existsSync(CAPSULES_DIR)) {
            console.log('No capsules saved yet.');
            return;
        }
        const files = fs.readdirSync(CAPSULES_DIR).filter(f => f.endsWith('.json'));
        if (files.length === 0) {
            console.log('No capsules saved yet.');
            return;
        }
        files.forEach(f => {
            const data = JSON.parse(fs.readFileSync(path.join(CAPSULES_DIR, f), 'utf8'));
            const updated = data.lastUpdated
                ? new Date(data.lastUpdated).toLocaleString()
                : 'unknown';
            console.log(`  ${f.replace('.json', '')}  (last saved: ${updated})`);
        });
    });

program.parse(process.argv);
