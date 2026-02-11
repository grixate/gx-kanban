import { Menu, Notice, TFile, TextFileView, WorkspaceLeaf, normalizePath, setIcon } from 'obsidian';

import KanbanNextPlugin from '../main';
import { openConfirmModal } from '../modals/ConfirmModal';
import { promptForMultilineText, promptForText } from '../modals/PromptModal';
import { openBoardSettingsModal } from '../modals/BoardSettingsModal';
import { clampEditableCardText, fromEditableCardText, toEditableCardText } from '../model/cardContent';
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
const CARD_TEXT_MAX_LENGTH = 1000;

interface CardDragState {
  cardId: string;
  sourceColumnId: string;
}

interface ColumnDragState {
  sourceColumnId: string;
}

interface InlineCardEditState {
  columnId: string;
  cardId: string;
  draft: string;
  original: string;
  showCounter: boolean;
}

type ActivePopover = 'search' | 'filter';

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
  private columnLaneEls: HTMLElement[];
  private activePopover: ActivePopover | null;
  private searchPopoverEl: HTMLElement | null;
  private filterPopoverEl: HTMLElement | null;
  private searchPopoverButtonEl: HTMLButtonElement | null;
  private filterPopoverButtonEl: HTMLButtonElement | null;

  private store: BoardStore | null;
  private unsubscribeStore: (() => void) | null;
  private saveQueue: SaveQueue;
  private pendingSavePayload: string | null;

  private cardDragState: CardDragState | null;
  private cardDragPreviewHeight: number;
  private cardDropIndicatorEl: HTMLElement | null;
  private cardDropTargetColumnId: string | null;
  private cardDropTargetCardId: string | null;
  private columnDragState: ColumnDragState | null;
  private columnDragPreviewWidth: number;
  private columnDragPreviewHeight: number;
  private columnDropIndicatorEl: HTMLElement | null;
  private columnDropInsertionIndex: number | null;
  private editingCard: InlineCardEditState | null;
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
    this.columnLaneEls = [];
    this.activePopover = null;
    this.searchPopoverEl = null;
    this.filterPopoverEl = null;
    this.searchPopoverButtonEl = null;
    this.filterPopoverButtonEl = null;

    this.store = null;
    this.unsubscribeStore = null;

    this.pendingSavePayload = null;
    this.cardDragState = null;
    this.cardDragPreviewHeight = 64;
    this.cardDropIndicatorEl = null;
    this.cardDropTargetColumnId = null;
    this.cardDropTargetCardId = null;
    this.columnDragState = null;
    this.columnDragPreviewWidth = 320;
    this.columnDragPreviewHeight = 240;
    this.columnDropIndicatorEl = null;
    this.columnDropInsertionIndex = null;
    this.editingCard = null;
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

    this.registerDomEvent(document, 'mousedown', (event) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (!this.rootEl?.contains(target)) {
        this.setActivePopover(null);
      }
    });

    this.registerDomEvent(document, 'keydown', (event) => {
      if (event.key === 'Escape') {
        this.setActivePopover(null);
      }
    });

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
    this.cardDragPreviewHeight = 64;
    this.clearCardDropIndicator();
    this.columnDragState = null;
    this.columnDragPreviewWidth = 320;
    this.columnDragPreviewHeight = 240;
    this.clearColumnDropIndicator();
    this.columnDropInsertionIndex = null;
    this.editingCard = null;
    this.pendingSavePayload = null;
    this.titleEditInProgress = false;

    this.saveQueue.destroy();

    this.boardEl = null;
    this.lanesEl?.removeClass('is-column-dragging');
    this.lanesEl = null;
    this.boardTitleTextEl = null;
    this.boardTitleInputEl = null;
    this.boardDescriptionEl = null;
    this.queryInputEl = null;
    this.tagInputEl = null;
    this.tagDatalistEl = null;
    this.tagOptionsCacheKey = '';
    this.columnLaneEls = [];
    this.activePopover = null;
    this.searchPopoverEl = null;
    this.filterPopoverEl = null;
    this.searchPopoverButtonEl = null;
    this.filterPopoverButtonEl = null;

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
    this.beginInlineCardEdit(firstColumn.id, created.id, '');
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

    const toolbarEl = headerEl.createDiv({ cls: 'kanban-next-toolbar' });

    const searchControlEl = toolbarEl.createDiv({ cls: 'kanban-next-toolbar-control' });
    const searchButton = this.createIconButton(
      searchControlEl,
      'search',
      'Search cards',
      () => {
        this.togglePopover('search');
      },
      'kanban-next-icon-button kanban-next-plain-icon-button'
    );

    const searchPopover = searchControlEl.createDiv({ cls: 'kanban-next-toolbar-popover' });

    const queryInput = searchPopover.createEl('input', {
      type: 'text',
      cls: 'kanban-next-filter-input',
      placeholder: 'Search cards…',
    });
    queryInput.setAttr('aria-label', 'Search cards');

    queryInput.addEventListener('input', () => {
      this.store?.setFilterQuery(queryInput.value);
    });

    const filterControlEl = toolbarEl.createDiv({ cls: 'kanban-next-toolbar-control' });
    const filterButton = this.createIconButton(
      filterControlEl,
      'list-filter',
      'Filter cards',
      () => {
        this.togglePopover('filter');
      },
      'kanban-next-icon-button kanban-next-plain-icon-button'
    );

    const filterPopover = filterControlEl.createDiv({ cls: 'kanban-next-toolbar-popover' });

    const tagInput = filterPopover.createEl('input', {
      type: 'text',
      cls: 'kanban-next-filter-input',
      placeholder: 'Filter by tag (#tag)…',
    });
    tagInput.setAttr('aria-label', 'Filter cards by tag');

    const datalistId = `kanban-next-tags-${this.file?.path.replace(/[^A-Za-z0-9]/g, '-') || 'board'}`;
    tagInput.setAttribute('list', datalistId);

    const datalist = filterPopover.createEl('datalist');
    datalist.id = datalistId;

    tagInput.addEventListener('input', () => {
      this.store?.setFilterTag(tagInput.value);
    });

    this.createButton(
      filterPopover,
      'Clear filters',
      () => this.store?.clearFilter(),
      'kanban-next-button kanban-next-popover-clear-button'
    );

    this.createIconButton(
      toolbarEl,
      'plus-circle',
      'Add column',
      async () => this.promptAddColumn(),
      'kanban-next-icon-button kanban-next-plain-icon-button'
    );
    this.createIconButton(
      toolbarEl,
      'settings',
      'Board settings',
      async () => this.openBoardSettings(),
      'kanban-next-icon-button kanban-next-plain-icon-button'
    );

    const lanesEl = boardEl.createDiv({ cls: 'kanban-next-lane-scroller' });
    this.registerColumnDragListeners(lanesEl);

    this.boardTitleTextEl = titleLabel;
    this.boardTitleInputEl = titleInput;
    this.boardDescriptionEl = descriptionEl;

    this.queryInputEl = queryInput;
    this.tagInputEl = tagInput;
    this.tagDatalistEl = datalist;
    this.searchPopoverEl = searchPopover;
    this.filterPopoverEl = filterPopover;
    this.searchPopoverButtonEl = searchButton;
    this.filterPopoverButtonEl = filterButton;
    this.lanesEl = lanesEl;

    this.setActivePopover(null);
  }

  private togglePopover(popover: ActivePopover): void {
    this.setActivePopover(this.activePopover === popover ? null : popover);
  }

  private setActivePopover(popover: ActivePopover | null): void {
    this.activePopover = popover;

    const searchOpen = popover === 'search';
    const filterOpen = popover === 'filter';

    if (this.searchPopoverEl) {
      this.searchPopoverEl.toggleClass('is-open', searchOpen);
    }

    if (this.filterPopoverEl) {
      this.filterPopoverEl.toggleClass('is-open', filterOpen);
    }

    this.searchPopoverButtonEl?.toggleClass('is-active', searchOpen);
    this.filterPopoverButtonEl?.toggleClass('is-active', filterOpen);

    if (searchOpen && this.queryInputEl) {
      window.setTimeout(() => this.queryInputEl?.focus(), 0);
    }

    if (filterOpen && this.tagInputEl) {
      window.setTimeout(() => this.tagInputEl?.focus(), 0);
    }
  }

  private registerColumnDragListeners(lanesEl: HTMLElement): void {
    lanesEl.addEventListener('dragover', (event) => {
      if (!this.columnDragState) {
        return;
      }

      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move';
      }

      this.maybeAutoScrollLanes(event.clientX);

      const preview = this.getColumnDropPreview(event.clientX);
      if (!preview) {
        return;
      }

      this.columnDropInsertionIndex = preview.insertionIndex;
      this.moveColumnDropIndicator(lanesEl, preview.beforeLaneEl, preview.insertionIndex);
    });

    lanesEl.addEventListener('dragleave', (event) => {
      if (!this.columnDragState) {
        return;
      }

      const target = event.relatedTarget as Node | null;
      if (target && lanesEl.contains(target)) {
        return;
      }

      this.columnDropInsertionIndex = null;
      this.clearColumnDropIndicator();
    });

    lanesEl.addEventListener('drop', (event) => {
      if (!this.columnDragState) {
        return;
      }

      event.preventDefault();
      const preview = this.getColumnDropPreview(event.clientX);
      const insertionIndex =
        this.columnDropInsertionIndex ?? preview?.insertionIndex ?? this.columnLaneEls.length;
      this.handleColumnDrop(insertionIndex);
    });
  }

  private maybeAutoScrollLanes(pointerClientX: number): void {
    if (!this.lanesEl) {
      return;
    }

    const rect = this.lanesEl.getBoundingClientRect();
    const edgeThreshold = 56;
    const step = 18;

    if (pointerClientX <= rect.left + edgeThreshold) {
      this.lanesEl.scrollLeft -= step;
      return;
    }

    if (pointerClientX >= rect.right - edgeThreshold) {
      this.lanesEl.scrollLeft += step;
    }
  }

  private getColumnDropPreview(pointerClientX: number): {
    insertionIndex: number;
    beforeLaneEl: HTMLElement | null;
  } | null {
    if (this.columnLaneEls.length === 0) {
      return null;
    }

    const firstLane = this.columnLaneEls[0];
    if (!firstLane) {
      return null;
    }

    const firstRect = firstLane.getBoundingClientRect();
    const firstBoundary = firstRect.left + firstRect.width * 0.72;
    if (pointerClientX <= firstBoundary) {
      return {
        insertionIndex: 0,
        beforeLaneEl: firstLane,
      };
    }

    for (let index = 1; index < this.columnLaneEls.length; index += 1) {
      const lane = this.columnLaneEls[index];
      if (!lane) {
        continue;
      }

      const rect = lane.getBoundingClientRect();
      if (pointerClientX <= rect.left + rect.width / 2) {
        return {
          insertionIndex: index,
          beforeLaneEl: lane,
        };
      }
    }

    const lastLane = this.columnLaneEls[this.columnLaneEls.length - 1];
    if (!lastLane) {
      return null;
    }

    return {
      insertionIndex: this.columnLaneEls.length,
      beforeLaneEl: null,
    };
  }

  private moveColumnDropIndicator(
    lanesEl: HTMLElement,
    beforeLaneEl: HTMLElement | null,
    insertionIndex: number
  ): void {
    const indicator = this.ensureColumnDropIndicator();
    const placementUnchanged =
      indicator.parentElement === lanesEl &&
      (beforeLaneEl ? indicator.nextElementSibling === beforeLaneEl : lanesEl.lastElementChild === indicator);

    indicator.style.setProperty(
      '--kanban-next-drop-column-width',
      `${Math.max(240, Math.round(this.columnDragPreviewWidth))}px`
    );
    indicator.style.setProperty(
      '--kanban-next-drop-column-height',
      `${Math.max(180, Math.round(this.columnDragPreviewHeight))}px`
    );

    if (placementUnchanged) {
      this.columnDropInsertionIndex = insertionIndex;
      return;
    }

    const insertIndicator = () => {
      if (beforeLaneEl) {
        lanesEl.insertBefore(indicator, beforeLaneEl);
      } else {
        lanesEl.appendChild(indicator);
      }
    };

    this.animateLaneReflow(lanesEl, insertIndicator);
    this.columnDropInsertionIndex = insertionIndex;
  }

  private ensureColumnDropIndicator(): HTMLElement {
    if (!this.columnDropIndicatorEl) {
      this.columnDropIndicatorEl = document.createElement('div');
      this.columnDropIndicatorEl.addClass('kanban-next-column-drop-indicator');
    }

    return this.columnDropIndicatorEl;
  }

  private clearColumnDropIndicator(): void {
    if (this.lanesEl && this.columnDropIndicatorEl?.parentElement === this.lanesEl) {
      this.animateLaneReflow(this.lanesEl, () => {
        this.columnDropIndicatorEl?.remove();
      });
    } else {
      this.columnDropIndicatorEl?.remove();
    }

    this.columnDropInsertionIndex = null;
  }

  private animateLaneReflow(lanesEl: HTMLElement, mutate: () => void): void {
    const lanes = Array.from(lanesEl.querySelectorAll('.kanban-next-lane')).filter(
      (node): node is HTMLElement => {
        return node instanceof HTMLElement && !node.hasClass('is-dragging-column');
      }
    );

    const beforeLeft = new Map<HTMLElement, number>();
    lanes.forEach((lane) => beforeLeft.set(lane, lane.getBoundingClientRect().left));

    mutate();

    const shifted: Array<{ lane: HTMLElement; delta: number }> = [];
    lanes.forEach((lane) => {
      const prev = beforeLeft.get(lane);
      if (typeof prev !== 'number') {
        return;
      }

      const next = lane.getBoundingClientRect().left;
      const delta = prev - next;
      if (Math.abs(delta) < 0.5) {
        return;
      }

      shifted.push({ lane, delta });
      lane.setCssProps({
        transition: 'none',
        transform: `translateX(${delta}px)`,
      });
    });

    if (shifted.length === 0) {
      return;
    }

    window.requestAnimationFrame(() => {
      shifted.forEach(({ lane }) => {
        lane.setCssProps({
          transition: 'transform 130ms ease',
          transform: '',
        });
      });

      window.setTimeout(() => {
        shifted.forEach(({ lane }) => {
          lane.setCssProps({
            transition: '',
          });
        });
      }, 170);
    });
  }

  private moveCardDropIndicator(
    cardsEl: HTMLElement,
    columnId: string,
    beforeCardEl: HTMLElement | null
  ): void {
    const indicator = this.ensureCardDropIndicator();
    const placementUnchanged =
      indicator.parentElement === cardsEl &&
      (beforeCardEl
        ? indicator.nextElementSibling === beforeCardEl
        : cardsEl.lastElementChild === indicator);

    indicator.style.setProperty(
      '--kanban-next-drop-card-height',
      `${Math.max(40, Math.round(this.cardDragPreviewHeight))}px`
    );

    if (!placementUnchanged) {
      const oldParent = indicator.parentElement;
      const insertIndicator = () => {
        if (beforeCardEl) {
          cardsEl.insertBefore(indicator, beforeCardEl);
        } else {
          cardsEl.appendChild(indicator);
        }
      };

      if (oldParent && oldParent !== cardsEl) {
        this.animateCardReflow(oldParent, () => {
          indicator.remove();
        });
        this.animateCardReflow(cardsEl, insertIndicator);
      } else {
        this.animateCardReflow(cardsEl, insertIndicator);
      }
    }

    this.cardDropTargetColumnId = columnId;
    this.cardDropTargetCardId = beforeCardEl?.dataset.cardId || null;
  }

  private ensureCardDropIndicator(): HTMLElement {
    if (!this.cardDropIndicatorEl) {
      this.cardDropIndicatorEl = document.createElement('div');
      this.cardDropIndicatorEl.addClass('kanban-next-card-drop-indicator');
    }

    return this.cardDropIndicatorEl;
  }

  private clearCardDropIndicator(): void {
    const oldParent = this.cardDropIndicatorEl?.parentElement;
    if (oldParent && this.cardDropIndicatorEl) {
      this.animateCardReflow(oldParent, () => {
        this.cardDropIndicatorEl?.remove();
      });
    } else {
      this.cardDropIndicatorEl?.remove();
    }

    this.cardDropTargetColumnId = null;
    this.cardDropTargetCardId = null;
  }

  private updateCardDropIndicatorFromPointer(
    cardsEl: HTMLElement,
    columnId: string,
    pointerClientY: number
  ): void {
    const beforeCardEl = this.getCardDropBeforeElement(cardsEl, pointerClientY);
    this.moveCardDropIndicator(cardsEl, columnId, beforeCardEl);
  }

  private getCardDropBeforeElement(cardsEl: HTMLElement, pointerClientY: number): HTMLElement | null {
    const cards = Array.from(cardsEl.querySelectorAll('.kanban-next-card')).filter(
      (node): node is HTMLElement => {
        return node instanceof HTMLElement && !node.hasClass('is-dragging');
      }
    );

    for (const cardEl of cards) {
      const rect = cardEl.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;
      if (pointerClientY < midpoint) {
        return cardEl;
      }
    }

    return null;
  }

  private animateCardReflow(cardsEl: HTMLElement, mutate: () => void): void {
    const cards = Array.from(cardsEl.querySelectorAll('.kanban-next-card')).filter(
      (node): node is HTMLElement => {
        return node instanceof HTMLElement && !node.hasClass('is-dragging');
      }
    );

    const beforeTop = new Map<HTMLElement, number>();
    cards.forEach((card) => beforeTop.set(card, card.getBoundingClientRect().top));

    mutate();

    const shifted: Array<{ card: HTMLElement; delta: number }> = [];
    cards.forEach((card) => {
      const prev = beforeTop.get(card);
      if (typeof prev !== 'number') {
        return;
      }

      const next = card.getBoundingClientRect().top;
      const delta = prev - next;
      if (Math.abs(delta) < 0.5) {
        return;
      }

      shifted.push({ card, delta });
      card.setCssProps({
        transition: 'none',
        transform: `translateY(${delta}px)`,
      });
    });

    if (shifted.length === 0) {
      return;
    }

    window.requestAnimationFrame(() => {
      shifted.forEach(({ card }) => {
        card.setCssProps({
          transition: 'transform 120ms ease',
          transform: '',
        });
      });

      window.setTimeout(() => {
        shifted.forEach(({ card }) => {
          card.setCssProps({
            transition: '',
          });
        });
      }, 150);
    });
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
    this.columnLaneEls = [];

    const board = snapshot.board;
    const visibleColumns = snapshot.visibleColumns;

    if (visibleColumns.length === 0) {
      const empty = this.lanesEl.createDiv({ cls: 'kanban-next-empty-state' });
      empty.createEl('p', { text: 'No columns yet.' });
      this.createButton(empty, 'Add column', async () => this.promptAddColumn());
      return;
    }

    visibleColumns.forEach((visibleColumn) => {
      const fullColumn = board.columns.find((column) => column.id === visibleColumn.id);
      const fullCount = fullColumn?.cards.length || 0;

      const laneEl = this.lanesEl?.createDiv({ cls: 'kanban-next-lane' });
      if (!laneEl) {
        return;
      }
      this.columnLaneEls.push(laneEl);

      if (visibleColumn.cards.length === 0) {
        laneEl.addClass('is-empty');
      }

      laneEl.dataset.columnId = visibleColumn.id;

      laneEl.addEventListener('dragover', (event) => {
        if (this.cardDragState) {
          event.preventDefault();
          this.updateCardDropIndicatorFromPointer(cardsEl, visibleColumn.id, event.clientY);
        }
      });

      laneEl.addEventListener('dragleave', (event) => {
        const target = event.relatedTarget as Node | null;
        if (target && laneEl.contains(target)) {
          return;
        }
        this.clearCardDropIndicator();
      });

      laneEl.addEventListener('drop', (event) => {
        if (!this.cardDragState) {
          return;
        }

        event.preventDefault();

        if (this.cardDropTargetColumnId === visibleColumn.id) {
          this.handleCardDrop(visibleColumn.id, this.cardDropTargetCardId);
          return;
        }

        const targetCard = (event.target as HTMLElement).closest('.kanban-next-card');
        if (targetCard instanceof HTMLElement && targetCard.dataset.cardId) {
          this.handleCardDrop(visibleColumn.id, targetCard.dataset.cardId);
          return;
        }

        this.handleCardDrop(visibleColumn.id, null);
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
        'kanban-next-column-drag-handle kanban-next-ghost-icon-button'
      );

      dragHandle.draggable = true;
      dragHandle.addEventListener('dragstart', (event) => {
        this.clearCardDropIndicator();
        this.clearColumnDropIndicator();
        this.columnDragState = {
          sourceColumnId: visibleColumn.id,
        };
        this.columnDropInsertionIndex = null;
        const laneRect = laneEl.getBoundingClientRect();
        this.columnDragPreviewWidth = laneRect.width;
        this.columnDragPreviewHeight = laneRect.height;

        event.dataTransfer?.setData('text/plain', visibleColumn.id);
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setDragImage(laneEl, 20, 20);
        }

        this.lanesEl?.addClass('is-column-dragging');
        laneEl.addClass('is-dragging-column');
      });

      dragHandle.addEventListener('dragend', () => {
        this.columnDragState = null;
        this.columnDragPreviewWidth = 320;
        this.columnDragPreviewHeight = 240;
        this.clearColumnDropIndicator();
        this.clearDropTargetStyles();
        this.lanesEl?.removeClass('is-column-dragging');
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

      const laneActions = laneHeader.createDiv({ cls: 'kanban-next-lane-actions' });

      const countEl = laneActions.createSpan({
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

      this.createIconButton(
        laneActions,
        'ellipsis',
        'Column actions',
        (event) => {
          this.openColumnMenu(event, visibleColumn.id, visibleColumn.title, beginColumnTitleEdit);
        },
        'kanban-next-ghost-icon-button'
      );

      const cardsEl = laneEl.createDiv({ cls: 'kanban-next-cards' });
      cardsEl.dataset.columnId = visibleColumn.id;

      cardsEl.addEventListener('dragover', (event) => {
        if (!this.cardDragState) {
          return;
        }

        event.preventDefault();
        this.updateCardDropIndicatorFromPointer(cardsEl, visibleColumn.id, event.clientY);
      });

      cardsEl.addEventListener('dragleave', (event) => {
        const target = event.relatedTarget as Node | null;
        if (target && cardsEl.contains(target)) {
          return;
        }
        this.clearCardDropIndicator();
      });

      cardsEl.addEventListener('drop', (event) => {
        if (!this.cardDragState) {
          return;
        }

        event.preventDefault();

        if (this.cardDropTargetColumnId === visibleColumn.id) {
          this.handleCardDrop(visibleColumn.id, this.cardDropTargetCardId);
          return;
        }

        const targetCard = (event.target as HTMLElement).closest('.kanban-next-card');
        if (targetCard instanceof HTMLElement && targetCard.dataset.cardId) {
          this.handleCardDrop(visibleColumn.id, targetCard.dataset.cardId);
          return;
        }

        this.handleCardDrop(visibleColumn.id, null);
      });

      visibleColumn.cards.forEach((card) => {
        const cardEl = cardsEl.createDiv({ cls: 'kanban-next-card' });
        cardEl.dataset.cardId = card.id;
        const isEditingCard =
          this.editingCard?.columnId === visibleColumn.id && this.editingCard.cardId === card.id;

        cardEl.draggable = !isEditingCard;

        if (!isEditingCard) {
          cardEl.addEventListener('dragstart', (event) => {
            this.clearCardDropIndicator();
            this.cardDragState = {
              cardId: card.id,
              sourceColumnId: visibleColumn.id,
            };
            this.cardDragPreviewHeight = cardEl.getBoundingClientRect().height;

            event.dataTransfer?.setData('text/plain', card.id);
            if (event.dataTransfer) {
              event.dataTransfer.effectAllowed = 'move';
            }

            cardEl.addClass('is-dragging');
          });

          cardEl.addEventListener('dragend', () => {
            this.cardDragState = null;
            this.cardDragPreviewHeight = 64;
            this.clearCardDropIndicator();
            cardEl.removeClass('is-dragging');
            this.clearDropTargetStyles();
          });

        }

        if (isEditingCard) {
          cardEl.addClass('is-editing');

          const currentDraft = this.editingCard?.draft || '';
          const editor = cardEl.createEl('textarea', {
            cls: 'kanban-next-card-editor',
          });
          editor.dataset.cardEditorId = card.id;
          editor.value = this.clampCardText(currentDraft);
          editor.maxLength = CARD_TEXT_MAX_LENGTH;
          editor.rows = Math.max(1, editor.value.split('\n').length);
          editor.setAttr('aria-label', 'Edit card text');
          editor.setAttr('placeholder', 'Write card text…');
          this.syncCardEditorHeight(editor);

          cardEl.createSpan({
            cls: 'kanban-next-card-shortcut-hint',
            text: 'Ctrl+Enter to save',
          });

          let counterEl: HTMLSpanElement | null = null;

          const ensureCounter = () => {
            if (!counterEl) {
              counterEl = cardEl.createSpan({
                cls: 'kanban-next-card-counter',
              });
            }
            counterEl.setText(`${this.countCharacters(editor.value)}/${CARD_TEXT_MAX_LENGTH}`);
          };

          if (this.editingCard && this.editingCard.showCounter) {
            ensureCounter();
          }

          editor.addEventListener('mousedown', (event) => {
            event.stopPropagation();
          });

          editor.addEventListener('click', (event) => {
            event.stopPropagation();
          });

          editor.addEventListener('input', () => {
            if (
              this.editingCard &&
              this.editingCard.columnId === visibleColumn.id &&
              this.editingCard.cardId === card.id
            ) {
              const clamped = this.clampCardText(editor.value);
              if (clamped !== editor.value) {
                editor.value = clamped;
              }

              this.editingCard.draft = clamped;
              this.editingCard.showCounter = true;
              this.syncCardEditorHeight(editor);
              ensureCounter();
            }
          });

          editor.addEventListener('focus', () => {
            if (
              this.editingCard &&
              this.editingCard.columnId === visibleColumn.id &&
              this.editingCard.cardId === card.id
            ) {
              this.editingCard.showCounter = true;
              ensureCounter();
            }
          });

          editor.addEventListener('keydown', (event) => {
            event.stopPropagation();

            if (event.key === 'Escape') {
              event.preventDefault();
              this.cancelInlineCardEdit();
              return;
            }

            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault();
              this.commitInlineCardEdit();
            }
          });

          editor.addEventListener('blur', () => {
            this.commitInlineCardEdit();
          });
        } else {
          const cardHeader = cardEl.createDiv({ cls: 'kanban-next-card-header' });
          const cardBodyEl = cardHeader.createDiv({
            cls: 'kanban-next-card-body',
          });
          this.renderCardBody(cardBodyEl, toEditableCardText({ title: card.title, description: card.description }));

          const cardActions = cardHeader.createDiv({ cls: 'kanban-next-card-actions' });
          const cardMenuButton = this.createIconButton(
            cardActions,
            'ellipsis',
            'Card actions',
            (event) => {
              this.openCardMenu(event, visibleColumn.id, card.id);
            },
            'kanban-next-ghost-icon-button'
          );

          cardMenuButton.addEventListener('mousedown', (event) => {
            event.stopPropagation();
          });

          cardMenuButton.addEventListener('dragstart', (event) => {
            event.preventDefault();
            event.stopPropagation();
          });

          cardEl.addEventListener('click', () => {
            this.beginInlineCardEdit(visibleColumn.id, card.id);
          });
        }
      });

      const laneFooter = laneEl.createDiv({ cls: 'kanban-next-lane-footer' });
      const addCardButton = this.createButton(
        laneFooter,
        'Add Card',
        async () => {
          const created = this.createBlankCard();
          this.store?.addCard(visibleColumn.id, created, 'bottom');
          this.schedulePersist();
          this.beginInlineCardEdit(visibleColumn.id, created.id, '');
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

  private beginInlineCardEdit(columnId: string, cardId: string, initialDraft?: string): void {
    if (!this.store) {
      return;
    }

    const card = this.store.getCard(columnId, cardId);
    if (!card) {
      return;
    }

    const original = toEditableCardText({
      title: card.title,
      description: card.description,
    });

    this.editingCard = {
      columnId,
      cardId,
      draft: this.clampCardText(initialDraft ?? original),
      original,
      showCounter: false,
    };

    this.renderLanes(this.store.getSnapshot());

    window.setTimeout(() => {
      const editor = this.rootEl?.querySelector(
        `[data-card-editor-id="${cardId}"]`
      ) as HTMLTextAreaElement | null;
      if (!editor) {
        return;
      }

      this.syncCardEditorHeight(editor);
      editor.focus();
      const caretPosition = editor.value.length;
      editor.setSelectionRange(caretPosition, caretPosition);
    }, 0);
  }

  private commitInlineCardEdit(): void {
    if (!this.store || !this.editingCard) {
      return;
    }

    const { columnId, cardId, draft } = this.editingCard;
    const nextContent = fromEditableCardText(draft);
    const current = this.store.getCard(columnId, cardId);

    this.editingCard = null;

    if (!current) {
      this.renderLanes(this.store.getSnapshot());
      return;
    }

    if (current.title === nextContent.title && current.description === nextContent.description) {
      this.renderLanes(this.store.getSnapshot());
      return;
    }

    this.store.updateCard(columnId, cardId, (card) => ({
      ...card,
      title: nextContent.title,
      description: nextContent.description,
    }));

    this.schedulePersist();
  }

  private cancelInlineCardEdit(): void {
    if (!this.store || !this.editingCard) {
      return;
    }

    this.editingCard = null;
    this.renderLanes(this.store.getSnapshot());
  }

  private syncCardEditorHeight(editor: HTMLTextAreaElement): void {
    editor.setCssProps({ height: '0px' });
    editor.setCssProps({ height: `${editor.scrollHeight}px` });
  }

  private countCharacters(value: string): number {
    return value.length;
  }

  private clampCardText(value: string): string {
    return clampEditableCardText(value, CARD_TEXT_MAX_LENGTH);
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

    const cards = this.parseClipboardCards(clipboard);
    if (cards.length === 0) {
      return;
    }

    const inserted = this.store.insertCardsFromParsedLines(columnId, cards, position);
    if (inserted > 0) {
      this.schedulePersist();
      new Notice(`Inserted ${inserted} cards.`);
    }
  }

  private parseClipboardCards(clipboard: string): Card[] {
    const parsed = parseClipboardList(clipboard);
    if (parsed.length === 0) {
      new Notice('No list items found in clipboard text.');
      return [];
    }

    return parsed.map<Card>((entry) => {
      return normalizeCard({
        id: createId('card'),
        title: entry.title,
        description: '',
        checked: entry.checked,
        dueDate: null,
      });
    });
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
        .onClick(async () => {
          const cardCount =
            this.store?.getBoard().columns.find((column) => column.id === columnId)?.cards.length || 0;
          const confirmed = await openConfirmModal(this.app, {
            title: 'Delete column',
            message: `Delete "${columnTitle}" and its ${cardCount} card${cardCount === 1 ? '' : 's'}? This cannot be undone.`,
            confirmLabel: 'Delete',
            danger: true,
          });

          if (!confirmed) {
            return;
          }

          this.store?.deleteColumn(columnId);
          this.schedulePersist();
        });
    });

    menu.showAtMouseEvent(event);
  }

  private openCardMenu(event: MouseEvent, columnId: string, cardId: string): void {
    const menu = new Menu();

    menu.addItem((item) => {
      item
        .setTitle('New note from card')
        .setIcon('file-plus-2')
        .onClick(() => {
          void this.createNoteFromCard(columnId, cardId);
        });
    });

    menu.addItem((item) => {
      item
        .setTitle('Copy link to card')
        .setIcon('link')
        .onClick(() => {
          void this.copyCardLinkToClipboard(cardId);
        });
    });

    menu.addItem((item) => {
      item
        .setTitle('Duplicate card')
        .setIcon('copy-plus')
        .onClick(() => {
          this.duplicateCard(columnId, cardId);
        });
    });

    menu.addItem((item) => {
      item
        .setTitle('Insert card before')
        .setIcon('list-start')
        .onClick(() => {
          void this.insertCardsAroundCard(columnId, cardId, 'before');
        });
    });

    menu.addItem((item) => {
      item
        .setTitle('Insert card after')
        .setIcon('list-end')
        .onClick(() => {
          void this.insertCardsAroundCard(columnId, cardId, 'after');
        });
    });

    menu.addItem((item) => {
      item
        .setTitle('Move to top')
        .setIcon('arrow-up-to-line')
        .onClick(() => {
          this.moveCardToBoundary(columnId, cardId, 'top');
        });
    });

    menu.addItem((item) => {
      item
        .setTitle('Move to bottom')
        .setIcon('arrow-down-to-line')
        .onClick(() => {
          this.moveCardToBoundary(columnId, cardId, 'bottom');
        });
    });

    menu.addItem((item) => {
      item
        .setTitle('Delete card')
        .setIcon('trash-2')
        .onClick(() => {
          void this.deleteCardWithConfirmation(columnId, cardId);
        });
    });

    menu.showAtMouseEvent(event);
  }

  private getCardContext(
    columnId: string,
    cardId: string
  ): {
    column: Column;
    card: Card;
    cardIndex: number;
  } | null {
    if (!this.store) {
      return null;
    }

    const board = this.store.getBoard();
    const column = board.columns.find((entry) => entry.id === columnId);
    if (!column) {
      return null;
    }

    const cardIndex = column.cards.findIndex((entry) => entry.id === cardId);
    if (cardIndex < 0) {
      return null;
    }

    const card = column.cards[cardIndex];
    if (!card) {
      return null;
    }

    return {
      column,
      card,
      cardIndex,
    };
  }

  private async createNoteFromCard(columnId: string, cardId: string): Promise<void> {
    if (!this.store || !this.file) {
      return;
    }

    const context = this.getCardContext(columnId, cardId);
    if (!context) {
      return;
    }

    const baseName = this.sanitizeNoteBaseName(context.card.title) || 'Untitled card note';
    const notePath = this.getNextNotePath(baseName);
    const cardLink = this.buildCardWikiLink(cardId);
    const noteContent = this.buildCardNoteContent(context.card, cardLink);

    try {
      const created = await this.app.vault.create(notePath, noteContent);
      const noteLink = this.buildNoteWikiLink(created, 'Note');

      if (!context.card.description.includes(noteLink)) {
        this.store.updateCard(columnId, cardId, (card) => ({
          ...card,
          description: this.appendLineWithSpacing(card.description, noteLink),
        }));
        this.schedulePersist();
      }

      await this.openFileInSidePane(created);
      new Notice(`Created note "${created.basename}".`);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : 'Could not create note from card.');
    }
  }

  private async copyCardLinkToClipboard(cardId: string): Promise<void> {
    const link = this.buildCardWikiLink(cardId);
    if (!link) {
      new Notice('Board file unavailable.');
      return;
    }

    try {
      await navigator.clipboard.writeText(link);
      new Notice('Card link copied.');
    } catch {
      new Notice('Could not copy card link to clipboard.');
    }
  }

  private duplicateCard(columnId: string, cardId: string): void {
    if (!this.store) {
      return;
    }

    const context = this.getCardContext(columnId, cardId);
    if (!context) {
      return;
    }

    const duplicated = normalizeCard({
      id: createId('card'),
      title: context.card.title,
      description: context.card.description,
      checked: context.card.checked,
      dueDate: context.card.dueDate,
    });

    const inserted = this.store.insertCardsAt(columnId, context.cardIndex + 1, [duplicated]);
    if (inserted > 0) {
      this.schedulePersist();
      new Notice('Card duplicated.');
    }
  }

  private async insertCardsAroundCard(
    columnId: string,
    cardId: string,
    position: 'before' | 'after'
  ): Promise<void> {
    if (!this.store) {
      return;
    }

    const context = this.getCardContext(columnId, cardId);
    if (!context) {
      return;
    }

    const clipboard = await this.readClipboardText();
    if (!clipboard) {
      return;
    }

    const cards = this.parseClipboardCards(clipboard);
    if (cards.length === 0) {
      return;
    }

    const insertIndex = position === 'before' ? context.cardIndex : context.cardIndex + 1;
    const inserted = this.store.insertCardsAt(columnId, insertIndex, cards);
    if (inserted > 0) {
      this.schedulePersist();
      new Notice(`Inserted ${inserted} cards.`);
    }
  }

  private moveCardToBoundary(columnId: string, cardId: string, boundary: 'top' | 'bottom'): void {
    if (!this.store) {
      return;
    }

    const context = this.getCardContext(columnId, cardId);
    if (!context) {
      return;
    }

    if (boundary === 'top' && context.cardIndex === 0) {
      return;
    }

    if (boundary === 'bottom' && context.cardIndex === context.column.cards.length - 1) {
      return;
    }

    const targetIndex = boundary === 'top' ? 0 : context.column.cards.length;
    this.store.moveCard(columnId, cardId, columnId, targetIndex);
    this.schedulePersist();
  }

  private async deleteCardWithConfirmation(columnId: string, cardId: string): Promise<void> {
    if (!this.store) {
      return;
    }

    const context = this.getCardContext(columnId, cardId);
    if (!context) {
      return;
    }

    const confirmed = await openConfirmModal(this.app, {
      title: 'Delete card',
      message: `Delete "${context.card.title}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });

    if (!confirmed) {
      return;
    }

    this.store.deleteCard(columnId, cardId);
    this.schedulePersist();
  }

  private buildCardWikiLink(cardId: string): string {
    if (!this.file) {
      return '';
    }

    return `[[${this.file.path.replace(/\.md$/i, '')}#^${cardId}]]`;
  }

  private buildNoteWikiLink(file: TFile, alias?: string): string {
    const pathWithoutExtension = file.path.replace(/\.md$/i, '');
    if (alias && alias.trim().length > 0) {
      return `[[${pathWithoutExtension}|${alias.trim()}]]`;
    }

    return `[[${pathWithoutExtension}]]`;
  }

  private renderCardBody(container: HTMLElement, text: string): void {
    container.empty();

    const normalized = text.replace(/\r\n/g, '\n');
    const lines = normalized.split('\n');

    lines.forEach((line, lineIndex) => {
      this.appendCardBodyLine(container, line);
      if (lineIndex < lines.length - 1) {
        container.appendChild(document.createTextNode('\n'));
      }
    });
  }

  private appendCardBodyLine(container: HTMLElement, line: string): void {
    const linkPattern = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
    let lastIndex = 0;

    while (true) {
      const match = linkPattern.exec(line);
      if (!match) {
        break;
      }

      const fullMatch = match[0] || '';
      const target = (match[1] || '').trim();
      const alias = (match[2] || '').trim();
      const matchStart = match.index;

      if (matchStart > lastIndex) {
        container.appendChild(document.createTextNode(line.slice(lastIndex, matchStart)));
      }

      if (!target) {
        container.appendChild(document.createTextNode(fullMatch));
      } else {
        const label = alias || target;
        const linkEl = container.createEl('a', {
          cls: 'internal-link',
          text: label,
        });
        linkEl.setAttr('href', target);
        linkEl.setAttr('data-href', target);

        linkEl.addEventListener('mousedown', (event) => {
          event.stopPropagation();
        });

        linkEl.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          void this.app.workspace.openLinkText(target, this.file?.path || '', false);
        });
      }

      lastIndex = matchStart + fullMatch.length;
    }

    if (lastIndex < line.length) {
      container.appendChild(document.createTextNode(line.slice(lastIndex)));
    }
  }

  private buildCardNoteContent(card: Card, cardLink: string): string {
    const description = card.description.trim();
    const lines = [`# ${card.title}`, '', `Source: ${cardLink}`, ''];

    if (description) {
      lines.push(description, '');
    }

    return `${lines.join('\n').trimEnd()}\n`;
  }

  private appendLineWithSpacing(value: string, line: string): string {
    const trimmed = value.trimEnd();
    return trimmed ? `${trimmed}\n\n${line}` : line;
  }

  private async openFileInSidePane(file: TFile): Promise<void> {
    const leaf = this.app.workspace.getLeaf('split', 'vertical');
    await leaf.openFile(file, { active: true });
  }

  private sanitizeNoteBaseName(raw: string): string {
    return raw
      .replace(/[\\/:*?"<>|[\]]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private getNextNotePath(baseName: string): string {
    const parentPath = this.file?.parent?.path || '';
    const prefix = parentPath ? `${parentPath}/` : '';

    let index = 0;
    while (true) {
      const candidateName = index === 0 ? baseName : `${baseName} ${index}`;
      const candidatePath = normalizePath(`${prefix}${candidateName}.md`);
      if (!this.app.vault.getAbstractFileByPath(candidatePath)) {
        return candidatePath;
      }

      index += 1;
    }
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
    this.cardDragPreviewHeight = 64;
    this.clearCardDropIndicator();
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
      this.columnDragState = null;
      this.clearDropTargetStyles();
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
      this.lanesEl?.removeClass('is-column-dragging');
      return;
    }

    this.store.moveColumn(this.columnDragState.sourceColumnId, targetIndex);
    this.columnDragState = null;
    this.columnDropInsertionIndex = null;
    this.clearDropTargetStyles();
    this.lanesEl?.removeClass('is-column-dragging');
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
      title: 'Untitled',
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
    this.lanesEl?.removeClass('is-column-dragging');
    this.clearColumnDropIndicator();
    this.clearCardDropIndicator();
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
