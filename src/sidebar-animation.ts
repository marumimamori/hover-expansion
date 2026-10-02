import { App, Component, WorkspaceSidedock } from "obsidian";
import type { HoverExpansionSettings, SidebarAnimationStyle } from "./settings";

const ANIMATING_CLASS = "hover-expansion-animating";
const WIDTH = "--hover-expansion-width";
const CONTENT_WIDTH = "--hover-expansion-content-width";
const PINNED_TOGGLE_CLASS = "hover-expansion-toggle-pinned";
const TOGGLE_LEFT = "--hover-expansion-toggle-left";
const TOGGLE_TOP = "--hover-expansion-toggle-top";
const TOGGLE_WIDTH = "--hover-expansion-toggle-width";
const TOGGLE_HEIGHT = "--hover-expansion-toggle-height";

// Native sidebars clear their transition and hide after a fixed timeout. Keep
// presentation independent of that timeout, while the native API owns state.
const ANIMATION_CSS = `
.workspace-split.${ANIMATING_CLASS} {
  width: var(${WIDTH}) !important;
  display: flex !important;
  overflow: hidden !important;
  transition: none !important;
}
.workspace-split.${ANIMATING_CLASS} > .workspace-tabs,
.workspace-split.${ANIMATING_CLASS} > .workspace-split {
  min-width: var(${CONTENT_WIDTH}) !important;
  max-width: var(${CONTENT_WIDTH}) !important;
  visibility: visible !important;
}
.${PINNED_TOGGLE_CLASS} {
  position: fixed !important;
  left: var(${TOGGLE_LEFT}) !important;
  top: var(${TOGGLE_TOP}) !important;
  right: auto !important;
  bottom: auto !important;
  width: var(${TOGGLE_WIDTH}) !important;
  height: var(${TOGGLE_HEIGHT}) !important;
  box-sizing: border-box !important;
  margin: 0 !important;
  transform: none !important;
  transition: none !important;
  visibility: visible !important;
  z-index: var(--layer-cover, 1000);
}`;

interface ToggleState {
  element: HTMLElement;
  rect: DOMRect;
  inFlow: boolean;
  order: string;
  margin: string;
  placeholder?: HTMLElement;
  targetRect?: DOMRect;
}

interface AnimationState {
  collapsed: boolean;
  setupTimer?: number;
  frame?: number;
  toggle?: ToggleState;
  headerControls: ToggleState[];
}

function ease(progress: number, style: SidebarAnimationStyle, closing: boolean): number {
  if (style === "direct") return progress;
  if (style === "smooth") return progress * progress * (3 - 2 * progress);
  const back = 1.70158;
  // Opening travels slightly beyond the saved width, then settles. Closing
  // briefly pulls outward before folding, rather than trying a negative width.
  if (closing) return (back + 1) * progress ** 3 - back * progress ** 2;
  const remaining = progress - 1;
  return 1 + (back + 1) * remaining ** 3 + back * remaining ** 2;
}

export class SidebarAnimation extends Component {
  private active = new Map<HTMLElement, AnimationState>();
  private readonly doc: Document;
  private readonly win: Window;

  constructor(private app: App, private settings: () => HoverExpansionSettings) {
    super();
    this.doc = app.workspace.containerEl.ownerDocument;
    this.win = this.doc.defaultView!;
  }

  onload(): void {
    const style = this.doc.createElement("style");
    style.textContent = ANIMATION_CSS;
    this.doc.head.appendChild(style);
    this.register(() => style.remove());
  }

