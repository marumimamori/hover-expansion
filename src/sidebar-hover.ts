import { App, Component, WorkspaceSidedock } from "obsidian";
import { asElement, containsPoint, hasOverlay } from "./dom";
import type { HoverExpansionSettings } from "./settings";
import { SidebarAnimation } from "./sidebar-animation";

type Side = "left" | "right";
interface SideState {
  side: Side;
  dock: WorkspaceSidedock;
  element: HTMLElement;
  originalCollapsed: boolean;
  openTimer?: number;
  closeTimer?: number;
}

export class SidebarHover extends Component {
  private states = new Map<Side, SideState>();
  private pointer: { x: number; y: number; target: Element | null } | null = null;
  private pressed = false;
  private dragging = false;
  private stopped = false;
  private readonly doc: Document;
  private readonly win: Window;
  private readonly animation: SidebarAnimation;

  constructor(private app: App, private settings: () => HoverExpansionSettings) {
    super();
    this.doc = app.workspace.containerEl.ownerDocument;
    this.win = this.doc.defaultView!;
    this.animation = new SidebarAnimation(app, settings);
  }

  onload(): void {
    this.addChild(this.animation);
    this.registerDomEvent(this.doc, "pointermove", event => {
      if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
      // Native drags use dragover instead of pointermove. Pointer movement with
      // no button resumes after an external drag ends without a local dragend.
      if (this.dragging) {
        if (event.buttons !== 0) return;
        this.endDrag();
      }
      this.pointer = { x: event.clientX, y: event.clientY, target: asElement(event.target) };
      this.pressed = event.buttons !== 0;
      this.evaluate(true);
    }, { passive: true });
    this.registerDomEvent(this.doc, "pointerdown", () => {
      this.dragging = false;
      this.pressed = true;
      this.cancelHoverTimers();
      this.animation.cancelAll();
    }, { capture: true, passive: true });
    this.registerDomEvent(this.doc, "pointerup", event => {
      if (this.dragging) this.endDrag();
      this.pressed = false;
      this.pointer = { x: event.clientX, y: event.clientY, target: asElement(event.target) };
      this.evaluate(false);
    }, { passive: true });
    this.registerDomEvent(this.doc, "pointercancel", () => {
      // The browser cancels the pointer as soon as a native drag begins.
      if (!this.dragging) this.leaveWindow();
    });
    this.registerDomEvent(this.doc, "dragstart", event => {
      this.dragging = true;
      this.pressed = false;
      this.cancelHoverTimers();
      this.animation.cancelAll();
      this.updateDragPointer(event);
      this.evaluate(false);
    }, true);
    for (const name of ["dragenter", "dragover"] as const) {
      this.registerDomEvent(this.doc, name, event => {
        // Also handles files dragged in from another window or application.
        this.dragging = true;
        this.pressed = false;
        this.updateDragPointer(event);
        this.evaluate(true);
      }, { capture: true, passive: true });
    }
    this.registerDomEvent(this.doc, "dragleave", event => {
      if (!this.dragging) return;
      // Child-to-child dragleave events are common. Use the current position
      // and next target instead of treating every one as leaving the window.
      this.updateDragPointer(event, asElement(event.relatedTarget));
      this.evaluate(false);
    }, { capture: true, passive: true });
    this.registerDomEvent(this.doc, "drop", event => {
      this.updateDragPointer(event);
      this.endDrag();
    }, { capture: true, passive: true });
    this.registerDomEvent(this.doc, "dragend", () => this.endDrag(), true);
    this.registerDomEvent(this.doc, "pointerout", event => {
      if (!event.relatedTarget && !this.dragging) this.leaveWindow();
    });
    this.registerDomEvent(this.win, "blur", () => this.leaveWindow());
    this.registerDomEvent(this.win, "resize", () => {
      this.animation.cancelAll();
      this.evaluate(false);
    });
    this.registerEvent(this.app.workspace.on("layout-change", () => this.refresh()));
    this.refresh();
  }

  refresh(resetTimers = false): void {
    if (this.stopped) return;
    if (resetTimers) this.cancelHoverTimers();
    this.animation.refresh();
    for (const side of ["left", "right"] as const) {
      const enabled = this.settings()[side === "left" ? "leftSidebar" : "rightSidebar"];
      const dock = this.app.workspace[side === "left" ? "leftSplit" : "rightSplit"];
      const element = this.app.workspace.containerEl.querySelector<HTMLElement>(`.workspace-split.mod-${side}-split`);
      const current = this.states.get(side);
      if (current && (!enabled || current.dock !== dock || current.element !== element)) {
        this.states.delete(side);
        this.restore(current);
      }
      if (enabled && element && dock instanceof WorkspaceSidedock && !this.states.has(side)) {
        this.states.set(side, { side, dock, element, originalCollapsed: dock.collapsed });
      }
    }
    // Layout events must not reopen a sidebar just collapsed by a manual click.
    this.evaluate(false);
  }

