import { Menu, Notice, TextFileView, WorkspaceLeaf, setIcon } from 'obsidian';

import KanbanNextPlugin from '../main';
import { promptForMultilineText, promptForText } from '../modals/PromptModal';
import { openBoardSettingsModal } from '../modals/BoardSettingsModal';
import { openCardEditorModal } from '../modals/CardEditorModal';
import { createDefaultBoard } from '../model/boardTemplate';
import { normalizeCard } from '../model/card';
import { parseClipboardList } from '../model/clipboard';
import { createId } from '../model/id';
import { parseBoardMarkdown } from '../model/parse';
import { Card, Column } from '../model/types';
import { BoardStore } from '../state/BoardStore';
import { SaveQueue } from '../state/SaveQueue';

export const KANBAN_NEXT_VIEW_TYPE = 'kanban-next-view';
export const KANBAN_NEXT_ICON = 'lucide-layout-dashboard';

interface CardDragState {
  cardId: string;
  sourceColumnId: string;
}

interface ColumnDragState {
  sourceColumnId: string;
}

export class KanbanView extends TextFileView {
  private plugin: KanbanNextPlugin;
  private rootEl: HTMLElement | null;
  private boardEl: HTMLElement | null;
  private lanesEl: HTMLElement | null;

  private boardTitleTextEl: HTMLElement | null;
  private boardTitleInputEl: HTMLInputElement | null;
  private boardDescriptionEl: HTMLElement | null;

  private queryInputEl: HTMLInputElement | null;
  private tagInputEl: HTMLInputElement | null;
  private tagDatalistEl: HTMLElement | null;
  private tagOptionsCacheKey: string;

  private store: BoardStore | null;
  private unsubscribeStore: (() => void) | null;
  private saveQueue: SaveQueue;
  private pendingSavePayload: string | null;

  private cardDragState: CardDragState | null;
  private columnDragState: ColumnDragState | null;
  private columnDropInsertionIndex: number | null;
  private titleEditInProgress: boolean;
  private initialized: boolean;

  constructor(leaf: WorkspaceLeaf, plugin: KanbanNextPlugin) {
    super(leaf);
    this.plugin = plugin;

    this.rootEl = null;
    this.boardEl = null;
    this.lanesEl = null;

    this.boardTitleTextEl = null;
    this.boardTitleInputEl = null;
    this.boardDescriptionEl = null;

    this.queryInputEl = null;
    this.tagInputEl = null;
    this.tagDatalistEl = null;
    this.tagOptionsCacheKey = '';

    this.store = null;
    this.unsubscribeStore = null;

    this.pendingSavePayload = null;
    this.cardDragState = null;
    this.columnDragState = null;
    this.columnDropInsertionIndex = null;
    this.titleEditInProgress = false;
    this.initialized = false;

    this.saveQueue = new SaveQueue(
      async (payload) => {
        this.pendingSavePayload = payload;
        this.data = payload;
        this.requestSave();
      },
      this.plugin.settings.saveDebounceMs,
      this.plugin.settings.saveMaxDelayMs
    );
  }

  getViewType(): string {
    return KANBAN_NEXT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.file?.basename || 'Kanban board';
  }

  getIcon(): string {
    return KANBAN_NEXT_ICON;
  }

  clear(): void {
    this.saveQueue.clearPending();

    if (!this.store) {
      this.renderError('Board is empty and could not be loaded.');
      return;
    }

    const fallback = createDefaultBoard(this.file?.basename || 'Untitled Kanban');
    this.store.setBoard(fallback);
    this.schedulePersist();
  }

  getViewData(): string {
    return this.data;
  }

  setViewData(data: string): void {
    this.data = data;

    if (this.pendingSavePayload) {
      if (this.pendingSavePayload === data) {
        this.pendingSavePayload = null;
      } else if (this.initialized) {
        this.pendingSavePayload = null;
        this.saveQueue.clearPending();
        new Notice('Kanban Next reloaded after an external file change.');
      }
    }

    try {
      const board = parseBoardMarkdown(data);

      if (!this.store) {
        this.store = new BoardStore(board);
        this.unsubscribeStore = this.store.subscribe((snapshot) => {
          this.renderSnapshot(snapshot);
        });
      } else {
        this.store.setBoard(board);
      }

      this.initialized = true;
      this.syncBoardTitleWithFile(false);
    } catch (error) {
      if (error instanceof Error && error.message.includes('`kanban: true`')) {
        void this.plugin.setMarkdownView(this.leaf, false);
        return;
      }

      this.renderError(error instanceof Error ? error.message : 'Unknown parsing error.');
    }
  }

