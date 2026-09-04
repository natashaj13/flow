# Flow — VS Code extension

Companion extension for the [Flow](https://github.com/natashaj13/flow) workspace manager.

Each VS Code window runs its own copy of this extension. It polls the local Flow
hub, and when a save is triggered (via `flow save <name>` or the **flow save**
command in the Command Palette), every open window reports its open files,
active file, and project folder so the whole layout can be restored later with
`flow load <name>`.

Minimized windows are excluded from saves on macOS. That check needs the
Accessibility permission (System Settings → Privacy & Security → Accessibility →
Visual Studio Code); without it, minimized windows are simply included too —
nothing is ever dropped.

## Requirements

- The Flow CLI and hub (`flow save` starts the hub automatically).
- VS Code 1.116 or newer.
