import { describe, expect, it } from 'vitest';

import { parseBoardMarkdown } from '../src/model/parse';
import { serializeBoardMarkdown } from '../src/model/serialize';

const fixture = `---
kanban: true
kanbanVersion: 1
boardTitle: Product Board
boardDescription: Sprint 3
density: compact
columns:
  - id: todo
    title: To Do
    wipLimit: 5
  - id: doing
    title: Doing
    wipLimit: 2
---

## [todo] To Do

- [ ] [card-1] Implement parser #backend
  Add failing test first
  due:: 2026-02-17

## [doing] Doing

- [x] [card-2] Build settings modal
  Keep validation strict #ui

%% kanban-next:archive:start %%

- [x] [card-3] Old archived card

%% kanban-next:archive:end %%
`;

describe('board parser + serializer', () => {
  it('parses board metadata, cards, and archive', () => {
    const board = parseBoardMarkdown(fixture);

    expect(board.boardTitle).toBe('Product Board');
    expect(board.density).toBe('compact');
    expect(board.columns).toHaveLength(2);
    expect(board.columns[0].cards[0].dueDate).toBe('2026-02-17');
    expect(board.columns[0].cards[0].tags).toContain('#backend');
    expect(board.columns[1].cards[0].checked).toBe(true);
    expect(board.archive).toHaveLength(1);
    expect(board.archive[0].title).toBe('Old archived card');
  });

  it('round-trips deterministically', () => {
    const first = serializeBoardMarkdown(parseBoardMarkdown(fixture));
    const second = serializeBoardMarkdown(parseBoardMarkdown(first));

    expect(first).toContain('  ^card-1');
    expect(first).toBe(second);
  });

  it('supports zero-column boards', () => {
    const raw = `---
kanban: true
kanbanVersion: 1
boardTitle: Empty board
density: normal
columns: []
---
`;

    const board = parseBoardMarkdown(raw);

    expect(board.columns).toHaveLength(0);
    expect(board.archive).toHaveLength(0);
  });

  it('keeps frontmatter columns order and appends body-only columns', () => {
    const raw = `---
kanban: true
kanbanVersion: 1
boardTitle: Ordered board
density: normal
columns:
  - id: b
    title: B
    wipLimit: null
  - id: a
    title: A
    wipLimit: null
---

## [a] A

- [ ] [x] In A

## [c] C

- [ ] [y] In C
`;

    const board = parseBoardMarkdown(raw);

    expect(board.columns.map((column) => column.id)).toEqual(['b', 'a', 'c']);
    expect(board.columns[2].cards[0].title).toBe('In C');
  });

  it('throws when kanban frontmatter marker is missing', () => {
    const raw = `---
boardTitle: Not a board
---
`;

    expect(() => parseBoardMarkdown(raw)).toThrow('kanban: true');
  });

  it('ignores block anchor lines inside card descriptions', () => {
    const raw = `---
kanban: true
kanbanVersion: 1
boardTitle: Anchors
density: normal
columns:
  - id: lane
    title: Lane
    wipLimit: null
---

## [lane] Lane

- [ ] [card-1] Task
  ^card-1
  Keep this line
`;

    const board = parseBoardMarkdown(raw);
    expect(board.columns[0].cards[0].description).toBe('Keep this line');
  });
});
