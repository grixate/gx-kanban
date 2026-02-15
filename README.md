# gx-kanban (Obsidian Plugin)

gx-kanban is a markdown-native Kanban board plugin for Obsidian focused on stability, deterministic file writes, and fast day-to-day workflow.

## MVP Features

- Custom Kanban view with toggle back to markdown
- Board-per-file format with YAML frontmatter + markdown body
- Column and card CRUD
- Drag and drop (reorder + cross-column move)
- Card editor modal with native editor attempt + fallback
- Per-column WIP warning limits
- Board settings (title, description, density, WIP limits)
- Per-board filter bar (text + tag)
- Debounced save queue

## Create a Board

- Command palette: `gx-kanban: Create board`
- Folder context menu: `New gx-kanban board`
- Open an existing board file and run: `gx-kanban: Toggle board/markdown view`

## Data Format (v1)

Each board is a normal markdown file with canonical structure.

```md
---
kanban: true
kanbanVersion: 1
boardTitle: Project Board
boardDescription: Sprint work
density: normal
columns:
  - id: todo
    title: To Do
    wipLimit: 5
  - id: doing
    title: Doing
    wipLimit: 3
  - id: done
    title: Done
    wipLimit: null
---

## [todo] To Do

- [ ] [card-001] Wire parser tests
  Add coverage for malformed frontmatter
  due:: 2026-02-20

## [doing] Doing

- [x] [card-002] Build board header
  Includes settings and markdown toggle

## [done] Done
```

### Card Rules

- Task line: `- [ ] [<cardId>] <title>`
- Description: indented lines below card
- Optional due line in description: `due:: YYYY-MM-DD`
- Tags are inferred from title/description text (e.g. `#backend`)

## Commands

- `gx-kanban: Create board`
- `gx-kanban: Toggle board/markdown view`
- `gx-kanban: Add column`
- `gx-kanban: Add card to first column`
- `gx-kanban: Open board settings`

## Development

- `npm i`
- `npm run dev`
- `npm run test`
- `npm run build`

Build artifacts for manual install:

- `main.js`
- `manifest.json`
- `styles.css`
