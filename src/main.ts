import {
  MarkdownView,
  Notice,
  normalizePath,
  Plugin,
  TFile,
  TFolder,
  ViewState,
  WorkspaceLeaf,
} from 'obsidian';
import { parse as parseYaml } from 'yaml';

import { createDefaultBoard } from './model/boardTemplate';
import { serializeBoardMarkdown } from './model/serialize';
import { DEFAULT_SETTINGS, KanbanNextSettingTab, KanbanNextSettings } from './settings';
import { KANBAN_NEXT_ICON, KANBAN_NEXT_VIEW_TYPE, KanbanView } from './view/KanbanView';

export default class KanbanNextPlugin extends Plugin {
  settings: KanbanNextSettings;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(KANBAN_NEXT_VIEW_TYPE, (leaf) => new KanbanView(leaf, this));
    this.addSettingTab(new KanbanNextSettingTab(this.app, this));

    this.addRibbonIcon(KANBAN_NEXT_ICON, 'Create new Kanban board', async () => {
      await this.createBoard();
    });

    this.registerCommands();
    this.registerContextMenu();
    this.registerBoardDefaultOpenBehavior();
  }

  onunload(): void {
    super.onunload();
  }

  async loadSettings(): Promise<void> {
    const loaded = (await this.loadData()) as Partial<KanbanNextSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded || {});
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  isKanbanFile(file: TFile): boolean {
    const cache = this.app.metadataCache.getFileCache(file);
    return cache?.frontmatter?.kanban === true;
  }

  private async isKanbanFileWithFallback(file: TFile): Promise<boolean> {
    if (this.isKanbanFile(file)) {
      return true;
    }

    if (file.extension.toLowerCase() !== 'md') {
      return false;
    }

    try {
      const content = await this.app.vault.cachedRead(file);
      const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
      const frontmatterMatch = normalized.match(/^(?:\s*\n)*---\n([\s\S]*?)\n---(?:\n|$)/);
      if (!frontmatterMatch) {
        return false;
      }

      const frontmatterBody = frontmatterMatch[1] || '';
      const parsed = parseYaml(frontmatterBody) as unknown;
      return Boolean(parsed && typeof parsed === 'object' && 'kanban' in parsed && (parsed as { kanban?: unknown }).kanban === true);
    } catch {
      return false;
    }
  }

  getActiveKanbanView(): KanbanView | null {
    return this.app.workspace.getActiveViewOfType(KanbanView);
  }

  async setKanbanView(leaf: WorkspaceLeaf, file: TFile): Promise<void> {
    if (leaf.view.getViewType() === KANBAN_NEXT_VIEW_TYPE) {
      return;
    }

    await leaf.setViewState({
      type: KANBAN_NEXT_VIEW_TYPE,
      state: { file: file.path },
      popstate: true,
    } as ViewState);
  }

  async setMarkdownView(leaf: WorkspaceLeaf, focus = true): Promise<void> {
    await leaf.setViewState(
      {
        type: 'markdown',
        state: leaf.view.getState(),
        popstate: true,
      } as ViewState,
      { focus }
    );
  }

  async createBoard(folder?: TFolder): Promise<void> {
    const activeFile = this.app.workspace.getActiveFile();
    const targetFolder = folder || activeFile?.parent || this.app.vault.getRoot();

    try {
      const newPath = this.getNextBoardPath(targetFolder, 'Untitled gx-kanban');
      const created = await this.app.vault.create(newPath, '');

      const board = createDefaultBoard(created.basename);
      board.density = this.settings.defaultDensity;

      await this.app.vault.modify(created, serializeBoardMarkdown(board));

      const leaf = this.app.workspace.getLeaf(true);
      await this.setKanbanView(leaf, created);
    } catch (error) {
      console.error('gx-kanban: failed to create board', error);
      new Notice('gx-kanban could not create a board file. Check console for details.');
    }
  }

  async renameBoardFile(file: TFile, desiredTitle: string): Promise<TFile> {
    const cleanedTitle = this.sanitizeFileBaseName(desiredTitle);
    if (!cleanedTitle) {
      throw new Error('Board name cannot be empty.');
    }

    const parent = file.parent || this.app.vault.getRoot();
    const targetPath = this.getNextBoardPath(parent, cleanedTitle, file.path);

    if (targetPath === file.path) {
      return file;
    }

    await this.app.fileManager.renameFile(file, targetPath);

    const renamed = this.app.vault.getAbstractFileByPath(targetPath);
    return renamed instanceof TFile ? renamed : file;
  }

  private registerCommands(): void {
    this.addCommand({
      id: 'create-board',
      name: 'Create board',
      callback: async () => {
        await this.createBoard();
      },
    });

    this.addCommand({
      id: 'toggle-board-markdown',
      name: 'Toggle board/markdown view',
      checkCallback: (checking) => {
        const activeKanbanView = this.getActiveKanbanView();

        if (activeKanbanView) {
          if (checking) {
            return true;
          }

          void this.setMarkdownView(activeKanbanView.leaf);
          return true;
        }

        const activeMarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeMarkdownView || !activeMarkdownView.file || !this.isKanbanFile(activeMarkdownView.file)) {
          return false;
        }

        if (checking) {
          return true;
        }

        void this.setKanbanView(activeMarkdownView.leaf, activeMarkdownView.file);
        return true;
      },
    });

    this.addCommand({
      id: 'add-column',
      name: 'Add column',
      checkCallback: (checking) => {
        const activeKanbanView = this.getActiveKanbanView();
        if (!activeKanbanView) {
          return false;
        }

        if (checking) {
          return true;
        }

        void activeKanbanView.promptAddColumn();
        return true;
      },
    });

    this.addCommand({
      id: 'add-card-to-first-column',
      name: 'Add card to first column',
      checkCallback: (checking) => {
        const activeKanbanView = this.getActiveKanbanView();
        if (!activeKanbanView) {
          return false;
        }

        if (checking) {
          return true;
        }

        void activeKanbanView.addCardToFirstColumn();
        return true;
      },
    });

    this.addCommand({
      id: 'open-board-settings',
      name: 'Open board settings',
      checkCallback: (checking) => {
        const activeKanbanView = this.getActiveKanbanView();
        if (!activeKanbanView) {
          return false;
        }

        if (checking) {
          return true;
        }

        void activeKanbanView.openBoardSettings();
        return true;
      },
    });
  }

  private registerContextMenu(): void {
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file, source, leaf) => {
        if (source === 'link-context-menu') {
          return;
        }

        if (file instanceof TFolder) {
          menu.addItem((item) => {
            item
              .setTitle('New gx-kanban board')
              .setIcon(KANBAN_NEXT_ICON)
              .setSection('action-primary')
              .onClick(() => {
                void this.createBoard(file);
              });
          });
          return;
        }

        if (file instanceof TFile && this.isKanbanFile(file) && leaf) {
          menu.addItem((item) => {
            item
              .setTitle('Open as gx-kanban board')
              .setIcon(KANBAN_NEXT_ICON)
              .setSection('pane')
              .onClick(() => {
                void this.setKanbanView(leaf, file);
              });
          });

          if (leaf.view instanceof KanbanView) {
            menu.addItem((item) => {
              item
                .setTitle('Open as markdown')
                .setIcon('file-text')
                .setSection('pane')
                .onClick(() => {
                  void this.setMarkdownView(leaf);
                });
            });
          }
        }
      })
    );
  }

  private async maybeOpenAsKanban(file: TFile | null, preferredLeaf?: WorkspaceLeaf): Promise<void> {
    if (!(file instanceof TFile)) {
      return;
    }

    if (!(await this.isKanbanFileWithFallback(file))) {
      return;
    }

    if (preferredLeaf?.view instanceof MarkdownView) {
      const markdownView = preferredLeaf.view;
      if (markdownView.file === file) {
        await this.setKanbanView(preferredLeaf, file);
        return;
      }
    }

    const matchingMarkdownLeaves = this.app.workspace.getLeavesOfType('markdown').filter((leaf) => {
      if (!(leaf.view instanceof MarkdownView)) {
        return false;
      }

      const markdownView = leaf.view;
      return markdownView.file === file;
    });

    for (const leaf of matchingMarkdownLeaves) {
      await this.setKanbanView(leaf, file);
    }
  }

  private registerBoardDefaultOpenBehavior(): void {
    const scheduleOpenChecks = (file: TFile | null) => {
      if (!(file instanceof TFile)) {
        return;
      }

      const delays = [0, 60, 180];
      delays.forEach((delay) => {
        window.setTimeout(() => {
          void this.maybeOpenAsKanban(file, this.app.workspace.getMostRecentLeaf() || undefined);
        }, delay);
      });
    };

    this.registerEvent(
      this.app.workspace.on('file-open', (file) => {
        scheduleOpenChecks(file);
      })
    );

    this.registerEvent(
      this.app.workspace.on('active-leaf-change', (leaf) => {
        if (!(leaf?.view instanceof MarkdownView)) {
          return;
        }

        scheduleOpenChecks(leaf.view.file || null);
      })
    );

    this.app.workspace.onLayoutReady(() => {
      this.app.workspace.getLeavesOfType('markdown').forEach((leaf) => {
        if (!(leaf.view instanceof MarkdownView)) {
          return;
        }

        const file = leaf.view.file;

        void this.maybeOpenAsKanban(file || null, leaf);
      });
    });
  }

  private sanitizeFileBaseName(raw: string): string {
    return raw
      .replace(/[\\/:*?"<>|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private getNextBoardPath(folder: TFolder, baseName: string, currentPath?: string): string {
    const prefix = folder.path ? `${folder.path}/` : '';
    let index = 0;

    while (true) {
      const candidateName = index === 0 ? baseName : `${baseName} ${index}`;
      const candidatePath = normalizePath(`${prefix}${candidateName}.md`);
      const existing = this.app.vault.getAbstractFileByPath(candidatePath);

      if (!existing || candidatePath === currentPath) {
        return candidatePath;
      }

      index += 1;
    }
  }
}
