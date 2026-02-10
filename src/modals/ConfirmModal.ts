import { App, Modal } from 'obsidian';

export interface ConfirmModalOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}

class ConfirmModal extends Modal {
  private options: ConfirmModalOptions;
  private resolver: (confirmed: boolean) => void;
  private settled: boolean;

  constructor(app: App, options: ConfirmModalOptions, resolver: (confirmed: boolean) => void) {
    super(app);
    this.options = options;
    this.resolver = resolver;
    this.settled = false;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    this.modalEl.addClass('kanban-next-confirm-modal');
    contentEl.addClass('kanban-next-confirm-content');

    contentEl.createEl('h2', { text: this.options.title });
    contentEl.createEl('p', {
      cls: 'kanban-next-confirm-message',
      text: this.options.message,
    });

    const actions = contentEl.createDiv({ cls: 'kanban-next-modal-actions' });

    const cancelButton = actions.createEl('button', {
      text: 'Cancel',
    });

    const confirmButton = actions.createEl('button', {
      text: this.options.confirmLabel || 'Confirm',
      cls: this.options.danger ? 'mod-warning' : 'mod-cta',
    });

    if (this.options.danger) {
      confirmButton.addClass('kanban-next-danger-button');
    }

    cancelButton.addEventListener('click', () => {
      this.resolveOnce(false);
      this.close();
    });

    confirmButton.addEventListener('click', () => {
      this.resolveOnce(true);
      this.close();
    });
  }

  onClose(): void {
    this.contentEl.empty();
    this.resolveOnce(false);
  }

  private resolveOnce(confirmed: boolean): void {
    if (this.settled) {
      return;
    }

    this.settled = true;
    this.resolver(confirmed);
  }
}

export function openConfirmModal(app: App, options: ConfirmModalOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = new ConfirmModal(app, options, resolve);
    modal.open();
  });
}
