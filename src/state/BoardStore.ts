import { normalizeCard, normalizeTagFilter } from '../model/card';
import { serializeBoardMarkdown } from '../model/serialize';
import { BoardDocument, BoardFilter, BoardStoreSnapshot, Card, CardDensity, Column } from '../model/types';

type Listener = (snapshot: BoardStoreSnapshot) => void;

type CardUpdater = (card: Card) => Card;

function cloneBoard(board: BoardDocument): BoardDocument {
  return {
    boardTitle: board.boardTitle,
    boardDescription: board.boardDescription,
    density: board.density,
    columns: board.columns.map((column) => ({
      id: column.id,
      title: column.title,
      wipLimit: typeof column.wipLimit === 'number' ? column.wipLimit : null,
      cards: column.cards.map((card) =>
        normalizeCard({
          id: card.id,
          title: card.title,
          description: card.description,
          checked: card.checked,
          dueDate: card.dueDate,
        })
      ),
    })),
    archive: board.archive.map((card) =>
      normalizeCard({
        id: card.id,
        title: card.title,
        description: card.description,
        checked: card.checked,
        dueDate: card.dueDate,
      })
    ),
  };
}

function sortUnique(values: string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

export class BoardStore {
  private board: BoardDocument;
  private filter: BoardFilter;
  private listeners: Set<Listener>;

  constructor(board: BoardDocument) {
    this.board = cloneBoard(board);
    this.filter = { query: '', tag: '' };
    this.listeners = new Set();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());

    return () => {
      this.listeners.delete(listener);
    };
  }

  getBoard(): BoardDocument {
    return cloneBoard(this.board);
  }

  setBoard(board: BoardDocument): void {
    this.board = cloneBoard(board);
    this.emit();
  }

  setFilterQuery(query: string): void {
    this.filter = {
      ...this.filter,
      query,
    };
    this.emit();
  }

  setFilterTag(tag: string): void {
    this.filter = {
      ...this.filter,
      tag: normalizeTagFilter(tag),
    };
    this.emit();
  }

  clearFilter(): void {
    this.filter = { query: '', tag: '' };
    this.emit();
  }

  setBoardMetadata(payload: {
    boardTitle: string;
    boardDescription: string;
    density: CardDensity;
  }): void {
    this.board = {
      ...this.board,
      boardTitle: payload.boardTitle.trim() || this.board.boardTitle,
      boardDescription: payload.boardDescription.trim(),
      density: payload.density,
    };
    this.emit();
  }

  addColumn(column: Column): Column {
    this.board = {
      ...this.board,
      columns: [...this.board.columns, column],
    };

    this.emit();
    return column;
  }

  renameColumn(columnId: string, title: string): void {
    this.board = {
      ...this.board,
      columns: this.board.columns.map((column) =>
        column.id === columnId
          ? {
              ...column,
              title: title.trim() || column.title,
            }
          : column
      ),
    };
    this.emit();
  }

  setColumnWipLimit(columnId: string, limit: number | null): void {
    this.board = {
      ...this.board,
      columns: this.board.columns.map((column) =>
        column.id === columnId
          ? {
              ...column,
              wipLimit: typeof limit === 'number' && limit >= 0 ? Math.floor(limit) : null,
            }
          : column
      ),
    };
    this.emit();
  }

  deleteColumn(columnId: string): void {
    this.board = {
      ...this.board,
      columns: this.board.columns.filter((column) => column.id !== columnId),
    };
    this.emit();
  }

  moveColumn(sourceColumnId: string, targetIndex: number): void {
    const sourceIndex = this.board.columns.findIndex((column) => column.id === sourceColumnId);
    if (sourceIndex < 0) {
      return;
    }

    const columns = [...this.board.columns];
    const [moved] = columns.splice(sourceIndex, 1);
    if (!moved) {
      return;
    }

    const nextIndex = Math.max(0, Math.min(targetIndex, columns.length));
    columns.splice(nextIndex, 0, moved);

    this.board = {
      ...this.board,
      columns,
    };

    this.emit();
  }

  addCard(columnId: string, card: Card, placement: 'top' | 'bottom' = 'bottom'): Card {
    this.board = {
      ...this.board,
      columns: this.board.columns.map((column) => {
        if (column.id !== columnId) {
          return column;
        }

        return {
          ...column,
          cards: placement === 'top' ? [card, ...column.cards] : [...column.cards, card],
        };
      }),
    };

    this.emit();
    return card;
  }

  insertCardsFromParsedLines(
    columnId: string,
    cards: Card[],
    position: 'before' | 'after'
  ): number {
    if (cards.length === 0) {
      return 0;
    }

    this.board = {
      ...this.board,
      columns: this.board.columns.map((column) => {
        if (column.id !== columnId) {
          return column;
        }

        return {
          ...column,
          cards: position === 'before' ? [...cards, ...column.cards] : [...column.cards, ...cards],
        };
      }),
    };

    this.emit();
    return cards.length;
  }

  getCard(columnId: string, cardId: string): Card | null {
    const column = this.board.columns.find((entry) => entry.id === columnId);
    if (!column) {
      return null;
    }

    const card = column.cards.find((entry) => entry.id === cardId);
    if (!card) {
      return null;
    }

    return {
      ...card,
      tags: [...card.tags],
    };
  }

  updateCard(columnId: string, cardId: string, updater: CardUpdater): void {
    this.board = {
      ...this.board,
      columns: this.board.columns.map((column) => {
        if (column.id !== columnId) {
          return column;
        }

        return {
          ...column,
          cards: column.cards.map((card) => {
            if (card.id !== cardId) {
              return card;
            }

            const next = updater(card);
            return normalizeCard({
              id: next.id,
              title: next.title,
              description: next.description,
              checked: next.checked,
              dueDate: next.dueDate,
            });
          }),
        };
      }),
    };

    this.emit();
  }

  deleteCard(columnId: string, cardId: string): void {
    this.board = {
      ...this.board,
      columns: this.board.columns.map((column) =>
        column.id === columnId
          ? {
              ...column,
              cards: column.cards.filter((card) => card.id !== cardId),
            }
          : column
      ),
    };

    this.emit();
  }

  clearColumnCards(columnId: string): number {
    const column = this.board.columns.find((entry) => entry.id === columnId);
    const count = column?.cards.length || 0;
    if (count === 0) {
      return 0;
    }

    this.board = {
      ...this.board,
      columns: this.board.columns.map((entry) =>
        entry.id === columnId
          ? {
              ...entry,
              cards: [],
            }
          : entry
      ),
    };

    this.emit();
    return count;
  }

  archiveColumnCards(columnId: string): number {
    const column = this.board.columns.find((entry) => entry.id === columnId);
    const cardsToArchive = column?.cards || [];

    if (cardsToArchive.length === 0) {
      return 0;
    }

    this.board = {
      ...this.board,
      columns: this.board.columns.map((entry) =>
        entry.id === columnId
          ? {
              ...entry,
              cards: [],
            }
          : entry
      ),
      archive: [...this.board.archive, ...cardsToArchive],
    };

    this.emit();
    return cardsToArchive.length;
  }

  moveCard(
    sourceColumnId: string,
    cardId: string,
    targetColumnId: string,
    targetIndex: number
  ): void {
    const sourceColumnIndex = this.board.columns.findIndex((column) => column.id === sourceColumnId);
    const targetColumnIndex = this.board.columns.findIndex((column) => column.id === targetColumnId);

    if (sourceColumnIndex < 0 || targetColumnIndex < 0) {
      return;
    }

    const sourceColumn = this.board.columns[sourceColumnIndex];
    const targetColumn = this.board.columns[targetColumnIndex];
    if (!sourceColumn || !targetColumn) {
      return;
    }

    const cardIndex = sourceColumn.cards.findIndex((card) => card.id === cardId);

    if (cardIndex < 0) {
      return;
    }

    const card = sourceColumn.cards[cardIndex];
    if (!card) {
      return;
    }

    const nextColumns = this.board.columns.map((column) => ({
      ...column,
      cards: [...column.cards],
    }));

    const nextSourceColumn = nextColumns[sourceColumnIndex];
    const nextTargetColumn = nextColumns[targetColumnIndex];
    if (!nextSourceColumn || !nextTargetColumn) {
      return;
    }

    nextSourceColumn.cards.splice(cardIndex, 1);

    const targetCards = nextTargetColumn.cards;
    let insertIndex = Math.max(0, Math.min(targetIndex, targetCards.length));

    if (sourceColumnId === targetColumnId && cardIndex < insertIndex) {
      insertIndex -= 1;
    }

    targetCards.splice(insertIndex, 0, card);

    this.board = {
      ...this.board,
      columns: nextColumns,
    };

    this.emit();
  }

  toMarkdown(): string {
    return serializeBoardMarkdown(this.board);
  }

  getSnapshot(): BoardStoreSnapshot {
    const query = this.filter.query.trim().toLowerCase();
    const tag = normalizeTagFilter(this.filter.tag);
    const allTags = sortUnique(
      this.board.columns.flatMap((column) => column.cards.flatMap((card) => card.tags))
    );

    if (!query && !tag) {
      const full = this.getBoard();
      return {
        board: full,
        filter: { ...this.filter },
        visibleColumns: full.columns,
        allTags,
      };
    }

    const visibleColumns = this.board.columns.map((column) => ({
      ...column,
      cards: column.cards.filter((card) => {
        if (query && !card.searchText.includes(query)) {
          return false;
        }

        if (tag && !card.tags.includes(tag)) {
          return false;
        }

        return true;
      }),
    }));

    return {
      board: this.getBoard(),
      filter: { ...this.filter },
      visibleColumns,
      allTags,
    };
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