  async onOpen(): Promise<void> {
    this.rootEl = this.contentEl.createDiv({ cls: 'kanban-next-root-host' });

    this.registerEvent(
      this.app.vault.on('rename', (file) => {
        if (file !== this.file || !this.store) {
          return;
        }

        this.syncBoardTitleWithFile(true);
      })
    );

    if (this.store) {
      this.renderSnapshot(this.store.getSnapshot());
    }
  }

  async onClose(): Promise<void> {
    this.unsubscribeStore?.();
    this.unsubscribeStore = null;

    this.store = null;
    this.cardDragState = null;
    this.columnDragState = null;
    this.columnDropInsertionIndex = null;
    this.pendingSavePayload = null;
    this.titleEditInProgress = false;

    this.saveQueue.destroy();

    this.boardEl = null;
    this.lanesEl = null;
    this.boardTitleTextEl = null;
    this.boardTitleInputEl = null;
    this.boardDescriptionEl = null;
    this.queryInputEl = null;
    this.tagInputEl = null;
    this.tagDatalistEl = null;
    this.tagOptionsCacheKey = '';

    if (this.rootEl) {
      this.rootEl.empty();
      this.rootEl.remove();
      this.rootEl = null;
    }
  }

  async promptAddColumn(): Promise<void> {
    if (!this.store) {
      return;
    }

    const title = await promptForText(this.app, {
      title: 'Add column',
      value: '',
      placeholder: 'Column name',
      submitLabel: 'Add',
    });

    if (!title) {
      return;
    }

    const column: Column = {
      id: createId('column'),
      title,
      wipLimit: null,
      cards: [],
    };

    this.store.addColumn(column);
    this.schedulePersist();
  }

  async addCardToFirstColumn(): Promise<void> {
    const board = this.store?.getBoard();
    const firstColumn = board?.columns[0];

    if (!this.store || !firstColumn) {
      new Notice('Add a column first.');
      return;
    }

    const created = this.createBlankCard();
    this.store.addCard(firstColumn.id, created);
    this.schedulePersist();
    await this.editCard(firstColumn.id, created.id);
  }

  async openBoardSettings(): Promise<void> {
    const board = this.store?.getBoard();
    if (!this.store || !board) {
      return;
    }

    const result = await openBoardSettingsModal(this.app, board);
    if (!result) {
      return;
    }

    let boardTitle = this.file?.basename || board.boardTitle;

    if (this.file && result.boardTitle.trim() && result.boardTitle.trim() !== this.file.basename) {
      try {
        const renamed = await this.plugin.renameBoardFile(this.file, result.boardTitle.trim());
        boardTitle = renamed.basename;
      } catch (error) {
        new Notice(error instanceof Error ? error.message : 'Could not rename board file.');
      }
    }

    this.store.setBoardMetadata({
      boardTitle,
      boardDescription: result.boardDescription,
      density: result.density,
    });

    board.columns.forEach((column) => {
      this.store?.setColumnWipLimit(column.id, result.wipLimitByColumnId[column.id] ?? null);
    });

    this.schedulePersist();
  }

