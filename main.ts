import { Plugin } from "obsidian";
import { HoverExpansionSettings, HoverExpansionSettingTab, loadSettings } from "./src/settings";
import { SidebarHover } from "./src/sidebar-hover";
import { TabHover } from "./src/tab-hover";

export default class HoverExpansionPlugin extends Plugin {
  settings!: HoverExpansionSettings;
  private sidebarHover?: SidebarHover;
  private tabHover?: TabHover;
  private stopping = false;

  async onload(): Promise<void> {
    this.settings = loadSettings(await this.loadData());
    this.addSettingTab(new HoverExpansionSettingTab(this.app, this));

    this.app.workspace.onLayoutReady(() => {
      if (this.stopping) return;
      this.sidebarHover = this.addChild(new SidebarHover(this.app, () => this.settings));
      this.tabHover = this.addChild(new TabHover(this.app, () => this.settings));
    });
  }

  async updateSettings(patch: Partial<HoverExpansionSettings>): Promise<void> {
    this.settings = loadSettings({ ...this.settings, ...patch });
    this.sidebarHover?.refresh(true);
    this.tabHover?.refresh();
    await this.saveData(this.settings);
  }

  onunload(): void {
    this.stopping = true;
  }
}
