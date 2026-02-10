import { App } from 'obsidian';

type EmbeddedEditor = {
  setValue: (value: string) => void;
  getValue: () => string;
  focus: () => void;
};

type EmbeddedMarkdownView = {
  editable?: boolean;
  load?: () => void;
  showEditor?: () => void;
  unload?: () => void;
  editMode?: {
    editor?: EmbeddedEditor;
  };
};

export type EditorMode = 'native' | 'fallback';

export class NativeMarkdownEditorAdapter {
  private app: App;
  private host: HTMLElement;
  private allowFallback: boolean;

  private mode: EditorMode;
  private nativeView: EmbeddedMarkdownView | null;
  private nativeEditor: EmbeddedEditor | null;
  private fallback: HTMLTextAreaElement | null;

  constructor(app: App, host: HTMLElement, allowFallback: boolean) {
    this.app = app;
    this.host = host;
    this.allowFallback = allowFallback;

    this.mode = 'fallback';
    this.nativeView = null;
    this.nativeEditor = null;
    this.fallback = null;
  }

  mount(initialValue: string): EditorMode {
    const embedFactory = (this.app as unknown as {
      embedRegistry?: { embedByExtension?: Record<string, (...args: unknown[]) => unknown> };
    }).embedRegistry?.embedByExtension?.md;

    if (typeof embedFactory === 'function') {
      try {
        const view = embedFactory(
          {
            app: this.app,
            container: this.host,
            state: {},
          },
          null,
          ''
        ) as EmbeddedMarkdownView;

        view.load?.();
        view.editable = true;
        view.showEditor?.();

        const editor = view.editMode?.editor;
        if (editor && typeof editor.setValue === 'function' && typeof editor.getValue === 'function') {
          editor.setValue(initialValue);
          this.nativeView = view;
          this.nativeEditor = editor;
          this.mode = 'native';
          return this.mode;
        }

        view.unload?.();
      } catch (error) {
        console.error('Failed to mount native editor', error);
      }
    }

    if (!this.allowFallback) {
      throw new Error('Native markdown editor is unavailable in this Obsidian version.');
    }

    this.fallback = this.host.createEl('textarea', {
      cls: 'kanban-next-fallback-editor',
    });
    this.fallback.value = initialValue;
    this.mode = 'fallback';
    return this.mode;
  }

  focus(): void {
    if (this.mode === 'native' && this.nativeEditor) {
      this.nativeEditor.focus();
      return;
    }

    this.fallback?.focus();
  }

  getValue(): string {
    if (this.mode === 'native' && this.nativeEditor) {
      return this.nativeEditor.getValue();
    }

    return this.fallback?.value || '';
  }

  destroy(): void {
    this.nativeView?.unload?.();
    this.nativeView = null;
    this.nativeEditor = null;

    if (this.fallback) {
      this.fallback.remove();
      this.fallback = null;
    }
  }
}
