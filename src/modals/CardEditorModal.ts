import { App, Modal, Notice, Setting } from 'obsidian';

import { NativeMarkdownEditorAdapter } from '../editor/NativeMarkdownEditorAdapter';

export interface CardEditorInitialValue {
  title: string;
  description: string;
  dueDate: string | null;
  checked: boolean;
}

export interface CardEditorResult {
  title: string;
  description: string;
  dueDate: string | null;
  checked: boolean;
}

interface CardEditorModalOptions {
  allowFallback: boolean;
}

class CardEditorModal extends Modal {
  private value: CardEditorInitialValue;
  private options: CardEditorModalOptions;
  private resolver: (value: CardEditorResult | null) => void;
  private settled: boolean;

  private adapter: NativeMarkdownEditorAdapter | null;
  private titleValue: string;
  private dueDateValue: string;

  constructor(
    app: App,
    value: CardEditorInitialValue,
    options: CardEditorModalOptions,
    resolver: (value: CardEditorResult | null) => void
  ) {
    super(app);
    this.value = value;
    this.options = options;
    this.resolver = resolver;
    this.settled = false;

    this.adapter = null;
    this.titleValue = value.title;
    this.dueDateValue = value.dueDate || '';
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h2', { text: 'Edit card' });

    new Setting(contentEl)
      .setName('Title')
      .setDesc('Single-line card title.')
      .addText((text) => {
        text.setValue(this.titleValue).onChange((value) => {
          this.titleValue = value;
        });
      });

    new Setting(contentEl)
      .setName('Due date')
      .setDesc('Optional. Format: YYYY-MM-DD')
      .addText((text) => {
        text
          .setPlaceholder('YYYY-MM-DD')
          .setValue(this.dueDateValue)
          .onChange((value) => {
            this.dueDateValue = value;
          });
      });

    contentEl.createEl('h3', { text: 'Description' });

    const host = contentEl.createDiv({ cls: 'kanban-next-editor-host' });

    try {
      this.adapter = new NativeMarkdownEditorAdapter(this.app, host, this.options.allowFallback);
      const mode = this.adapter.mount(this.value.description);
      if (mode === 'fallback') {
        contentEl.createEl('p', {
          cls: 'kanban-next-editor-note',
          text: 'Native editor unavailable in this environment. Using fallback editor.',
        });
      }
    } catch (error) {
      new Notice(error instanceof Error ? error.message : 'Unable to open card editor.');
      this.resolveOnce(null);
      this.close();
      return;
    }

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
      const title = this.titleValue.trim();
      if (!title) {
        new Notice('Card title cannot be empty.');
        return;
      }

      const dueDate = this.normalizeDueDate(this.dueDateValue.trim());
      if (this.dueDateValue.trim().length > 0 && !dueDate) {
        new Notice('Due date must match YYYY-MM-DD.');
        return;
      }

      this.resolveOnce({
        title,
        description: this.adapter?.getValue().trimEnd() || '',
        dueDate,
        checked: this.value.checked,
      });
      this.close();
    });

    window.setTimeout(() => {
      this.adapter?.focus();
    }, 0);
  }

  onClose(): void {
    this.adapter?.destroy();
    this.adapter = null;

    this.contentEl.empty();
    this.resolveOnce(null);
  }

  private normalizeDueDate(value: string): string | null {
    if (!value) {
      return null;
    }

    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  }

  private resolveOnce(value: CardEditorResult | null): void {
    if (this.settled) {
      return;
    }

    this.settled = true;
    this.resolver(value);
  }
}

export function openCardEditorModal(
  app: App,
  value: CardEditorInitialValue,
  options: CardEditorModalOptions
): Promise<CardEditorResult | null> {
  return new Promise((resolve) => {
    const modal = new CardEditorModal(app, value, options, resolve);
    modal.open();
  });
}