  private renderSnapshot(snapshot: ReturnType<BoardStore['getSnapshot']>): void {
    if (!this.rootEl || !this.store) {
      return;
    }

    this.ensureShell();

    const board = snapshot.board;
    this.boardEl?.toggleClass('is-compact', board.density === 'compact');

    if (this.boardTitleTextEl) {
      this.boardTitleTextEl.setText(board.boardTitle);
    }

    if (this.boardTitleInputEl && this.boardTitleInputEl !== document.activeElement) {
      this.boardTitleInputEl.value = board.boardTitle;
    }

    if (this.boardDescriptionEl) {
      this.boardDescriptionEl.empty();
      if (board.boardDescription) {
        this.boardDescriptionEl.setText(board.boardDescription);
        this.boardDescriptionEl.removeClass('is-hidden');
      } else {
        this.boardDescriptionEl.addClass('is-hidden');
      }
    }

    if (this.queryInputEl && this.queryInputEl !== document.activeElement) {
      if (this.queryInputEl.value !== snapshot.filter.query) {
        this.queryInputEl.value = snapshot.filter.query;
      }
    }

    if (this.tagInputEl && this.tagInputEl !== document.activeElement) {
      if (this.tagInputEl.value !== snapshot.filter.tag) {
        this.tagInputEl.value = snapshot.filter.tag;
      }
    }

    this.refreshTagDatalist(snapshot.allTags);
    this.renderLanes(snapshot);
  }

