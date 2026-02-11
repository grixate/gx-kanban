import { describe, expect, it } from 'vitest';

import { normalizeCard } from '../src/model/card';
import { createDefaultBoard } from '../src/model/boardTemplate';
import { createId } from '../src/model/id';
import { BoardStore } from '../src/state/BoardStore';

function makeCard(title: string) {
  return normalizeCard({
    id: createId('card'),
    title,
    description: '',
    checked: false,
    dueDate: null,
  });
}

describe('BoardStore', () => {
  it('moves columns', () => {
    const board = createDefaultBoard('Board');
    const store = new BoardStore({
      ...board,
      columns: [
        { id: 'one', title: 'One', wipLimit: null, cards: [] },
        { id: 'two', title: 'Two', wipLimit: null, cards: [] },
        { id: 'three', title: 'Three', wipLimit: null, cards: [] },
      ],
    });

    store.moveColumn('one', 2);

    expect(store.getBoard().columns.map((column) => column.id)).toEqual(['two', 'three', 'one']);
  });

  it('moves columns across adjacent positions', () => {
    const board = createDefaultBoard('Board');
    const store = new BoardStore({
      ...board,
      columns: [
        { id: 'one', title: 'One', wipLimit: null, cards: [] },
        { id: 'two', title: 'Two', wipLimit: null, cards: [] },
        { id: 'three', title: 'Three', wipLimit: null, cards: [] },
        { id: 'four', title: 'Four', wipLimit: null, cards: [] },
      ],
    });

    store.moveColumn('two', 2);
    expect(store.getBoard().columns.map((column) => column.id)).toEqual([
      'one',
      'three',
      'two',
      'four',
    ]);

    store.moveColumn('two', 1);
    expect(store.getBoard().columns.map((column) => column.id)).toEqual([
      'one',
      'two',
      'three',
      'four',
    ]);

    store.moveColumn('four', 0);
    expect(store.getBoard().columns.map((column) => column.id)).toEqual([
      'four',
      'one',
      'two',
      'three',
    ]);
  });

  it('archives all cards from a column', () => {
    const board = createDefaultBoard('Board');
    const store = new BoardStore({
      ...board,
      columns: [
        {
          id: 'lane',
          title: 'Lane',
          wipLimit: null,
          cards: [makeCard('A'), makeCard('B')],
        },
      ],
    });

    const moved = store.archiveColumnCards('lane');

    expect(moved).toBe(2);
    expect(store.getBoard().columns[0].cards).toHaveLength(0);
    expect(store.getBoard().archive).toHaveLength(2);
  });

  it('inserts parsed cards before and after', () => {
    const board = createDefaultBoard('Board');
    const existing = makeCard('Existing');
    const store = new BoardStore({
      ...board,
      columns: [
        {
          id: 'lane',
          title: 'Lane',
          wipLimit: null,
          cards: [existing],
        },
      ],
    });

    store.insertCardsFromParsedLines('lane', [makeCard('Before 1'), makeCard('Before 2')], 'before');
    store.insertCardsFromParsedLines('lane', [makeCard('After 1')], 'after');

    const titles = store.getBoard().columns[0].cards.map((card) => card.title);
    expect(titles).toEqual(['Before 1', 'Before 2', 'Existing', 'After 1']);
  });

  it('inserts cards at a specific index', () => {
    const board = createDefaultBoard('Board');
    const store = new BoardStore({
      ...board,
      columns: [
        {
          id: 'lane',
          title: 'Lane',
          wipLimit: null,
          cards: [makeCard('A'), makeCard('D')],
        },
      ],
    });

    const inserted = store.insertCardsAt('lane', 1, [makeCard('B'), makeCard('C')]);
    expect(inserted).toBe(2);
    expect(store.getBoard().columns[0].cards.map((card) => card.title)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('moves a card to bottom within the same column', () => {
    const board = createDefaultBoard('Board');
    const first = makeCard('First');
    const second = makeCard('Second');
    const third = makeCard('Third');

    const store = new BoardStore({
      ...board,
      columns: [
        {
          id: 'lane',
          title: 'Lane',
          wipLimit: null,
          cards: [first, second, third],
        },
      ],
    });

    store.moveCard('lane', first.id, 'lane', 3);
    expect(store.getBoard().columns[0].cards.map((card) => card.title)).toEqual([
      'Second',
      'Third',
      'First',
    ]);
  });
});