  setCollapsed(dock: WorkspaceSidedock, element: HTMLElement, collapsed: boolean): void {
    if (dock.collapsed === collapsed) return;
    const from = element.getBoundingClientRect().width;
    const savedWidth = parseFloat(element.style.width) || from;
    const toggle = this.captureRightToggle(element);
    const headerControls = this.captureRootHeaderControls(element);
    const previousButtons = toggle ? new Set(Array.from(this.doc.querySelectorAll(".sidebar-toggle-button.mod-right"))) : undefined;
    this.cancel(element);
    const state: AnimationState = { collapsed, toggle, headerControls };
    const controls = toggle ? [...headerControls, toggle] : headerControls;
    this.active.set(element, state);
    element.style.setProperty(WIDTH, `${from}px`);
    element.style.setProperty(CONTENT_WIDTH, `${Math.max(savedWidth, from)}px`);
    element.classList.add(ANIMATING_CLASS);
    if (collapsed) dock.collapse();
    else dock.expand();
    if (toggle) {
      // Obsidian reparents the real toggle and leaves an animated clone in the
      // old header. Remove only newly created clones, then pin the real button
      // after reparenting so our pin styles cannot be copied onto a clone.
      for (const button of Array.from(this.doc.querySelectorAll<HTMLElement>(".sidebar-toggle-button.mod-right"))) {
        if (button !== toggle.element && !previousButtons!.has(button)) button.remove();
      }
      this.pinToggle(toggle);
    }
    // Reparenting the sidebar toggle and changing frame padding move adjacent
    // controls instantly. Animate all real header controls, including custom
    // ones, rather than depending on the arrow's current class or icon.
    for (const control of headerControls) this.pinToggle(control, "hover-expansion-header-placeholder");

    // Native expand/collapse sets its target width on a zero-delay timer.
    // Read it after that timer, without depending on an undocumented dock size.
    state.setupTimer = this.win.setTimeout(() => {
      state.setupTimer = undefined;
      if (!element.isConnected || dock.collapsed !== collapsed) {
        this.cancel(element);
        return;
      }
      const to = collapsed ? 0 : parseFloat(element.style.width);
      if (!Number.isFinite(to)) {
        this.cancel(element);
        return;
      }
      // Keep header controls together at the saved content width during a
      // bounce; stretching that row would leave the toggle over its neighbors.
      element.style.setProperty(CONTENT_WIDTH, `${collapsed ? (savedWidth || from) : to}px`);
      const { animationDuration, animationStyle } = this.settings();
      const duration = this.win.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : animationDuration;
      this.measureControlTargets(controls, element, from, to);
      const finish = () => {
        element.style.setProperty(WIDTH, `${to}px`);
        for (const control of controls) this.moveControl(control, 1, to, Math.max(from, to), control === toggle && animationStyle === "overshoot");
        // Commit the final width before exposing the native inline styles, so
        // removing our class cannot start an extra native CSS transition.
        element.getBoundingClientRect();
        this.cancel(element);
        this.app.workspace.iterateAllLeaves(leaf => leaf.onResize());
        this.app.workspace.trigger("resize");
      };
      if (duration === 0 || from === to) {
        finish();
        return;
      }
      const start = this.win.performance.now();
      const step = (now: number) => {
        state.frame = undefined;
        if (!element.isConnected || dock.collapsed !== collapsed) {
          this.cancel(element);
          return;
        }
        const progress = Math.min(1, Math.max(0, (now - start) / duration));
        if (progress === 1) {
          finish();
          return;
        }
        const eased = ease(progress, animationStyle, collapsed);
        const width = from + (to - from) * eased;
        element.style.setProperty(WIDTH, `${Math.max(0, width)}px`);
        for (const control of controls) this.moveControl(control, eased, width, Math.max(from, to), control === toggle && animationStyle === "overshoot");
        state.frame = this.win.requestAnimationFrame(step);
      };
      state.frame = this.win.requestAnimationFrame(step);
    }, 0);
  }

  refresh(): void {
    // Manual sidebar actions must not leave a hover animation running.
    for (const [element, state] of this.active) {
      const side = element.classList.contains("mod-left-split") ? "leftSplit" : "rightSplit";
      const dock = this.app.workspace[side];
      if (!element.isConnected || dock.collapsed !== state.collapsed) this.cancel(element);
    }
  }

  private captureRightToggle(element: HTMLElement): ToggleState | undefined {
    if (!element.classList.contains("mod-right-split")) return;
    // The desktop workspace owns the real button; a selector alone can pick
    // up one of Obsidian's temporary clones from an earlier manual toggle.
    const workspace = this.app.workspace as typeof this.app.workspace & { rightSidebarToggleButtonEl?: HTMLElement };
    const toggle = workspace.rightSidebarToggleButtonEl ?? this.doc.querySelector<HTMLElement>(".sidebar-toggle-button.mod-right");
    if (!toggle?.isConnected) return;
    return this.captureControl(toggle, this.active.get(element)?.toggle);
  }

  private captureRootHeaderControls(sidebar: HTMLElement): ToggleState[] {
    if (!sidebar.classList.contains("mod-right-split")) return [];
    const previous = this.active.get(sidebar)?.headerControls ?? [];
    const controls: ToggleState[] = [];
    for (const header of Array.from(this.app.workspace.containerEl.querySelectorAll<HTMLElement>(".workspace-tab-header-container"))) {
      if (!header.closest(".mod-root")) continue;
      for (const child of Array.from(header.children)) {
        // The tab strip and flexible drag spacer retain their native layout.
        // Every other visible sibling is a control, regardless of its icon,
        // tag or plugin-specific class. A wrapper moves as one control.
        if (child.matches(".workspace-tab-header-container-inner, .workspace-tab-header-spacer, .sidebar-toggle-button, .hover-expansion-toggle-placeholder, .hover-expansion-header-placeholder")) continue;
        const element = child as HTMLElement;
        const control = this.captureControl(element, previous.find(control => control.element === element));
        if (control) controls.push(control);
      }
    }
    return controls;
  }

  private captureControl(element: HTMLElement, previous?: ToggleState): ToggleState | undefined {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const style = this.win.getComputedStyle(element);
    if (style.visibility === "hidden") return;
    return {
      element, rect,
      inFlow: previous?.inFlow ?? (style.position !== "fixed" && style.position !== "absolute"),
      order: previous?.order ?? style.order,
      margin: previous?.margin ?? style.margin
    };
  }