  private ensureShell(): void {
    if (!this.rootEl || this.boardEl) {
      return;
    }

    const boardEl = this.rootEl.createDiv({ cls: 'kanban-next-root' });
    this.boardEl = boardEl;

    const headerEl = boardEl.createDiv({ cls: 'kanban-next-header' });
    const headingEl = headerEl.createDiv({ cls: 'kanban-next-heading' });

    const titleRow = headingEl.createDiv({ cls: 'kanban-next-title-row' });

    const titleLabel = titleRow.createEl('h2', { cls: 'kanban-next-board-title-text' });
    titleLabel.tabIndex = 0;

    const titleInput = titleRow.createEl('input', {
      type: 'text',
      cls: 'kanban-next-board-title-input',
    });
    titleInput.hidden = true;

    titleLabel.addEventListener('click', () => {
      this.beginBoardTitleEdit();
    });

    titleLabel.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.beginBoardTitleEdit();
      }
    });

    titleInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void this.commitBoardTitleEdit();
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        this.cancelBoardTitleEdit();
      }
    });

    titleInput.addEventListener('blur', () => {
      if (!this.titleEditInProgress) {
        return;
      }
      void this.commitBoardTitleEdit();
    });

    const descriptionEl = headingEl.createEl('p', {
      cls: 'kanban-next-description is-hidden',
    });

    const actionEl = headerEl.createDiv({ cls: 'kanban-next-header-actions' });
    this.createButton(actionEl, 'Add column', async () => this.promptAddColumn());
    this.createButton(actionEl, 'Settings', async () => this.openBoardSettings());

    const filtersEl = boardEl.createDiv({ cls: 'kanban-next-filters' });

    const queryInput = filtersEl.createEl('input', {
      type: 'text',
      cls: 'kanban-next-filter-input',
      placeholder: 'Search cards',
    });

    queryInput.addEventListener('input', () => {
      this.store?.setFilterQuery(queryInput.value);
    });

    const tagInput = filtersEl.createEl('input', {
      type: 'text',
      cls: 'kanban-next-filter-input',
      placeholder: 'Filter by tag (#tag)',
    });

    const datalistId = `kanban-next-tags-${this.file?.path.replace(/[^A-Za-z0-9]/g, '-') || 'board'}`;
    tagInput.setAttribute('list', datalistId);

    const datalist = filtersEl.createEl('datalist');
    datalist.id = datalistId;

    tagInput.addEventListener('input', () => {
      this.store?.setFilterTag(tagInput.value);
    });

    this.createButton(filtersEl, 'Clear filters', () => this.store?.clearFilter());

    const lanesEl = boardEl.createDiv({ cls: 'kanban-next-lane-scroller' });

    this.boardTitleTextEl = titleLabel;
    this.boardTitleInputEl = titleInput;
    this.boardDescriptionEl = descriptionEl;

    this.queryInputEl = queryInput;
    this.tagInputEl = tagInput;
    this.tagDatalistEl = datalist;
    this.lanesEl = lanesEl;
  }

  private refreshTagDatalist(tags: string[]): void {
    if (!this.tagDatalistEl) {
      return;
    }

    const nextKey = tags.join('|');
    if (nextKey === this.tagOptionsCacheKey) {
      return;
    }

    this.tagOptionsCacheKey = nextKey;
    this.tagDatalistEl.empty();

    tags.forEach((tag) => {
      this.tagDatalistEl?.createEl('option', {
        value: tag,
      });
    });
  }

  private renderLanes(snapshot: ReturnType<BoardStore['getSnapshot']>): void {
    if (!this.lanesEl || !this.store) {
      return;
    }

    this.lanesEl.empty();

    const board = snapshot.board;
    const visibleColumns = snapshot.visibleColumns;

    if (visibleColumns.length === 0) {
      const empty = this.lanesEl.createDiv({ cls: 'kanban-next-empty-state' });
      empty.createEl('p', { text: 'No columns yet.' });
      this.createButton(empty, 'Add column', async () => this.promptAddColumn());
      return;
    }

    visibleColumns.forEach((visibleColumn, visibleIndex) => {
      const fullColumn = board.columns.find((column) => column.id === visibleColumn.id);
      const fullCount = fullColumn?.cards.length || 0;

      const laneEl = this.lanesEl?.createDiv({ cls: 'kanban-next-lane' });
      if (!laneEl) {
        return;
      }

      if (visibleColumn.cards.length === 0) {
        laneEl.addClass('is-empty');
      }

      laneEl.dataset.columnId = visibleColumn.id;

      laneEl.addEventListener('dragover', (event) => {
        if (this.columnDragState) {
          event.preventDefault();
          const insertionIndex = this.getColumnInsertionIndex(laneEl, visibleIndex, event.clientX);
          this.columnDropInsertionIndex = insertionIndex;
          this.setColumnDropIndicator(
            laneEl,
            insertionIndex <= visibleIndex ? 'before' : 'after'
          );
          return;
        }

        if (this.cardDragState) {
          event.preventDefault();
          laneEl.addClass('is-drop-target');
        }
      });

      laneEl.addEventListener('dragleave', (event) => {
        const target = event.relatedTarget as Node | null;
        if (target && laneEl.contains(target)) {
          return;
        }

        laneEl.removeClass('is-drop-target');
        laneEl.removeClass('is-column-drop-before');
        laneEl.removeClass('is-column-drop-after');
      });

      laneEl.addEventListener('drop', (event) => {
        event.preventDefault();
        laneEl.removeClass('is-drop-target');
        laneEl.removeClass('is-column-drop-before');
        laneEl.removeClass('is-column-drop-after');

        if (this.columnDragState) {
          const insertionIndex =
            this.columnDropInsertionIndex ??
            this.getColumnInsertionIndex(laneEl, visibleIndex, event.clientX);
          this.handleColumnDrop(insertionIndex);
          return;
        }

        if (!this.cardDragState) {
          return;
        }

        const targetCard = (event.target as HTMLElement).closest('.kanban-next-card');
        if (!targetCard) {
          this.handleCardDrop(visibleColumn.id, null);
        }
      });

      const laneHeader = laneEl.createDiv({ cls: 'kanban-next-lane-header' });
      const laneHeadLeft = laneHeader.createDiv({ cls: 'kanban-next-lane-head-left' });

      const dragHandle = this.createIconButton(
        laneHeadLeft,
        'grip-vertical',
        'Drag column',
        () => {
          // Drag handled by native drag events.
        },
        'kanban-next-column-drag-handle'
      );

      dragHandle.draggable = true;
      dragHandle.addEventListener('dragstart', (event) => {
        this.columnDragState = {
          sourceColumnId: visibleColumn.id,
        };
        this.columnDropInsertionIndex = null;

        event.dataTransfer?.setData('text/plain', visibleColumn.id);
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move';
        }

        laneEl.addClass('is-dragging-column');
      });

      dragHandle.addEventListener('dragend', () => {
        this.columnDragState = null;
        this.columnDropInsertionIndex = null;
        this.clearDropTargetStyles();
        laneEl.removeClass('is-dragging-column');
      });

      const titleWrap = laneHeadLeft.createDiv({ cls: 'kanban-next-lane-title' });
      const titleText = titleWrap.createSpan({
        cls: 'kanban-next-lane-title-text',
        text: visibleColumn.title,
      });
      titleText.tabIndex = 0;

      const titleInput = titleWrap.createEl('input', {
        type: 'text',
        cls: 'kanban-next-lane-title-input',
      });
      titleInput.hidden = true;

      const countEl = titleWrap.createSpan({
        cls: 'kanban-next-lane-count',
        text:
          snapshot.filter.query || snapshot.filter.tag
            ? `${visibleColumn.cards.length}/${fullCount}`
            : `${visibleColumn.cards.length}`,
      });

      const wipLimit = fullColumn?.wipLimit;
      if (typeof wipLimit === 'number') {
        countEl.setText(`${countEl.textContent} (WIP ${wipLimit})`);
        if (fullCount > wipLimit) {
          laneEl.addClass('is-wip-exceeded');
        }
      }

      let columnTitleEditInProgress = false;

      const beginColumnTitleEdit = () => {
        if (columnTitleEditInProgress) {
          return;
        }

        columnTitleEditInProgress = true;
        titleText.hidden = true;
        countEl.hidden = true;
        titleInput.hidden = false;
        titleInput.value = visibleColumn.title;

        window.setTimeout(() => {
          titleInput.focus();
          titleInput.select();
        }, 0);
      };

      const cancelColumnTitleEdit = () => {
        if (!columnTitleEditInProgress) {
          return;
        }

        columnTitleEditInProgress = false;
        titleInput.hidden = true;
        titleText.hidden = false;
        countEl.hidden = false;
        titleInput.value = visibleColumn.title;
      };

      const commitColumnTitleEdit = () => {
        if (!columnTitleEditInProgress) {
          return;
        }

        const nextTitle = titleInput.value.trim();
        if (!nextTitle || nextTitle === visibleColumn.title) {
          cancelColumnTitleEdit();
          return;
        }

        this.store?.renameColumn(visibleColumn.id, nextTitle);
        this.schedulePersist();
        columnTitleEditInProgress = false;
      };

      titleText.addEventListener('click', () => {
        beginColumnTitleEdit();
      });

      titleText.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          beginColumnTitleEdit();
        }
      });

      titleInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commitColumnTitleEdit();
          return;
        }

        if (event.key === 'Escape') {
          event.preventDefault();
          cancelColumnTitleEdit();
        }
      });

      titleInput.addEventListener('blur', () => {
        commitColumnTitleEdit();
      });

      const laneActions = laneHeader.createDiv({ cls: 'kanban-next-lane-actions' });

      this.createIconButton(laneActions, 'ellipsis', 'Column actions', (event) => {
        this.openColumnMenu(event, visibleColumn.id, visibleColumn.title, beginColumnTitleEdit);
      });

      const cardsEl = laneEl.createDiv({ cls: 'kanban-next-cards' });

      cardsEl.addEventListener('dragover', (event) => {
        if (!this.cardDragState) {
          return;
        }

        event.preventDefault();
        cardsEl.addClass('is-drop-target');
      });

      cardsEl.addEventListener('dragleave', (event) => {
        const target = event.relatedTarget as Node | null;
        if (target && cardsEl.contains(target)) {
          return;
        }

        cardsEl.removeClass('is-drop-target');
      });

      cardsEl.addEventListener('drop', (event) => {
        if (!this.cardDragState) {
          return;
        }

        event.preventDefault();
        cardsEl.removeClass('is-drop-target');

        const targetCard = (event.target as HTMLElement).closest('.kanban-next-card');
        if (!targetCard) {
          this.handleCardDrop(visibleColumn.id, null);
        }
      });

      visibleColumn.cards.forEach((card) => {
        const cardEl = cardsEl.createDiv({ cls: 'kanban-next-card' });
        cardEl.dataset.cardId = card.id;

        cardEl.draggable = true;

        cardEl.addEventListener('dragstart', (event) => {
          this.cardDragState = {
            cardId: card.id,
            sourceColumnId: visibleColumn.id,
          };

          event.dataTransfer?.setData('text/plain', card.id);
          if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move';
          }

          cardEl.addClass('is-dragging');
        });

        cardEl.addEventListener('dragend', () => {
          this.cardDragState = null;
          cardEl.removeClass('is-dragging');
          this.clearDropTargetStyles();
        });

        cardEl.addEventListener('dragover', (event) => {
          if (!this.cardDragState) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          cardEl.addClass('is-drop-target');
        });

        cardEl.addEventListener('dragleave', (event) => {
          const target = event.relatedTarget as Node | null;
          if (target && cardEl.contains(target)) {
            return;
          }

          cardEl.removeClass('is-drop-target');
        });

        cardEl.addEventListener('drop', (event) => {
          if (!this.cardDragState) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          cardEl.removeClass('is-drop-target');
          this.handleCardDrop(visibleColumn.id, card.id);
        });

        if (card.dueDate) {
          const cardTop = cardEl.createDiv({ cls: 'kanban-next-card-top' });
          cardTop.createSpan({
            cls: 'kanban-next-due-chip',
            text: card.dueDate,
          });
        }

        cardEl.createDiv({
          cls: 'kanban-next-card-title',
          text: card.title,
        });

        if (card.description) {
          cardEl.createDiv({
            cls: 'kanban-next-card-preview',
            text: card.description.split('\n')[0] || '',
          });
        }

        if (card.tags.length > 0) {
          const tagRow = cardEl.createDiv({ cls: 'kanban-next-tag-row' });
          card.tags.forEach((tag) => {
            tagRow.createSpan({
              cls: 'kanban-next-tag-chip',
              text: tag,
            });
          });
        }

        cardEl.addEventListener('click', () => {
          void this.editCard(visibleColumn.id, card.id);
        });
      });

      const laneFooter = laneEl.createDiv({ cls: 'kanban-next-lane-footer' });
      const addCardButton = this.createButton(
        laneFooter,
        'Add Card',
        async () => {
          const created = this.createBlankCard();
          this.store?.addCard(visibleColumn.id, created, 'bottom');
          this.schedulePersist();
          await this.editCard(visibleColumn.id, created.id);
        },
        'kanban-next-button kanban-next-lane-add-card'
      );

      const addIcon = addCardButton.createSpan({ cls: 'kanban-next-inline-icon' });
      setIcon(addIcon, 'plus');
      addCardButton.prepend(addIcon);

      addCardButton.setAttr('aria-label', `Add card to ${visibleColumn.title}`);
      addCardButton.setAttr('title', 'Add card');
    });
  }

  private async editCard(columnId: string, cardId: string): Promise<void> {
    if (!this.store) {
      return;
    }

    const card = this.store.getCard(columnId, cardId);
    if (!card) {
      return;
    }

    const result = await openCardEditorModal(
      this.app,
      {
        title: card.title,
        description: card.description,
        dueDate: card.dueDate,
        checked: card.checked,
      },
      {
        allowFallback: this.plugin.settings.enableNativeEditorFallback,
      }
    );

    if (!result) {
      return;
    }

    this.store.updateCard(columnId, cardId, (current) => ({
      ...current,
      title: result.title,
      description: result.description,
      dueDate: result.dueDate,
      checked: result.checked,
    }));

    this.schedulePersist();
  }

  private async insertFromClipboard(
    columnId: string,
    position: 'before' | 'after'
  ): Promise<void> {
    if (!this.store) {
      return;
    }

    const clipboard = await this.readClipboardText();
    if (!clipboard) {
      return;
    }

    const parsed = parseClipboardList(clipboard);
    if (parsed.length === 0) {
      new Notice('No list items found in clipboard text.');
      return;
    }

    const cards = parsed.map<Card>((entry) => {
      return normalizeCard({
        id: createId('card'),
        title: entry.title,
        description: '',
        checked: entry.checked,
        dueDate: null,
      });
    });

    const inserted = this.store.insertCardsFromParsedLines(columnId, cards, position);
    if (inserted > 0) {
      this.schedulePersist();
      new Notice(`Inserted ${inserted} cards.`);
    }
  }

  private async readClipboardText(): Promise<string | null> {
    try {
      if (navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
        const text = await navigator.clipboard.readText();
        if (text.trim()) {
          return text;
        }
      }
    } catch {
      // Fall back to manual paste.
    }

    return promptForMultilineText(this.app, {
      title: 'Paste list items',
      placeholder: 'Paste list lines here',
      submitLabel: 'Insert',
      rows: 12,
    });
  }

  private openColumnMenu(
    event: MouseEvent,
    columnId: string,
    columnTitle: string,
    onRename: () => void
  ): void {
    if (!this.store) {
      return;
    }

    const menu = new Menu();

    menu.addItem((item) => {
      item
        .setTitle('Rename column')
        .setIcon('pencil')
        .onClick(() => {
          onRename();
        });
    });

    menu.addItem((item) => {
      item
        .setTitle('Clear column')
        .setIcon('trash')
        .onClick(() => {
          const cleared = this.store?.clearColumnCards(columnId) || 0;
          if (cleared > 0) {
            this.schedulePersist();
            new Notice(`Cleared ${cleared} cards.`);
          } else {
            new Notice('No cards to clear.');
          }
        });
    });

    menu.addItem((item) => {
      item
        .setTitle('Insert list before')
        .setIcon('list-start')
        .onClick(() => {
          void this.insertFromClipboard(columnId, 'before');
        });
    });

    menu.addItem((item) => {
      item
        .setTitle('Insert list after')
        .setIcon('list-end')
        .onClick(() => {
          void this.insertFromClipboard(columnId, 'after');
        });
    });

    menu.addSeparator();

    menu.addItem((item) => {
      item
        .setTitle('Delete column')
        .setIcon('trash-2')
        .onClick(() => {
          const confirmed = window.confirm(`Delete column "${columnTitle}" and its cards?`);
          if (!confirmed) {
            return;
          }

          this.store?.deleteColumn(columnId);
          this.schedulePersist();
        });
    });

    menu.showAtMouseEvent(event);
  }

  private getColumnInsertionIndex(
    laneEl: HTMLElement,
    laneIndex: number,
    pointerClientX: number
  ): number {
    const rect = laneEl.getBoundingClientRect();
    const midpoint = rect.left + rect.width / 2;
    return pointerClientX < midpoint ? laneIndex : laneIndex + 1;
  }

  private setColumnDropIndicator(laneEl: HTMLElement, side: 'before' | 'after'): void {
    this.rootEl?.querySelectorAll('.is-column-drop-before, .is-column-drop-after').forEach((node) => {
      node.removeClass('is-column-drop-before');
      node.removeClass('is-column-drop-after');
    });

    laneEl.addClass(side === 'before' ? 'is-column-drop-before' : 'is-column-drop-after');
  }

  private handleCardDrop(targetColumnId: string, targetCardId: string | null): void {
    if (!this.store || !this.cardDragState) {
      return;
    }

    const board = this.store.getBoard();
    const targetColumn = board.columns.find((column) => column.id === targetColumnId);
    if (!targetColumn) {
      return;
    }

    const targetIndex =
      targetCardId === null
        ? targetColumn.cards.length
        : targetColumn.cards.findIndex((card) => card.id === targetCardId);

    this.store.moveCard(
      this.cardDragState.sourceColumnId,
      this.cardDragState.cardId,
      targetColumnId,
      targetIndex < 0 ? targetColumn.cards.length : targetIndex
    );

    this.cardDragState = null;
    this.schedulePersist();
  }

  private handleColumnDrop(targetInsertionIndex: number): void {
    if (!this.store || !this.columnDragState) {
      return;
    }

    const board = this.store.getBoard();
    const sourceIndex = board.columns.findIndex(
      (column) => column.id === this.columnDragState?.sourceColumnId
    );

    if (sourceIndex < 0) {
      return;
    }

    let targetIndex = Math.max(0, Math.min(targetInsertionIndex, board.columns.length));
    if (sourceIndex < targetIndex) {
      targetIndex -= 1;
    }

    if (sourceIndex === targetIndex) {
      this.columnDragState = null;
      this.columnDropInsertionIndex = null;
      this.clearDropTargetStyles();
      return;
    }

    this.store.moveColumn(this.columnDragState.sourceColumnId, targetIndex);
    this.columnDragState = null;
    this.columnDropInsertionIndex = null;
    this.clearDropTargetStyles();
    this.schedulePersist();
  }

  private beginBoardTitleEdit(): void {
    if (!this.boardTitleInputEl || !this.boardTitleTextEl || this.titleEditInProgress) {
      return;
    }

    this.titleEditInProgress = true;
    this.boardTitleInputEl.hidden = false;
    this.boardTitleTextEl.hidden = true;

    this.boardTitleInputEl.value = this.file?.basename || this.boardTitleTextEl.textContent || '';

    window.setTimeout(() => {
      this.boardTitleInputEl?.focus();
      this.boardTitleInputEl?.select();
    }, 0);
  }

  private cancelBoardTitleEdit(): void {
    this.titleEditInProgress = false;

    if (this.boardTitleInputEl) {
      this.boardTitleInputEl.hidden = true;
    }

    if (this.boardTitleTextEl) {
      this.boardTitleTextEl.hidden = false;
    }

    if (this.store && this.boardTitleInputEl) {
      this.boardTitleInputEl.value = this.store.getBoard().boardTitle;
    }
  }

  private async commitBoardTitleEdit(): Promise<void> {
    if (!this.store || !this.file || !this.boardTitleInputEl || !this.titleEditInProgress) {
      return;
    }

    const nextTitle = this.boardTitleInputEl.value.trim();
    if (!nextTitle) {
      this.cancelBoardTitleEdit();
      return;
    }

    try {
      const renamed = await this.plugin.renameBoardFile(this.file, nextTitle);
      const board = this.store.getBoard();
      this.store.setBoardMetadata({
        boardTitle: renamed.basename,
        boardDescription: board.boardDescription,
        density: board.density,
      });
      this.schedulePersist();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : 'Could not rename board file.');
    } finally {
      this.cancelBoardTitleEdit();
    }
  }

  private syncBoardTitleWithFile(shouldPersist: boolean): void {
    if (!this.store || !this.file) {
      return;
    }

    const board = this.store.getBoard();
    if (board.boardTitle === this.file.basename) {
      return;
    }

    this.store.setBoardMetadata({
      boardTitle: this.file.basename,
      boardDescription: board.boardDescription,
      density: board.density,
    });

    if (shouldPersist) {
      this.schedulePersist();
    }
  }

  private createBlankCard(): Card {
    return normalizeCard({
      id: createId('card'),
      title: 'New card',
      description: '',
      checked: false,
      dueDate: null,
    });
  }

  private schedulePersist(): void {
    if (!this.store) {
      return;
    }

    this.saveQueue.request(this.store.toMarkdown());
  }

  private clearDropTargetStyles(): void {
    this.rootEl
      ?.querySelectorAll(
        '.is-drop-target, .is-column-drop-before, .is-column-drop-after'
      )
      .forEach((node) => {
      node.removeClass('is-drop-target');
      node.removeClass('is-column-drop-before');
      node.removeClass('is-column-drop-after');
    });
  }

  private renderError(message: string): void {
    if (!this.rootEl) {
      return;
    }

    this.rootEl.empty();

    const panel = this.rootEl.createDiv({ cls: 'kanban-next-error' });
    panel.createEl('h3', { text: 'Kanban board could not be parsed' });
    panel.createEl('p', { text: message });

    this.createButton(panel, 'Open as markdown', async () => this.plugin.setMarkdownView(this.leaf));
  }

  private createButton(
    parent: HTMLElement,
    label: string,
    onClick: (event: MouseEvent) => void | Promise<void>,
    className = 'kanban-next-button'
  ): HTMLButtonElement {
    const button = parent.createEl('button', {
      text: label,
      cls: className,
    });

    button.addEventListener('click', (event) => {
      void onClick(event);
    });

    return button;
  }

  private createIconButton(
    parent: HTMLElement,
    icon: string,
    label: string,
    onClick: (event: MouseEvent) => void | Promise<void>,
    className = 'kanban-next-icon-button'
  ): HTMLButtonElement {
    const button = parent.createEl('button', { cls: className });
    setIcon(button, icon);
    button.setAttr('aria-label', label);
    button.setAttr('title', label);

    button.addEventListener('click', (event) => {
      event.stopPropagation();
      void onClick(event);
    });

    return button;
  }
}
