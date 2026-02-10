import { App, Modal, Notice, Setting } from 'obsidian';

import { BoardDocument, CardDensity } from '../model/types';

export interface BoardSettingsResult {
  boardTitle: string;
  boardDescription: string;
  density: CardDensity;
  wipLimitByColumnId: Record<string, number | null>;
}

class BoardSettingsModal extends Modal {
  private board: BoardDocument;
  private resolver: (value: BoardSettingsResult | null) => void;
  private settled: boolean;

  private titleValue: string;
  private descriptionValue: string;
  private densityValue: CardDensity;
  private wipValues: Record<string, string>;

  constructor(app: App, board: BoardDocument, resolver: (value: BoardSettingsResult | null) => void) {
    super(app);
    this.board = board;
    this.resolver = resolver;
    this.settled = false;

    this.titleValue = board.boardTitle;
    this.descriptionValue = board.boardDescription;
    this.densityValue = board.density;
    this.wipValues = board.columns.reduce<Record<string, string>>((acc, column) => {
      acc[column.id] = column.wipLimit === null ? '' : String(column.wipLimit);
      return acc;
    }, {});
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h2', { text: 'Board settings' });

    new Setting(contentEl)
      .setName('Board title')
      .setDesc('Shown in the board header and frontmatter.')
      .addText((text) => {
        text.setValue(this.titleValue).onChange((value) => {
          this.titleValue = value;
        });
      });

    new Setting(contentEl)
      .setName('Board description')
      .setDesc('Optional context for the board.')
      .addTextArea((textarea) => {
        textarea.setValue(this.descriptionValue).onChange((value) => {
          this.descriptionValue = value;
        });
      });

    new Setting(contentEl)
      .setName('Card density')
      .setDesc('Controls card spacing in this board.')
      .addDropdown((dropdown) => {
        dropdown
          .addOption('normal', 'Normal')
          .addOption('compact', 'Compact')
          .setValue(this.densityValue)
          .onChange((value) => {
            this.densityValue = value === 'compact' ? 'compact' : 'normal';
          });
      });

    contentEl.createEl('h3', { text: 'Column WIP limits' });

    this.board.columns.forEach((column) => {
      new Setting(contentEl)
        .setName(column.title)
        .setDesc('Leave blank for no limit.')
        .addText((text) => {
          text
            .setPlaceholder('No limit')
            .setValue(this.wipValues[column.id] || '')
            .onChange((value) => {
              this.wipValues[column.id] = value;
            });
        });
    });

    const actions = contentEl.createDiv({ cls: 'kanban-next-modal-actions' });
    const cancelButton = actions.createEl('button', { text: 'Cancel' });
    const saveButton = actions.createEl('button', {
      text: 'Save',
      cls: 'mod-cta',
    });

    cancelButton.addEventListener('click', () => {
      this.resolveOnce(null);
      this.close();
    });

    saveButton.addEventListener('click', () => {
      const wipLimitByColumnId: Record<string, number | null> = {};

      for (const column of this.board.columns) {
        const rawValue = (this.wipValues[column.id] || '').trim();

        if (!rawValue) {
          wipLimitByColumnId[column.id] = null;
          continue;
        }

        const parsed = Number.parseInt(rawValue, 10);
        if (Number.isNaN(parsed) || parsed < 0) {
          new Notice(`WIP limit for "${column.title}" must be a positive integer or blank.`);
          return;
        }

        wipLimitByColumnId[column.id] = parsed;
      }

      const title = this.titleValue.trim();
      if (!title) {
        new Notice('Board title cannot be empty.');
        return;
      }

      this.resolveOnce({
        boardTitle: title,
        boardDescription: this.descriptionValue.trim(),
        density: this.densityValue,
        wipLimitByColumnId,
      });
      this.close();
    });
  }

  onClose(): void {
    this.contentEl.empty();
    this.resolveOnce(null);
  }

  private resolveOnce(value: BoardSettingsResult | null): void {
    if (this.settled) {
      return;
    }

    this.settled = true;
    this.resolver(value);
  }
}

export function openBoardSettingsModal(app: App, board: BoardDocument): Promise<BoardSettingsResult | null> {
  return new Promise((resolve) => {
    const modal = new BoardSettingsModal(app, board, resolve);
    modal.open();
  });
}
