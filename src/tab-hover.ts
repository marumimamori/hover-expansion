import { App, Component, WorkspaceLeaf } from "obsidian";
import { asElement, hasOverlay } from "./dom";
import type { HoverExpansionSettings } from "./settings";

// Obsidian exposes the header on desktop leaves, but it is not in the public typings.
type DesktopLeaf = WorkspaceLeaf & { tabHeaderEl?: HTMLElement };
interface DocumentState {
  doc: Document;
  win: Window;
  timer?: number;
  header?: HTMLElement;
  pressed: boolean;
  dragging: boolean;
  cleanup: () => void;
}

export class TabHover extends Component {
  private documents = new Map<Document, DocumentState>();

  constructor(private app: App, private settings: () => HoverExpansionSettings) { super(); }

  onload(): void {
    this.attach(this.app.workspace.containerEl.ownerDocument);
    this.app.workspace.iterateAllLeaves(leaf => this.attach(leaf.view.containerEl.ownerDocument));
    this.registerEvent(this.app.workspace.on("window-open", (_workspaceWindow, win) => this.attach(win.document)));
    this.registerEvent(this.app.workspace.on("window-close", (_workspaceWindow, win) => this.detach(win.document)));
    this.registerEvent(this.app.workspace.on("layout-change", () => {
      for (const state of this.documents.values()) {
        if (state.header && !state.header.isConnected) this.cancel(state);
      }
    }));
  }

  private attach(doc: Document): void {
    if (this.documents.has(doc) || !doc.defaultView) return;
    const removals: (() => void)[] = [];
    const state: DocumentState = {
      doc, win: doc.defaultView, pressed: false, dragging: false,
      cleanup: () => removals.forEach(remove => remove())
    };
    const listen = (target: EventTarget, name: string, callback: EventListener, capture = false) => {
      target.addEventListener(name, callback, capture);
      removals.push(() => target.removeEventListener(name, callback, capture));
    };
    listen(doc, "pointerover", event => this.over(state, event as PointerEvent));
    listen(doc, "pointerout", event => {
      if (state.header && !state.header.contains(asElement((event as PointerEvent).relatedTarget))) this.cancel(state);
    });
    listen(doc, "pointerdown", () => { state.pressed = true; this.cancel(state); }, true);
    listen(doc, "pointerup", () => { state.pressed = false; });
    listen(doc, "pointercancel", () => { state.pressed = false; this.cancel(state); });
    listen(doc, "dragstart", () => { state.dragging = true; this.cancel(state); }, true);
    for (const name of ["dragend", "drop"]) listen(doc, name, () => { state.dragging = false; }, true);
    listen(doc, "contextmenu", () => this.cancel(state), true);
    listen(state.win, "blur", () => {
      state.pressed = false;
      state.dragging = false;
      this.cancel(state);
    });
    this.documents.set(doc, state);
  }

  private over(state: DocumentState, event: PointerEvent): void {
    const target = asElement(event.target);
    const header = target?.closest<HTMLElement>(".workspace-tab-header");
    if (!this.settings().hoverTabs || state.pressed || state.dragging || event.buttons !== 0 ||
      (event.pointerType !== "mouse" && event.pointerType !== "pen") || !header ||
      target?.closest(".workspace-tab-header-inner-close-button, button") || hasOverlay(state.doc)) {
      this.cancel(state);
      return;
    }
    if (header === state.header) return;
    this.cancel(state);
    if (header.classList.contains("is-active")) return;
    state.header = header;
    const activate = () => {
      state.timer = undefined;
      if (!this.settings().hoverTabs || state.pressed || state.dragging ||
        !header.isConnected || state.header !== header || hasOverlay(state.doc)) return;
      let match: DesktopLeaf | undefined;
      this.app.workspace.iterateAllLeaves(leaf => {
        if ((leaf as DesktopLeaf).tabHeaderEl === header) match = leaf as DesktopLeaf;
      });
      if (match) this.app.workspace.setActiveLeaf(match, { focus: false });
    };
    if (this.settings().tabDelay === 0) activate();
    else state.timer = state.win.setTimeout(activate, this.settings().tabDelay);
  }

  private cancel(state: DocumentState): void {
    if (state.timer !== undefined) state.win.clearTimeout(state.timer);
    state.timer = undefined;
    state.header = undefined;
  }

  refresh(): void {
    for (const state of this.documents.values()) this.cancel(state);
  }

  private detach(doc: Document): void {
    const state = this.documents.get(doc);
    if (!state) return;
    this.cancel(state);
    state.cleanup();
    this.documents.delete(doc);
  }

  onunload(): void {
    for (const doc of this.documents.keys()) this.detach(doc);
  }
}