  private leaveWindow(): void {
    this.pointer = null;
    this.pressed = false;
    this.dragging = false;
    this.evaluate(false);
  }

  private updateDragPointer(event: DragEvent, target = asElement(event.target)): void {
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    this.pointer = { x: event.clientX, y: event.clientY, target };
  }

  private endDrag(): void {
    this.dragging = false;
    this.pressed = false;
    this.cancelHoverTimers();
    this.evaluate(false);
  }

  private isInteractionBlocked(): boolean {
    return (this.pressed && !this.dragging) || hasOverlay(this.doc);
  }

  private isAtEdge(side: Side): boolean {
    if (!this.pointer) return false;
    const { x, y } = this.pointer;
    const area = this.app.workspace.containerEl.getBoundingClientRect();
    if (y < area.top || y > area.bottom || x < 0 || x > this.win.innerWidth) return false;
    // Keep the two hover areas separate even in a narrow window.
    const width = Math.min(this.settings().edgeWidth, Math.max(0, (this.win.innerWidth - 1) / 2));
    return side === "left" ? x <= width : x >= this.win.innerWidth - width;
  }

  private isInside(state: SideState): boolean {
    if (!this.pointer) return false;
    const { x, y, target } = this.pointer;
    if (state.element.contains(target) || containsPoint(state.element, x, y) || this.isAtEdge(state.side)) return true;
    // The ribbon bridges the left window edge and the expanded panel.
    const ribbon = this.app.workspace.containerEl.querySelector<HTMLElement>(`.workspace-ribbon.mod-${state.side}`);
    return !!ribbon && containsPoint(ribbon, x, y);
  }

  private evaluate(allowOpen: boolean): void {
    for (const state of this.states.values()) {
      if (!state.dock.collapsed || !this.isAtEdge(state.side)) this.cancelOpen(state);
      if (this.isInteractionBlocked()) {
        this.cancelOpen(state);
        this.cancelClose(state);
        if (!state.dock.collapsed) this.scheduleClose(state);
        continue;
      }
      if (allowOpen && state.dock.collapsed && this.isAtEdge(state.side)) {
        this.cancelClose(state);
        this.scheduleOpen(state);
      }
      if (state.dock.collapsed || this.isInside(state)) this.cancelClose(state);
      else this.scheduleClose(state);
    }
  }

  private scheduleOpen(state: SideState): void {
    if (state.openTimer !== undefined) return;
    const delay = this.settings().openDelay;
    if (delay === 0) {
      this.animation.setCollapsed(state.dock, state.element, false);
      return;
    }
    state.openTimer = this.win.setTimeout(() => {
      state.openTimer = undefined;
      if (this.stopped || this.states.get(state.side) !== state || !state.dock.collapsed ||
        this.isInteractionBlocked() || !this.isAtEdge(state.side)) return;
      this.animation.setCollapsed(state.dock, state.element, false);
    }, delay);
  }

  private scheduleClose(state: SideState): void {
    if (state.closeTimer !== undefined) return;
    state.closeTimer = this.win.setTimeout(() => {
      state.closeTimer = undefined;
      if (this.stopped || this.states.get(state.side) !== state || state.dock.collapsed) return;
      if (this.isInteractionBlocked()) {
        // Retry after a context menu or mouse interaction finishes, even if the pointer stays still.
        state.closeTimer = this.win.setTimeout(() => {
          state.closeTimer = undefined;
          this.evaluate(false);
        }, 100);
        return;
      }
      if (!this.isInside(state)) this.animation.setCollapsed(state.dock, state.element, true);
    }, this.settings().closeDelay);
  }

  private cancelClose(state: SideState): void {
    if (state.closeTimer !== undefined) this.win.clearTimeout(state.closeTimer);
    state.closeTimer = undefined;
  }

  private cancelOpen(state: SideState): void {
    if (state.openTimer !== undefined) this.win.clearTimeout(state.openTimer);
    state.openTimer = undefined;
  }

  private cancelHoverTimers(): void {
    for (const state of this.states.values()) {
      this.cancelOpen(state);
      this.cancelClose(state);
    }
  }

  private restore(state: SideState): void {
    this.cancelOpen(state);
    this.cancelClose(state);
    this.animation.cancel(state.element);
    if (!state.element.isConnected) return;
    if (state.originalCollapsed) state.dock.collapse();
    else state.dock.expand();
  }

  onunload(): void {
    this.stopped = true;
    for (const state of this.states.values()) this.restore(state);
    this.states.clear();
  }
}