  private pinToggle(toggle: ToggleState, placeholderClass = "hover-expansion-toggle-placeholder"): void {
    const { element, rect } = toggle;
    if (toggle.inFlow && element.parentElement) {
      // Reserve the original flex space so neighboring header controls do not
      // slide underneath the button while it is positioned against the window.
      const placeholder = this.doc.createElement("div");
      placeholder.className = placeholderClass;
      placeholder.setAttribute("aria-hidden", "true");
      placeholder.style.width = `${rect.width}px`;
      placeholder.style.height = `${rect.height}px`;
      placeholder.style.flex = `0 0 ${rect.width}px`;
      placeholder.style.boxSizing = "border-box";
      placeholder.style.order = toggle.order;
      placeholder.style.margin = toggle.margin;
      placeholder.style.pointerEvents = "none";
      element.parentElement.insertBefore(placeholder, element);
      toggle.placeholder = placeholder;
    }
    element.style.setProperty(TOGGLE_LEFT, `${rect.left}px`);
    element.style.setProperty(TOGGLE_TOP, `${rect.top}px`);
    element.style.setProperty(TOGGLE_WIDTH, `${rect.width}px`);
    element.style.setProperty(TOGGLE_HEIGHT, `${rect.height}px`);
    element.classList.add(PINNED_TOGGLE_CLASS);
  }

  private measureControlTargets(controls: ToggleState[], sidebar: HTMLElement, from: number, to: number): void {
    // Measure all controls in the final native layout without painting it.
    // Temporarily restore their real flex items so custom controls can change
    // size, and so each target includes its neighbors' actual margins/widths.
    const contentWidth = sidebar.style.getPropertyValue(CONTENT_WIDTH);
    sidebar.style.setProperty(WIDTH, `${to}px`);
    sidebar.style.setProperty(CONTENT_WIDTH, `${to}px`);
    for (const control of controls) {
      if (control.placeholder) control.placeholder.style.display = "none";
      control.element.classList.remove(PINNED_TOGGLE_CLASS);
    }
    for (const control of controls) control.targetRect = control.element.getBoundingClientRect();
    for (const control of controls) {
      control.element.classList.add(PINNED_TOGGLE_CLASS);
      if (control.placeholder) control.placeholder.style.display = "";
    }
    sidebar.style.setProperty(WIDTH, `${from}px`);
    sidebar.style.setProperty(CONTENT_WIDTH, contentWidth);
  }

  private moveControl(toggle: ToggleState, eased: number, width: number, fullWidth: number, followBounce: boolean): void {
    const target = toggle.targetRect ?? toggle.rect;
    let left = toggle.rect.left + (target.left - toggle.rect.left) * eased;
    const top = toggle.rect.top + (target.top - toggle.rect.top) * eased;
    const controlWidth = Math.max(0, toggle.rect.width + (target.width - toggle.rect.width) * eased);
    const controlHeight = Math.max(0, toggle.rect.height + (target.height - toggle.rect.height) * eased);
    // Native right headers often place the button at the same start/end point.
    // In that layout, follow the panel's extra width during the overshoot so
    // the icon shares its bounce instead of staying frozen against the window.
    if (followBounce && Math.abs(target.left - toggle.rect.left) < 1) {
      const excess = Math.max(0, width - fullWidth);
      left -= excess * (1 - Math.exp(-excess / 4));
    }
    toggle.element.style.setProperty(TOGGLE_LEFT, `${left}px`);
    toggle.element.style.setProperty(TOGGLE_TOP, `${top}px`);
    toggle.element.style.setProperty(TOGGLE_WIDTH, `${controlWidth}px`);
    toggle.element.style.setProperty(TOGGLE_HEIGHT, `${controlHeight}px`);
    if (toggle.placeholder) {
      toggle.placeholder.style.width = `${controlWidth}px`;
      toggle.placeholder.style.height = `${controlHeight}px`;
      toggle.placeholder.style.flex = `0 0 ${controlWidth}px`;
    }
  }

  cancel(element: HTMLElement): void {
    const state = this.active.get(element);
    if (!state) return;
    if (state.setupTimer !== undefined) this.win.clearTimeout(state.setupTimer);
    if (state.frame !== undefined) this.win.cancelAnimationFrame(state.frame);
    this.active.delete(element);
    element.classList.remove(ANIMATING_CLASS);
    element.style.removeProperty(WIDTH);
    element.style.removeProperty(CONTENT_WIDTH);
    for (const control of state.toggle ? [...state.headerControls, state.toggle] : state.headerControls) {
      const toggle = control.element;
      toggle.classList.remove(PINNED_TOGGLE_CLASS);
      for (const property of [TOGGLE_LEFT, TOGGLE_TOP, TOGGLE_WIDTH, TOGGLE_HEIGHT]) toggle.style.removeProperty(property);
      control.placeholder?.remove();
    }
  }

  cancelAll(): void {
    for (const element of this.active.keys()) this.cancel(element);
  }

  onunload(): void {
    this.cancelAll();
  }
}
