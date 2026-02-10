import { App, Modal } from 'obsidian';

export interface PromptModalOptions {
  title: string;
  value?: string;
  placeholder?: string;
  submitLabel?: string;
  multiline?: boolean;
  rows?: number;
}

class PromptModal extends Modal {
  private options: PromptModalOptions;
  private resolver: (value: string | null) => void;
  private settled: boolean;

  constructor(app: App, options: PromptModalOptions, resolver: (value: string | null) => void) {
    super(app);
    this.options = options;
    this.resolver = resolver;
    this.settled = false;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    this.modalEl.addClass('kanban-next-prompt-modal');
    contentEl.addClass('kanban-next-prompt-content');

    contentEl.createEl('h2', { text: this.options.title });

    const initialValue = this.options.value || '';

    let getValue: () => string;
    let focusTarget: HTMLElement;

    if (this.options.multiline) {
      const textarea = contentEl.createEl('textarea', {
        cls: 'kanban-next-prompt-textarea',
      });
      textarea.value = initialValue;
      textarea.rows = this.options.rows || 10;

      if (this.options.placeholder) {
        textarea.placeholder = this.options.placeholder;
      }

      getValue = () => textarea.value;
      focusTarget = textarea;
    } else {
      const input = contentEl.createEl('input', {
        type: 'text',
        cls: 'kanban-next-prompt-input',
      });
      input.value = initialValue;

      if (this.options.placeholder) {
        input.placeholder = this.options.placeholder;
      }

      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          this.resolveOnce(getValue().trim());
          this.close();
        }

        if (event.key === 'Escape') {
          event.preventDefault();
          this.resolveOnce(null);
          this.close();
        }
      });

      getValue = () => input.value;
      focusTarget = input;
    }

    const actions = contentEl.createDiv({ cls: 'kanban-next-modal-actions' });

    const cancelButton = actions.createEl('button', {
      text: 'Cancel',
    });

    const submitButton = actions.createEl('button', {
      text: this.options.submitLabel || 'Save',
      cls: 'mod-cta',
    });

    cancelButton.addEventListener('click', () => {
      this.resolveOnce(null);
      this.close();
    });

    submitButton.addEventListener('click', () => {
      this.resolveOnce(getValue().trim());
      this.close();
    });

    window.setTimeout(() => {
      focusTarget.focus();
      if ('select' in focusTarget && typeof (focusTarget as HTMLInputElement).select === 'function') {
        (focusTarget as HTMLInputElement).select();
      }
    }, 0);
  }

  onClose(): void {
    this.contentEl.empty();
    this.resolveOnce(null);
  }

  private resolveOnce(value: string | null): void {
    if (this.settled) {
      return;
    }

    this.settled = true;
    this.resolver(value);
  }
}

export function promptForText(app: App, options: PromptModalOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const modal = new PromptModal(
      app,
      {
        ...options,
        multiline: false,
      },
      resolve
    );
    modal.open();
  });
}

export function promptForMultilineText(
  app: App,
  options: PromptModalOptions
): Promise<string | null> {
  return new Promise((resolve) => {
    const modal = new PromptModal(
      app,
      {
        ...options,
        multiline: true,
      },
      resolve
    );
    modal.open();
  });
}
