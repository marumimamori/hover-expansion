import { App, PluginSettingTab, Setting } from "obsidian";
import type HoverExpansionPlugin from "../main";

export type SidebarAnimationStyle = "direct" | "smooth" | "overshoot";

export interface HoverExpansionSettings {
  leftSidebar: boolean;
  rightSidebar: boolean;
  hoverTabs: boolean;
  tabDelay: number;
  openDelay: number;
  closeDelay: number;
  edgeWidth: number;
  animationDuration: number;
  animationStyle: SidebarAnimationStyle;
}

export const DEFAULT_SETTINGS: HoverExpansionSettings = {
  leftSidebar: true,
  rightSidebar: true,
  hoverTabs: true,
  tabDelay: 0,
  openDelay: 30,
  closeDelay: 200,
  edgeWidth: 40,
  animationDuration: 300,
  animationStyle: "smooth"
};

export function loadSettings(data: unknown): HoverExpansionSettings {
  const saved = data && typeof data === "object" ? data as Partial<HoverExpansionSettings> : {};
  const settings = { ...DEFAULT_SETTINGS };
  for (const key of ["leftSidebar", "rightSidebar", "hoverTabs"] as const) {
    if (typeof saved[key] === "boolean") settings[key] = saved[key]!;
  }
  for (const [key, min, max] of [
    ["tabDelay", 0, 500], ["openDelay", 0, 1000], ["closeDelay", 0, 1000], ["edgeWidth", 2, 300],
    ["animationDuration", 0, 2000]
  ] as const) {
    const value = saved[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      settings[key] = Math.round(Math.max(min, Math.min(max, value)));
    }
  }
  if (saved.animationStyle === "direct" || saved.animationStyle === "smooth" || saved.animationStyle === "overshoot") {
    settings.animationStyle = saved.animationStyle;
  }
  return settings;
}

export class HoverExpansionSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: HoverExpansionPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("p", {
      text: "Move to a window edge to reveal its sidebar, then move into the panel. It folds away when you leave. Hover a tab to select it and move straight down into its page.",
      cls: "setting-item-description"
    });

    for (const [key, name, description] of [
      ["leftSidebar", "Expand left sidebar on hover", "Reveal the left sidebar at the left window edge and fold it away when you leave."],
      ["rightSidebar", "Expand right sidebar on hover", "Reveal the right sidebar at the right window edge and fold it away when you leave."],
      ["hoverTabs", "Select tabs on hover", "Select sidebar and page tabs without clicking. Close buttons and tab dragging keep their usual behavior."]
    ] as const) {
      const setting = new Setting(containerEl).setName(name).setDesc(description);
      setting.addToggle(toggle => {
        toggle.setValue(this.plugin.settings[key])
          .onChange(async value => { await this.plugin.updateSettings({ [key]: value }); });
        this.addReset(setting, key, () => toggle.setValue(this.plugin.settings[key]), "On");
      });
    }

    new Setting(containerEl).setName("Hover feel").setHeading();
    for (const [key, name, description, min, max, step, unit] of [
      ["tabDelay", "Tab hover delay", "A short pause avoids switching tabs while passing over them. Set to 0 for instant selection.", 0, 500, 20, "ms"],
      ["openDelay", "Sidebar expansion delay", "Hover at the window edge for this long before opening starts. A short delay helps avoid opening sidebars while crossing between monitors. Set to 0 to start immediately.", 0, 1000, 10, "ms"],
      ["closeDelay", "Sidebar fold delay", "Time to move back into the sidebar before it folds away.", 0, 1000, 20, "ms"],
      ["edgeWidth", "Window edge hover area", "Width of the invisible hover area at each window edge, up to 300 px.", 2, 300, 1, "px"]
    ] as const) {
      const setting = new Setting(containerEl).setName(name).setDesc(description);
      setting.addSlider(slider => {
        slider.setLimits(min, max, step).setValue(this.plugin.settings[key]).setDynamicTooltip();
        // Newer Obsidian versions show a formatted inline value.
        slider.setDisplayFormat?.(value => `${value} ${unit}`);
        slider.onChange(async value => { await this.plugin.updateSettings({ [key]: value }); });
        this.addReset(setting, key, () => slider.setValue(this.plugin.settings[key]), `${DEFAULT_SETTINGS[key]} ${unit}`);
      });
    }

    new Setting(containerEl).setName("Sidebar animation").setHeading();
    const durationSetting = new Setting(containerEl).setName("Animation duration")
      .setDesc("How long the sidebar takes to open or fold, after the hover delay. Applies to both sidebars. Set to 0 for no animation.");
    durationSetting.addSlider(slider => {
      slider.setLimits(0, 2000, 10).setValue(this.plugin.settings.animationDuration).setDynamicTooltip();
      slider.setDisplayFormat?.(value => `${value} ms`);
      slider.onChange(async value => { await this.plugin.updateSettings({ animationDuration: value }); });
      this.addReset(durationSetting, "animationDuration", () => slider.setValue(this.plugin.settings.animationDuration), `${DEFAULT_SETTINGS.animationDuration} ms`);
    });
    const styleSetting = new Setting(containerEl).setName("Animation style")
      .setDesc("Direct moves at constant speed. Smooth starts and stops gently, like a train. Overshoot adds a small bounce.");
    styleSetting.addDropdown(dropdown => {
      dropdown
        .addOption("direct", "Direct")
        .addOption("smooth", "Smooth (slow start and stop)")
        .addOption("overshoot", "Overshoot (experimental)")
        .setValue(this.plugin.settings.animationStyle)
        .onChange(async value => { await this.plugin.updateSettings({ animationStyle: value as SidebarAnimationStyle }); });
      this.addReset(styleSetting, "animationStyle", () => dropdown.setValue(this.plugin.settings.animationStyle), "Smooth (slow start and stop)");
    });
  }

  private addReset(setting: Setting, key: keyof HoverExpansionSettings, updateControl: () => void, defaultLabel: string): void {
    setting.addExtraButton(button => button
      .setIcon("rotate-ccw")
      .setTooltip(`Reset to default (${defaultLabel})`)
      .onClick(async () => {
        await this.plugin.updateSettings({ [key]: DEFAULT_SETTINGS[key] });
        updateControl();
      }));
  }
}
