#!/usr/bin/env node
'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Gathers everything worth sending to the LLM:
 *  - active file name + last 20 lines
 *  - git diff --stat for the project root
 *  - open file list (first 5)
 *  - browser tabs (first 5)
 */
function buildContext(capsule) {
    const parts = [];

    if (capsule.vscode) {
        const { activeFile, openFiles, projectRoot } = capsule.vscode;

        if (activeFile) {
            parts.push(`Active file: ${path.basename(activeFile)}`);

            if (fs.existsSync(activeFile)) {
                const lines = fs.readFileSync(activeFile, 'utf8').split('\n');
                const tail = lines.slice(-20).join('\n');
                parts.push(`\nLast 20 lines of ${path.basename(activeFile)}:\n\`\`\`\n${tail}\n\`\`\``);
            }
        }

        if (openFiles && openFiles.length > 0) {
            const names = openFiles.slice(0, 5).map(f => path.basename(f)).join(', ');
            parts.push(`\nOther open files: ${names}`);
        }

        if (projectRoot && fs.existsSync(projectRoot)) {
            try {
                const stat = execSync('git diff --stat HEAD', {
                    cwd: projectRoot,
                    encoding: 'utf8',
                    stdio: ['pipe', 'pipe', 'ignore'],
                }).trim();
                if (stat) parts.push(`\nUnstaged changes:\n${stat}`);
            } catch (_) {}

            try {
                const log = execSync('git log --oneline -5', {
                    cwd: projectRoot,
                    encoding: 'utf8',
                    stdio: ['pipe', 'pipe', 'ignore'],
                }).trim();
                if (log) parts.push(`\nRecent commits:\n${log}`);
            } catch (_) {}
        }
    }

    if (capsule.browser && capsule.browser.length > 0) {
        const tabs = capsule.browser.slice(0, 5).join('\n  - ');
        parts.push(`\nBrowser tabs open:\n  - ${tabs}`);
    }

    if (capsule.lastUpdated) {
        parts.push(`\nSnapshot taken: ${new Date(capsule.lastUpdated).toLocaleString()}`);
    }

    return parts.join('\n');
}

async function generateBriefing(capsule) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error('GEMINI_API_KEY environment variable is not set.');
        process.exit(1);
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });

    const context = buildContext(capsule);

    if (!context.trim()) {
        console.log('No context found in this capsule to generate a briefing.');
        return;
    }

    const prompt = `You are a developer assistant helping someone resume their coding session.
Based on the snapshot below, write a crisp 2–3 sentence "30-second briefing":
what they were working on, where they left off, and the single best next action.
Be specific — name the file, the function, the error, or the feature if you can see it.
Do not pad with pleasantries.

--- SNAPSHOT ---
${context}
--- END ---`;

    process.stdout.write('\n\n');

    const result = await model.generateContentStream(prompt);

    for await (const chunk of result.stream) {
        process.stdout.write(chunk.text());
    }

    process.stdout.write('\n\n');
}

module.exports = { generateBriefing };