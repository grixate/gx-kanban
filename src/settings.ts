import { App, PluginSettingTab, Setting } from 'obsidian';

import KanbanNextPlugin from './main';

export interface KanbanNextSettings {
  defaultDensity: 'normal' | 'compact';
  saveDebounceMs: number;
  saveMaxDelayMs: number;
}

export const DEFAULT_SETTINGS: KanbanNextSettings = {
  defaultDensity: 'normal',
  saveDebounceMs: 300,
  saveMaxDelayMs: 1500,
};

export class KanbanNextSettingTab extends PluginSettingTab {
  plugin: KanbanNextPlugin;

  constructor(app: App, plugin: KanbanNextPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Kanban Next settings' });

    new Setting(containerEl)
      .setName('Default density for new boards')
      .setDesc('Card spacing preset for freshly created boards.')
      .addDropdown((dropdown) => {
        dropdown
          .addOption('normal', 'Normal')
          .addOption('compact', 'Compact')
          .setValue(this.plugin.settings.defaultDensity)
          .onChange(async (value) => {
            this.plugin.settings.defaultDensity = value === 'compact' ? 'compact' : 'normal';
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Save debounce (ms)')
      .setDesc('Delay before writing queued board changes to disk.')
      .addText((text) => {
        text
          .setValue(String(this.plugin.settings.saveDebounceMs))
          .onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            if (Number.isNaN(parsed) || parsed < 50) {
              return;
            }

            this.plugin.settings.saveDebounceMs = parsed;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Save max delay (ms)')
      .setDesc('Maximum wait before a queued write is flushed, even during rapid changes.')
      .addText((text) => {
        text
          .setValue(String(this.plugin.settings.saveMaxDelayMs))
          .onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            if (Number.isNaN(parsed) || parsed < this.plugin.settings.saveDebounceMs) {
              return;
            }

            this.plugin.settings.saveMaxDelayMs = parsed;
            await this.plugin.saveSettings();
          });
      });

  }
}
