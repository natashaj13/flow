# Flow

Save your whole working context — every VS Code window and every Chrome tab, across profiles — as a named **capsule**, then restore it all with one command.

```bash
flow save deep-work -m "refactoring the auth flow"
flow load deep-work
```

## How it works

| Part | What it does |
|---|---|
| `cli/` | The `flow` command. Starts the hub automatically (via pm2). |
| `hub/` | Small local server (ports 7382–7399). Collects snapshots into `~/.flow_capsules/`. |
| `vscode/` | VS Code extension. Every open window reports its files; minimized windows are skipped. |
| `chrome/` | Chrome extension. Reports tabs per profile so they restore into the right profile. |

## Install with Homebrew

```bash
git clone https://github.com/natashaj13/flow.git
cd flow
brew install ./flow.rb
```

This installs the `flow` CLI with all dependencies, builds and installs the VS Code
extension (when the `code` command is available), and prints the remaining manual
steps. Note: the formula downloads from the repo's `main` branch.

**The Chrome extension must be installed by hand** (Chrome doesn't allow scripted
installs): open `chrome://extensions`, enable **Developer mode**, click
**Load unpacked**, and select the `chrome/` folder. Repeat in each profile you
want captured.

## Run it locally (no Homebrew)

```bash
git clone https://github.com/natashaj13/flow.git
cd flow
(cd cli && npm install)
(cd hub && npm install)
node cli/bin/flow.js save test   # or: cd cli && npm link, then just `flow save test`
```

The hub starts on demand — no separate server to run.

**VS Code extension:** `cd vscode && npm install && npm run compile`, then either
press F5 in VS Code to launch an Extension Development Host, or package and
install it for real:

```bash
cd vscode && npx @vscode/vsce package --out flow.vsix && code --install-extension flow.vsix --force
```

**Chrome extension:** load `chrome/` unpacked, as described above.

## Commands

```bash
flow save <name> -m "summary"   # snapshot all VS Code windows + Chrome tabs
flow load <name>                # reopen everything (focused window comes back on top)
flow list                       # list capsules
flow describe <name>            # show what's inside a capsule
flow clear <name>               # delete a capsule
```

## Notes

- **Minimized windows** (macOS): saves skip minimized VS Code windows only if VS Code
  has the Accessibility permission (System Settings → Privacy & Security →
  Accessibility). Without it, minimized windows are simply included — nothing is
  ever dropped.
- Capsules are plain JSON in `~/.flow_capsules/` — safe to inspect or delete.
- Only `http(s)`/`file` tabs are restored; `chrome://` pages can't be reopened
  from the command line.
