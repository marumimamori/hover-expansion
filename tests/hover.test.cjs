const { test } = require("node:test");
const assert = require("node:assert/strict");
const esbuild = require("esbuild");
const vm = require("node:vm");
const path = require("node:path");

class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(name, callback) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(callback);
  }
  removeEventListener(name, callback) { this.listeners.get(name)?.delete(callback); }
  dispatch(name, props = {}) {
    const event = { pointerType: "mouse", buttons: 0, relatedTarget: null, ...props };
    for (const callback of [...(this.listeners.get(name) || [])]) callback(event);
    return event;
  }
  on(name, callback) {
    this.addEventListener(name, callback);
    return { off: () => this.removeEventListener(name, callback) };
  }
  trigger(name) { this.dispatch(name); }
  listenerCount() { return [...this.listeners.values()].reduce((sum, entries) => sum + entries.size, 0); }
}

class FakeWindow extends Events {
  constructor() {
    super(); this.innerWidth = 1000; this.now = 0; this.next = 1; this.timers = new Map();
    this.performance = { now: () => this.now }; this.reducedMotion = false;
  }
  setTimeout(callback, delay) {
    const id = this.next++; this.timers.set(id, { callback, time: this.now + delay }); return id;
  }
  clearTimeout(id) { this.timers.delete(id); }
  requestAnimationFrame(callback) { return this.setTimeout(() => callback(this.now), 16); }
  cancelAnimationFrame(id) { this.clearTimeout(id); }
  matchMedia() { return { matches: this.reducedMotion }; }
  getComputedStyle(element) { return { position: element.style.position || "relative", order: element.style.order || "0", margin: element.style.margin || "0px" }; }
  tick(ms) {
    const end = this.now + ms;
    for (let count = 0; count < 10000; count++) {
      const next = [...this.timers].filter(([, timer]) => timer.time <= end).sort((a, b) => a[1].time - b[1].time)[0];
      if (!next) { this.now = end; return; }
      this.now = next[1].time; this.timers.delete(next[0]); next[1].callback();
    }
    throw new Error("Timer loop");
  }
}

class Style {
  constructor() { this.properties = new Map(); }
  setProperty(name, value) { this.properties.set(name, value); }
  getPropertyValue(name) { return this.properties.get(name) || ""; }
  removeProperty(name) { this.properties.delete(name); }
}

class Element {
  constructor(doc, classes = "", rect = {}) {
    this.ownerDocument = doc; this.nodeType = 1; this.isConnected = true;
    this.classes = new Set(classes.split(" ")); this.children = [];
    this.rect = { left: 0, right: 0, top: 30, bottom: 730, width: 0, height: 700, ...rect };
    this.classList = {
      contains: name => this.classes.has(name),
      add: name => this.classes.add(name), remove: name => this.classes.delete(name)
    };
    this.style = new Style();
    this.tagName = "DIV";
  }
  get parentElement() { return this.parent || null; }
  get className() { return [...this.classes].join(" "); }
  set className(value) { this.classes = new Set(value.split(" ")); }
  setAttribute(name, value) { (this.attributes ||= new Map()).set(name, value); }
  append(child) {
    child.remove(); this.children.push(child); child.parent = this; child.isConnected = true; return child;
  }
  appendChild(child) { return this.append(child); }
  insertBefore(child, reference) {
    child.remove(); this.children.splice(this.children.indexOf(reference), 0, child); child.parent = this; child.isConnected = true; return child;
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this);
    this.parent = null; this.isConnected = false;
  }
  contains(node) { return !!node && (node === this || this.children.some(child => child.contains(node))); }
  matches(selector) {
    return selector.split(",").some(part => {
      part = part.trim();
      if (!part.startsWith(".")) return this.tagName.toLowerCase() === part;
      return part.slice(1).split(".").every(name => this.classes.has(name));
    });
  }
  closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector) || null; }
  querySelector(selector) {
    for (const child of this.children) {
      if (child.matches(selector)) return child;
      const match = child.querySelector(selector); if (match) return match;
    }
    return null;
  }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  getBoundingClientRect() {
    const next = this.parent?.children[this.parent.children.indexOf(this) + 1];
    const rect = { ...(this.measure?.() || (this.classes.has("hover-expansion-toggle-placeholder") && this.parent?.toggleRect?.()) || (this.classes.has("hover-expansion-header-placeholder") && this.parent?.headerControlRect?.(next)) || this.rect) };
    if (this.classes.has("hover-expansion-toggle-pinned")) {
      rect.left = parseFloat(this.style.getPropertyValue("--hover-expansion-toggle-left"));
      rect.top = parseFloat(this.style.getPropertyValue("--hover-expansion-toggle-top"));
      rect.width = parseFloat(this.style.getPropertyValue("--hover-expansion-toggle-width"));
      rect.height = parseFloat(this.style.getPropertyValue("--hover-expansion-toggle-height"));
      rect.right = rect.left + rect.width; rect.bottom = rect.top + rect.height;
    }
    if (this.classes.has("mod-left-split") || this.classes.has("mod-right-split")) {
      if (this.classes.has("hover-expansion-animating")) rect.width = parseFloat(this.style.getPropertyValue("--hover-expansion-width"));
      else if (this.style.display === "none") rect.width = 0;
      else if (this.style.width) rect.width = parseFloat(this.style.width);
      if (this.classes.has("mod-left-split")) rect.right = rect.left + rect.width;
      else rect.left = rect.right - rect.width;
    }
    return rect;
  }
}

class FakeDocument extends Events {
  constructor() {
    super(); this.defaultView = new FakeWindow(); this.defaultView.document = this;
    this.body = new Element(this);
    this.head = new Element(this);
  }
  createElement(tagName) { const element = new Element(this); element.tagName = tagName.toUpperCase(); return element; }
  querySelector(selector) { return this.body.querySelector(selector); }
  querySelectorAll(selector) { return this.body.querySelectorAll(selector); }
}

class Component {
  constructor() { this.cleanups = []; this.children = []; }
  load() { this.loaded = true; this.onload?.(); }
  unload() {
    this.onunload?.(); this.children.forEach(child => child.unload());
    this.cleanups.forEach(cleanup => cleanup()); this.loaded = false;
  }
  registerEvent(ref) { this.cleanups.push(ref.off); }
  register(cleanup) { this.cleanups.push(cleanup); }
  registerDomEvent(target, name, callback, options) {
    target.addEventListener(name, callback, options);
    this.cleanups.push(() => target.removeEventListener(name, callback, options));
  }
  addChild(child) { this.children.push(child); if (this.loaded) child.load(); return child; }
}

class WorkspaceSidedock {
  constructor(workspace, element, collapsed) {
    this.workspace = workspace; this.element = element; this.collapsed = collapsed;
    this.expansions = 0; this.collapses = 0; this.render();
  }
  render() {
    this.element.rect.width = this.collapsed ? 0 : 240;
    if (this.element.classes.has("mod-left-split")) this.element.rect.right = this.collapsed ? 40 : 280;
    else this.element.rect.left = this.collapsed ? 1000 : 760;
    this.element.style.width = `${this.collapsed ? 0 : 240}px`;
    this.element.style.display = this.collapsed ? "none" : "";
    if (this.element.classes.has("mod-right-split")) this.workspace.moveRightToggle?.();
  }
  nativeAnimation() {
    if (!this.workspace.nativeAnimations) return;
    const win = this.element.ownerDocument.defaultView;
    win.clearTimeout(this.setup); win.clearTimeout(this.cleanup);
    this.element.style.width = this.collapsed ? "240px" : "0px";
    this.element.style.display = "";
    this.setup = win.setTimeout(() => {
      this.element.style.transition = "all 140ms ease-in-out";
      this.element.style.width = this.collapsed ? "0px" : "240px";
      this.cleanup = win.setTimeout(() => {
        this.element.style.transition = "";
        if (this.collapsed) this.element.style.display = "none";
      }, 190);
    }, 0);
  }
  expand() { if (!this.collapsed) return; this.collapsed = false; this.expansions++; this.render(); this.nativeAnimation(); this.workspace.dispatch("layout-change"); }
  collapse() { if (this.collapsed) return; this.collapsed = true; this.collapses++; this.render(); this.nativeAnimation(); this.workspace.dispatch("layout-change"); }
}

class Plugin extends Component {
  async loadData() { return this.saved || null; }
  async saveData(value) { this.saved = value; }
  addSettingTab() {}
}
const obsidian = { Component, WorkspaceSidedock, WorkspaceLeaf: class {}, Plugin, PluginSettingTab: class {}, Setting: class {} };
const modules = new Map();
function loadModule(relative) {
  if (modules.has(relative)) return modules.get(relative);
  const source = esbuild.buildSync({
    entryPoints: [path.join(__dirname, "..", relative)], bundle: true,
    external: ["obsidian"], format: "cjs", platform: "node", write: false
  }).outputFiles[0].text;
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, require: name => {
    assert.equal(name, "obsidian"); return obsidian;
  } });
  modules.set(relative, module.exports); return module.exports;
}
const { SidebarHover } = loadModule("src/sidebar-hover.ts");
const { TabHover } = loadModule("src/tab-hover.ts");
const { DEFAULT_SETTINGS, loadSettings } = loadModule("src/settings.ts");
const HoverExpansionPlugin = loadModule("main.ts").default;

function fixture({ left = true, right = true, nativeAnimations = false, toggleFrames = false, headerControls = false, patch = {} } = {}) {
  const doc = new FakeDocument(); const win = doc.defaultView;
  const workspace = new Events();
  workspace.nativeAnimations = nativeAnimations;
  workspace.containerEl = doc.body.append(new Element(doc, "workspace", { left: 0, right: 1000, width: 1000 }));
  const leftEl = workspace.containerEl.append(new Element(doc, "workspace-split mod-left-split", { left: 40, right: 280, width: 240 }));
  const rightEl = workspace.containerEl.append(new Element(doc, "workspace-split mod-right-split", { left: 760, right: 1000, width: 240 }));
  const ribbon = workspace.containerEl.append(new Element(doc, "workspace-ribbon mod-left", { left: 0, right: 40, width: 40 }));
  workspace.leftSplit = new WorkspaceSidedock(workspace, leftEl, left);
  workspace.rightSplit = new WorkspaceSidedock(workspace, rightEl, right);
  let rightToggle, pageHeader, rightHeader, tabList, newTab, sidebarTabList;
  if (toggleFrames) {
    const root = workspace.containerEl.append(new Element(doc, "workspace-split mod-root"));
    pageHeader = root.append(new Element(doc, "workspace-tab-header-container"));
    rightHeader = rightEl.append(new Element(doc, "workspace-tab-header-container"));
    rightToggle = (right ? pageHeader : rightHeader).append(new Element(doc, "sidebar-toggle-button mod-right", {
      left: 936, right: 968, top: 30, bottom: 69, width: 32, height: 39
    }));
    workspace.rightSidebarToggleButtonEl = rightToggle;
    const toggleRect = header => {
      const width = rightEl.getBoundingClientRect().width;
      const offset = header.frameOffset || { x: 0, y: 0 };
      const contentWidth = rightEl.classList.contains("hover-expansion-animating") ? parseFloat(rightEl.style.getPropertyValue("--hover-expansion-content-width")) : Math.max(240, width);
      const left = 936 - width + (header === rightHeader ? contentWidth : 0) + offset.x;
      return { ...rightToggle.rect, left, right: left + 32, top: 30 + offset.y, bottom: 69 + offset.y };
    };
    pageHeader.toggleRect = () => toggleRect(pageHeader);
    rightHeader.toggleRect = () => toggleRect(rightHeader);
    rightToggle.measure = () => toggleRect(rightToggle.parentElement);
    workspace.nativeGhosts = [];
    workspace.moveRightToggle = () => {
      const next = workspace.rightSplit.collapsed ? pageHeader : rightHeader;
      if (rightToggle.parentElement === next) return;
      const clone = rightToggle.parentElement.append(new Element(doc, rightToggle.className, rightToggle.getBoundingClientRect()));
      workspace.nativeGhosts.push(clone); win.setTimeout(() => clone.remove(), 190);
      next.append(rightToggle);
    };
    if (headerControls) {
      // Native frameless layout changes root padding and moves the sidebar
      // toggle immediately. The tab-list arrow would jump 128 px at width 0.
      pageHeader.headerControlRect = control => {
        const width = rightEl.getBoundingClientRect().width;
        const padding = workspace.rightSplit.collapsed ? 104 : 8;
        const toggleWidth = workspace.rightSplit.collapsed ? 32 : 0;
        const offset = control.classList.contains("workspace-tab-header-new-tab") ? 48 : 0;
        const left = 1000 - width - padding - toggleWidth - 4 - 28 - offset;
        return { left, right: left + 28, top: 30, bottom: 69, width: 28, height: 39 };
      };
      newTab = pageHeader.append(new Element(doc, "workspace-tab-header-new-tab"));
      tabList = pageHeader.append(new Element(doc, "workspace-tab-header-tab-list"));
      newTab.style.margin = "0px 12px 0px -4px";
      tabList.style.margin = "0px 4px 0px 0px";
      newTab.measure = () => pageHeader.headerControlRect(newTab);
      tabList.measure = () => pageHeader.headerControlRect(tabList);
      // A sidebar's hidden tab-list control must not be animated as a root one.
      sidebarTabList = rightHeader.append(new Element(doc, "workspace-tab-header-tab-list", { width: 28, height: 39 }));
    }
  }
  const headers = [leftEl, rightEl, workspace.containerEl].map(parent => parent.append(new Element(doc, "workspace-tab-header")));
  const leaves = headers.map(tabHeaderEl => ({ tabHeaderEl, view: { containerEl: tabHeaderEl }, onResize() {} }));
  workspace.iterateAllLeaves = callback => leaves.forEach(callback);
  workspace.activations = [];
  workspace.setActiveLeaf = (leaf, params) => {
    workspace.activations.push({ leaf, params }); leaf.tabHeaderEl.classes.add("is-active");
  };
  // Existing timing scenarios use explicit values; defaults are checked separately.
  const app = { workspace }; const settings = { ...DEFAULT_SETTINGS, tabDelay: 80, openDelay: 0, closeDelay: 180, edgeWidth: 12, ...patch };
  const sidebar = new SidebarHover(app, () => settings); const tabs = new TabHover(app, () => settings);
  sidebar.load(); tabs.load();
  const move = (x, target = workspace.containerEl, y = 200, props = {}) => doc.dispatch("pointermove", { clientX: x, clientY: y, target, ...props });
  const over = (index = 0, props = {}) => doc.dispatch("pointerover", { target: headers[index], ...props });
  return { app, workspace, doc, win, sidebar, tabs, settings, headers, leaves, leftEl, rightEl, ribbon, move, over, rightToggle, pageHeader, rightHeader, tabList, newTab, sidebarTabList };
}

test("all three features default on; invalid saved values are bounded", () => {
  assert.equal(DEFAULT_SETTINGS.leftSidebar, true); assert.equal(DEFAULT_SETTINGS.rightSidebar, true); assert.equal(DEFAULT_SETTINGS.hoverTabs, true);
  assert.equal(DEFAULT_SETTINGS.tabDelay, 0); assert.equal(DEFAULT_SETTINGS.openDelay, 30);
  assert.equal(DEFAULT_SETTINGS.closeDelay, 200); assert.equal(DEFAULT_SETTINGS.edgeWidth, 40);
  assert.equal(DEFAULT_SETTINGS.animationDuration, 300); assert.equal(DEFAULT_SETTINGS.animationStyle, "smooth");
  const settings = loadSettings({ leftSidebar: false, rightSidebar: "false", tabDelay: -10, openDelay: 9000, closeDelay: Infinity, edgeWidth: 900 });
  assert.equal(settings.leftSidebar, false); assert.equal(settings.rightSidebar, true);
  assert.equal(settings.tabDelay, 0); assert.equal(settings.openDelay, 1000);
  assert.equal(settings.closeDelay, 200); assert.equal(settings.edgeWidth, 300);
});

test("animation preferences migrate, validate, and save", async () => {
  const migrated = loadSettings({ openDelay: 60 });
  assert.equal(migrated.openDelay, 60); assert.equal(migrated.animationDuration, 300); assert.equal(migrated.animationStyle, "smooth");
  assert.equal(loadSettings({ animationDuration: 200 }).animationDuration, 200);
  for (const [value, expected] of [[-1, 0], [2001, 2000], [452.7, 453], [NaN, 300], [Infinity, 300], ["500", 300]]) {
    assert.equal(loadSettings({ animationDuration: value }).animationDuration, expected);
  }
  assert.equal(loadSettings({ animationStyle: "unknown" }).animationStyle, "smooth");
  for (const animationStyle of ["direct", "smooth", "overshoot"]) {
    const plugin = new HoverExpansionPlugin(); plugin.settings = loadSettings(null);
    await plugin.updateSettings({ animationDuration: 640, animationStyle });
    assert.equal(plugin.saved.animationDuration, 640); assert.equal(plugin.saved.animationStyle, animationStyle);
    assert.equal(loadSettings(plugin.saved).animationStyle, animationStyle);
  }
});

test("long animations on both sides continue past native cleanup and honor hover delays", () => {
  for (const [edge, elementKey, dockKey] of [[0, "leftEl", "leftSplit"], [999, "rightEl", "rightSplit"]]) {
    const f = fixture({ nativeAnimations: true, patch: { openDelay: 100, closeDelay: 100, animationDuration: 640, animationStyle: "direct" } });
    const element = f[elementKey], dock = f.workspace[dockKey];
    f.move(edge); f.win.tick(99); assert.equal(dock.collapsed, true);
    f.win.tick(1); assert.equal(dock.collapsed, false); assert.equal(element.getBoundingClientRect().width, 0);
    f.win.tick(320); assert.equal(element.getBoundingClientRect().width, 120);
    f.win.tick(320); assert.equal(element.getBoundingClientRect().width, 240);
    assert.equal(element.classList.contains("hover-expansion-animating"), false);
    f.move(500); f.win.tick(99); assert.equal(dock.collapsed, false);
    f.win.tick(1); assert.equal(dock.collapsed, true);
    f.win.tick(320); assert.equal(element.style.display, "none"); assert.equal(element.getBoundingClientRect().width, 120);
    f.win.tick(320); assert.equal(element.getBoundingClientRect().width, 0);
    assert.equal(element.classList.contains("hover-expansion-animating"), false);
  }
});

test("direct, smooth, and overshoot produce distinct movement and settle at saved widths", () => {
  const widthAt = (style, time) => {
    const f = fixture({ patch: { animationDuration: 640, animationStyle: style } });
    f.move(0); f.win.tick(time);
    const width = f.leftEl.getBoundingClientRect().width;
    f.win.tick(640); assert.equal(f.leftEl.getBoundingClientRect().width, 240);
    return width;
  };
  assert.equal(widthAt("direct", 160), 60);
  assert.ok(widthAt("smooth", 160) < 60);
  assert.ok(widthAt("smooth", 480) > 180);
  assert.ok(widthAt("overshoot", 480) > 240);
  const f = fixture({ patch: { animationDuration: 640, animationStyle: "overshoot", closeDelay: 0 } });
  f.move(0); f.win.tick(640); f.move(500); f.win.tick(160);
  assert.ok(f.leftEl.getBoundingClientRect().width > 240);
  f.win.tick(480); assert.equal(f.leftEl.getBoundingClientRect().width, 0);
});

test("zero duration and reduced motion settle without animation frames", () => {
  for (const reducedMotion of [false, true]) {
    const f = fixture({ nativeAnimations: true, patch: { animationDuration: reducedMotion ? 640 : 0, closeDelay: 0 } });
    f.win.reducedMotion = reducedMotion;
    f.move(0); f.win.tick(0); assert.equal(f.leftEl.getBoundingClientRect().width, 240);
    assert.equal(f.leftEl.classList.contains("hover-expansion-animating"), false);
    f.move(500); f.win.tick(0); assert.equal(f.leftEl.getBoundingClientRect().width, 0);
    assert.equal(f.leftEl.classList.contains("hover-expansion-animating"), false);
    f.win.tick(1000); assert.equal(f.win.timers.size, 0);
  }
});

test("reversing a moving sidebar continues from its visible width", () => {
  const f = fixture({ nativeAnimations: true, patch: { animationDuration: 640, animationStyle: "direct", closeDelay: 0 } });
  f.move(0); f.win.tick(320); assert.equal(f.leftEl.getBoundingClientRect().width, 120);
  f.move(500); f.win.tick(0); assert.equal(f.leftEl.getBoundingClientRect().width, 120);
  f.win.tick(160); assert.equal(f.leftEl.getBoundingClientRect().width, 90);
  f.move(0); f.win.tick(0); assert.equal(f.leftEl.getBoundingClientRect().width, 90);
  f.win.tick(640); assert.equal(f.leftEl.getBoundingClientRect().width, 240);
});

test("right toggle follows the overshoot on opening and closing without native jumps or clones", () => {
  for (const animationStyle of ["direct", "smooth", "overshoot"]) {
    const f = fixture({ toggleFrames: true, nativeAnimations: true, patch: { animationDuration: 640, animationStyle, closeDelay: 0 } });
    const original = f.rightToggle.getBoundingClientRect();
    for (const edge of [999, 500]) {
      f.move(edge); f.win.tick(0);
      assert.equal(f.workspace.rightSidebarToggleButtonEl, f.rightToggle);
      assert.equal(f.doc.querySelectorAll(".sidebar-toggle-button.mod-right").length, 1);
      assert.equal(f.doc.querySelectorAll(".hover-expansion-toggle-placeholder").length, 1);
      let overshot = false;
      let lastLeft = original.left;
      let furthestLeft = original.left;
      for (let frame = 0; frame < 39; frame++) {
        f.win.tick(16);
        const width = f.rightEl.getBoundingClientRect().width;
        const left = f.rightToggle.getBoundingClientRect().left;
        assert.ok(Math.abs(left - lastLeft) < 25, "icon must move continuously between frames");
        if (animationStyle === "overshoot" && width > 240) assert.ok(left < original.left);
        else assert.equal(left, original.left);
        assert.equal(f.rightToggle.getBoundingClientRect().top, original.top);
        overshot ||= width > 240;
        furthestLeft = Math.min(furthestLeft, left); lastLeft = left;
      }
      if (animationStyle === "overshoot") {
        assert.equal(overshot, true);
        assert.ok(furthestLeft < original.left - 8, "icon must visibly share the panel's bounce");
      }
      f.win.tick(16);
      assert.equal(f.rightToggle.getBoundingClientRect().left, original.left);
      assert.equal(f.rightToggle.classList.contains("hover-expansion-toggle-pinned"), false);
      assert.equal(f.doc.querySelectorAll(".hover-expansion-toggle-placeholder").length, 0);
      assert.equal(f.rightToggle.style.getPropertyValue("--hover-expansion-toggle-left"), "");
    }
  }
});

test("reversing right overshoot keeps one real toggle and reserves its header space", () => {
  const f = fixture({ toggleFrames: true, nativeAnimations: true, patch: { animationDuration: 640, animationStyle: "overshoot", closeDelay: 0 } });
  f.move(999); f.win.tick(640); f.move(500); f.win.tick(160);
  assert.ok(f.rightEl.getBoundingClientRect().width > 240);
  const beforeReversal = f.rightToggle.getBoundingClientRect().left;
  f.move(999); f.win.tick(0);
  assert.equal(f.rightToggle.getBoundingClientRect().left, beforeReversal);
  assert.equal(f.doc.querySelectorAll(".hover-expansion-toggle-placeholder").length, 1);
  assert.equal(f.doc.querySelectorAll(".sidebar-toggle-button.mod-right").length, 1);
  f.win.tick(640);
  assert.equal(f.rightToggle.parentElement, f.rightHeader);
  assert.equal(f.rightToggle.getBoundingClientRect().left, 936);
  assert.equal(f.doc.querySelectorAll(".hover-expansion-toggle-placeholder").length, 0);
});

test("different native header positions animate with the sidebar's easing and settle without a snap", () => {
  for (const animationStyle of ["direct", "smooth", "overshoot"]) {
    const f = fixture({ toggleFrames: true, nativeAnimations: true, patch: { animationDuration: 640, animationStyle, closeDelay: 0 } });
    f.rightHeader.frameOffset = { x: -48, y: 12 };
    for (const edge of [999, 500]) {
      const before = f.rightToggle.getBoundingClientRect();
      f.move(edge); f.win.tick(0);
      assert.equal(f.rightToggle.getBoundingClientRect().left, before.left);
      assert.equal(f.rightToggle.getBoundingClientRect().top, before.top);
      let lastLeft = before.left;
      for (let frame = 0; frame < 40; frame++) {
        f.win.tick(16);
        const ratio = f.rightEl.getBoundingClientRect().width / 240;
        const rect = f.rightToggle.getBoundingClientRect();
        assert.ok(Math.abs(rect.left - (936 - 48 * ratio)) < 0.001);
        assert.ok(Math.abs(rect.top - (30 + 12 * ratio)) < 0.001);
        assert.ok(Math.abs(rect.left - lastLeft) < 8, "no jump when returning to the native header");
        lastLeft = rect.left;
      }
    }
  }
});

test("zero duration and reduced motion settle the right toggle into its actual destination", () => {
  for (const reducedMotion of [false, true]) {
    const f = fixture({ toggleFrames: true, nativeAnimations: true, patch: { animationDuration: reducedMotion ? 640 : 0, animationStyle: "overshoot", closeDelay: 0 } });
    f.rightHeader.frameOffset = { x: -48, y: 12 }; f.win.reducedMotion = reducedMotion;
    f.move(999); f.win.tick(0);
    assert.equal(f.rightToggle.getBoundingClientRect().left, 888);
    assert.equal(f.rightToggle.getBoundingClientRect().top, 42);
    assert.equal(f.rightToggle.classList.contains("hover-expansion-toggle-pinned"), false);
    f.move(500); f.win.tick(0);
    assert.equal(f.rightToggle.getBoundingClientRect().left, 936);
    assert.equal(f.doc.querySelectorAll(".hover-expansion-toggle-placeholder").length, 0);
  }
});

test("right toggle pinning cleans up on clicks, manual actions, resize, and unload", () => {
  for (const cancel of [
    f => f.doc.dispatch("pointerdown"), f => f.workspace.rightSplit.collapse(),
    f => f.win.dispatch("resize"), f => f.sidebar.unload()
  ]) {
    const f = fixture({ toggleFrames: true, patch: { animationDuration: 640, animationStyle: "overshoot" } });
    f.move(999); f.win.tick(160); cancel(f);
    assert.equal(f.rightToggle.classList.contains("hover-expansion-toggle-pinned"), false);
    assert.equal(f.doc.querySelectorAll(".hover-expansion-toggle-placeholder").length, 0);
    assert.equal(f.rightToggle.style.getPropertyValue("--hover-expansion-toggle-width"), "");
  }
});

test("an already fixed right toggle does not gain a header placeholder", () => {
  const f = fixture({ toggleFrames: true, patch: { animationDuration: 640 } });
  f.rightToggle.style.position = "fixed";
  f.move(999); f.win.tick(160);
  assert.equal(f.rightToggle.getBoundingClientRect().left, 936);
  assert.equal(f.doc.querySelectorAll(".hover-expansion-toggle-placeholder").length, 0);
  f.sidebar.unload(); assert.equal(f.rightToggle.style.position, "fixed");
});

test("root header controls follow the sidebar easing across native spacing changes", () => {
  for (const animationStyle of ["direct", "smooth", "overshoot"]) {
    const f = fixture({ toggleFrames: true, headerControls: true, nativeAnimations: true, patch: { animationDuration: 640, animationStyle, closeDelay: 0 } });
    for (const edge of [999, 500]) {
      const before = f.tabList.getBoundingClientRect();
      f.move(edge); f.win.tick(0);
      assert.equal(f.tabList.getBoundingClientRect().left, before.left, "no initial jump when frame padding changes");
      assert.equal(f.doc.querySelectorAll(".hover-expansion-header-placeholder").length, 2);
      assert.equal(f.sidebarTabList.classList.contains("hover-expansion-toggle-pinned"), false);
      assert.deepEqual(f.doc.querySelectorAll(".hover-expansion-header-placeholder").map(el => el.style.margin), [f.newTab.style.margin, f.tabList.style.margin]);
      let previous = before.left;
      for (let frame = 0; frame < 40; frame++) {
        f.win.tick(16);
        const ratio = f.rightEl.getBoundingClientRect().width / 240;
        const rect = f.tabList.getBoundingClientRect();
        assert.ok(Math.abs(rect.left - (832 - 112 * ratio)) < 0.001, "arrow and panel share the same easing");
        assert.ok(Math.abs(f.newTab.getBoundingClientRect().left - (784 - 112 * ratio)) < 0.001);
        assert.ok(Math.abs(rect.left - previous) < 20, "no frame jump or final snap");
        previous = rect.left;
      }
      assert.equal(f.doc.querySelectorAll(".hover-expansion-header-placeholder").length, 0);
      assert.equal(f.tabList.classList.contains("hover-expansion-toggle-pinned"), false);
      assert.equal(f.tabList.style.getPropertyValue("--hover-expansion-toggle-left"), "");
    }
  }
});

test("unknown header controls and wrappers animate without depending on icon classes", () => {
  const f = fixture({ toggleFrames: true, headerControls: true, patch: { animationDuration: 640, animationStyle: "overshoot", closeDelay: 0 } });
  const custom = f.pageHeader.append(new Element(f.doc, "another-plugin-toolbar"));
  custom.append(new Element(f.doc, "arbitrary-nested-button", { width: 16, height: 16 }));
  custom.style.margin = "0px 7px 0px 3px";
  custom.measure = () => {
    const left = f.pageHeader.headerControlRect(f.tabList).left - 90;
    const width = f.workspace.rightSplit.collapsed ? 24 : 40;
    return { left, right: left + width, top: 34, bottom: 66, width, height: 32 };
  };
  const strip = f.pageHeader.append(new Element(f.doc, "workspace-tab-header-container-inner", { width: 300, height: 39 }));
  const spacer = f.pageHeader.append(new Element(f.doc, "workspace-tab-header-spacer", { width: 100, height: 39 }));
  const hidden = f.pageHeader.append(new Element(f.doc, "hidden-control", { width: 0, height: 0 }));
  for (const edge of [999, 500]) {
    f.move(edge); f.win.tick(0);
    assert.equal(custom.classList.contains("hover-expansion-toggle-pinned"), true);
    for (const el of [custom.children[0], strip, spacer, hidden]) assert.equal(el.classList.contains("hover-expansion-toggle-pinned"), false);
    for (let frame = 0; frame < 40; frame++) {
      f.win.tick(16);
      const ratio = f.rightEl.getBoundingClientRect().width / 240;
      const rect = custom.getBoundingClientRect();
      assert.ok(Math.abs(rect.left - (742 - 112 * ratio)) < 0.001);
      assert.ok(Math.abs(rect.width - (24 + 16 * ratio)) < 0.001, "a custom control's changing size also shares the easing");
    }
    assert.equal(custom.classList.contains("hover-expansion-toggle-pinned"), false);
    assert.equal(custom.style.margin, "0px 7px 0px 3px");
    assert.equal(f.doc.querySelectorAll(".hover-expansion-header-placeholder").length, 0);
  }
});

test("reversing right hover animation preserves adjacent controls' visible positions", () => {
  const f = fixture({ toggleFrames: true, headerControls: true, nativeAnimations: true, patch: { animationDuration: 640, animationStyle: "overshoot", closeDelay: 0 } });
  for (const edge of [999, 500, 999, 500]) {
    const before = f.tabList.getBoundingClientRect().left;
    f.move(edge); f.win.tick(0);
    assert.equal(f.tabList.getBoundingClientRect().left, before);
    assert.equal(f.doc.querySelectorAll(".hover-expansion-header-placeholder").length, 2);
    assert.equal(f.doc.querySelectorAll(".workspace-tab-header-tab-list").length, 2);
    f.win.tick(160);
  }
  f.win.tick(640);
  assert.equal(f.tabList.getBoundingClientRect().left, 832);
  assert.equal(f.doc.querySelectorAll(".hover-expansion-header-placeholder").length, 0);
});

test("header controls restore native layout for reduced motion, instant animation, and interruption", () => {
  for (const reducedMotion of [false, true]) {
    const f = fixture({ toggleFrames: true, headerControls: true, nativeAnimations: true, patch: { animationDuration: reducedMotion ? 640 : 0, closeDelay: 0 } });
    f.win.reducedMotion = reducedMotion;
    for (const [edge, left] of [[999, 720], [500, 832]]) {
      f.move(edge); f.win.tick(0);
      assert.equal(f.tabList.getBoundingClientRect().left, left);
      assert.equal(f.tabList.classList.contains("hover-expansion-toggle-pinned"), false);
      assert.equal(f.doc.querySelectorAll(".hover-expansion-header-placeholder").length, 0);
    }
  }
  for (const cancel of [
    f => f.doc.dispatch("pointerdown"), f => f.doc.dispatch("dragstart"),
    f => f.workspace.rightSplit.collapse(), f => f.win.dispatch("resize"), f => f.sidebar.unload()
  ]) {
    const f = fixture({ toggleFrames: true, headerControls: true, patch: { animationDuration: 640 } });
    f.move(999); f.win.tick(160); cancel(f);
    for (const el of [f.tabList, f.newTab]) {
      assert.equal(el.classList.contains("hover-expansion-toggle-pinned"), false);
      assert.equal(el.style.getPropertyValue("--hover-expansion-toggle-width"), "");
    }
    assert.equal(f.doc.querySelectorAll(".hover-expansion-header-placeholder").length, 0);
  }
});

test("settings changes apply to the next movement; manual actions and unload clear animations", () => {
  const f = fixture({ patch: { animationDuration: 640, animationStyle: "direct", closeDelay: 0 } });
  f.move(0); f.win.tick(160); f.workspace.leftSplit.collapse();
  assert.equal(f.leftEl.classList.contains("hover-expansion-animating"), false);
  f.settings.animationDuration = 320; f.settings.animationStyle = "smooth"; f.sidebar.refresh(true);
  f.move(0); f.win.tick(80); assert.ok(f.leftEl.getBoundingClientRect().width < 60);
  f.settings.leftSidebar = false; f.sidebar.refresh(true);
  assert.equal(f.leftEl.classList.contains("hover-expansion-animating"), false);
  assert.equal(f.leftEl.style.getPropertyValue("--hover-expansion-width"), "");
  f.move(999); f.win.tick(0); f.sidebar.unload(); f.tabs.unload();
  assert.equal(f.rightEl.classList.contains("hover-expansion-animating"), false);
  assert.equal(f.doc.head.children.length, 0); assert.equal(f.win.timers.size, 0);
});

test("clicking or starting a drag settles movement so native resizing stays usable", () => {
  for (const event of ["pointerdown", "dragstart"]) {
    const f = fixture({ patch: { animationDuration: 640, animationStyle: "direct" } });
    f.move(0); f.win.tick(160); assert.equal(f.leftEl.getBoundingClientRect().width, 60);
    f.doc.dispatch(event);
    assert.equal(f.leftEl.classList.contains("hover-expansion-animating"), false);
    f.workspace.leftSplit.element.style.width = "320px";
    f.win.tick(640); assert.equal(f.leftEl.getBoundingClientRect().width, 320);
  }
});

test("existing saved values are preserved and missing expansion delay uses the default", () => {
  const settings = loadSettings({ leftSidebar: true, rightSidebar: true, hoverTabs: true, tabDelay: 0, closeDelay: 200, edgeWidth: 40 });
  assert.equal(settings.tabDelay, 0); assert.equal(settings.closeDelay, 200); assert.equal(settings.edgeWidth, 40); assert.equal(settings.openDelay, 30);
});

test("sidebar expansion requires continuous edge hover on either side", () => {
  for (const [x, dockKey] of [[0, "leftSplit"], [999, "rightSplit"]]) {
    const f = fixture({ patch: { openDelay: 120 } }); f.move(x); f.win.tick(119);
    assert.equal(f.workspace[dockKey].collapsed, true);
    f.win.tick(1); assert.equal(f.workspace[dockKey].collapsed, false);
    assert.equal(f.workspace[dockKey].expansions, 1);
  }
});

test("moving inside the edge hover area does not restart its expansion delay", () => {
  const f = fixture({ patch: { openDelay: 100, edgeWidth: 100 } }); f.move(15); f.win.tick(60); f.move(60); f.win.tick(40);
  assert.equal(f.workspace.leftSplit.collapsed, false);
});

test("passing across a window edge cancels expansion and reentry starts a fresh delay", () => {
  const f = fixture({ patch: { openDelay: 100 } }); f.move(0); f.win.tick(60); f.move(500); f.win.tick(200);
  assert.equal(f.workspace.leftSplit.collapsed, true);
  f.move(0); f.win.tick(60); assert.equal(f.workspace.leftSplit.collapsed, true);
  f.win.tick(40); assert.equal(f.workspace.leftSplit.collapsed, false);
});

test("leaving the window, blur, pointer cancellation, clicks, and drags cancel pending expansion", () => {
  for (const action of [
    f => f.doc.dispatch("pointerout"), f => f.win.dispatch("blur"),
    f => f.doc.dispatch("pointercancel"), f => f.doc.dispatch("pointerdown"),
    f => f.doc.dispatch("dragstart")
  ]) {
    const f = fixture({ patch: { openDelay: 100 } }); f.move(0); f.win.tick(60); action(f); f.win.tick(200);
    assert.equal(f.workspace.leftSplit.collapsed, true);
  }
});

test("each edge has its own timer and crossing to the other side starts a new delay", () => {
  const f = fixture({ patch: { openDelay: 100 } }); f.move(0); f.win.tick(60); f.move(999); f.win.tick(60);
  assert.equal(f.workspace.leftSplit.collapsed, true); assert.equal(f.workspace.rightSplit.collapsed, true);
  f.win.tick(40); assert.equal(f.workspace.leftSplit.collapsed, true); assert.equal(f.workspace.rightSplit.collapsed, false);
});

test("layout events keep a pending dwell; settings changes and disabling cancel it", () => {
  const f = fixture({ patch: { openDelay: 100 } }); f.move(0); f.win.tick(60); f.workspace.dispatch("layout-change"); f.win.tick(40);
  assert.equal(f.workspace.leftSplit.collapsed, false);
  f.move(500); f.win.tick(180); f.move(0); f.win.tick(60); f.settings.openDelay = 500; f.sidebar.refresh(true); f.win.tick(100);
  assert.equal(f.workspace.leftSplit.collapsed, true);
  f.move(0); f.win.tick(300); f.settings.leftSidebar = false; f.sidebar.refresh(true); f.win.tick(300);
  assert.equal(f.workspace.leftSplit.collapsed, true);
});

test("menus appearing during dwell prevent expansion and unload clears pending timers", () => {
  const f = fixture({ patch: { openDelay: 100 } }); f.move(0); f.win.tick(60); f.doc.body.append(new Element(f.doc, "menu")); f.win.tick(100);
  assert.equal(f.workspace.leftSplit.collapsed, true);
  const g = fixture({ patch: { openDelay: 100 } }); g.move(0); g.sidebar.unload(); g.win.tick(200);
  assert.equal(g.workspace.leftSplit.collapsed, true); assert.equal(g.win.timers.size, 0);
});

test("larger edge areas work without overlapping in narrow windows", () => {
  const f = fixture({ patch: { edgeWidth: 300 } }); f.move(250); assert.equal(f.workspace.leftSplit.collapsed, false);
  const g = fixture({ patch: { edgeWidth: 300 } }); g.win.innerWidth = 400; g.move(200);
  assert.equal(g.workspace.leftSplit.collapsed, true); assert.equal(g.workspace.rightSplit.collapsed, true);
  g.move(350); assert.equal(g.workspace.rightSplit.collapsed, false); assert.equal(g.workspace.leftSplit.collapsed, true);
});

test("both edges reveal their own sidebar; body and left ribbon keep it open", () => {
  const f = fixture(); f.move(0); assert.equal(f.workspace.leftSplit.collapsed, false); assert.equal(f.workspace.rightSplit.collapsed, true);
  f.move(22, f.ribbon); f.win.tick(1000); assert.equal(f.workspace.leftSplit.collapsed, false);
  f.move(160, f.leftEl); f.win.tick(1000); assert.equal(f.workspace.leftSplit.collapsed, false);
  f.move(999); f.win.tick(180); assert.equal(f.workspace.leftSplit.collapsed, true); assert.equal(f.workspace.rightSplit.collapsed, false);
  f.move(820, f.rightEl); f.win.tick(1000); assert.equal(f.workspace.rightSplit.collapsed, false);
  f.move(500); f.win.tick(179); assert.equal(f.workspace.rightSplit.collapsed, false);
  f.win.tick(1); assert.equal(f.workspace.rightSplit.collapsed, true);
});

test("reentering an expanded body cancels folding", () => {
  const f = fixture(); f.move(0); f.move(500); f.win.tick(120); f.move(160, f.leftEl); f.win.tick(500);
  assert.equal(f.workspace.leftSplit.collapsed, false);
});

test("unused initially open sidebars fold; disabling one restores only that side", () => {
  const f = fixture({ left: false, right: false }); f.win.tick(180);
  assert.equal(f.workspace.leftSplit.collapsed, true); assert.equal(f.workspace.rightSplit.collapsed, true);
  f.settings.leftSidebar = false; f.sidebar.refresh();
  assert.equal(f.workspace.leftSplit.collapsed, false); f.move(0); f.win.tick(500); assert.equal(f.workspace.leftSplit.collapsed, false);
  f.move(999); assert.equal(f.workspace.rightSplit.collapsed, false);
});

test("right feature can be off while left remains on", () => {
  const f = fixture({ patch: { rightSidebar: false } }); f.move(999); assert.equal(f.workspace.rightSplit.collapsed, true);
  f.move(0); assert.equal(f.workspace.leftSplit.collapsed, false);
});

test("leaving the application and blur fold expanded panels", () => {
  for (const exit of [f => f.doc.dispatch("pointerout"), f => f.win.dispatch("blur")]) {
    const f = fixture(); f.move(0); exit(f); f.win.tick(180); assert.equal(f.workspace.leftSplit.collapsed, true);
  }
});

test("titlebar, touch, and ordinary mouse-button holds do not reveal a sidebar", () => {
  const f = fixture(); f.move(0, f.workspace.containerEl, 10); f.move(0, f.workspace.containerEl, 200, { pointerType: "touch" });
  f.move(0, f.workspace.containerEl, 200, { buttons: 1 }); assert.equal(f.workspace.leftSplit.collapsed, true);
});

test("menus pause folding; dragging keeps a panel open only while hovering inside", () => {
  const f = fixture(); f.move(0);
  const menu = f.doc.body.append(new Element(f.doc, "menu")); f.move(500, menu); f.win.tick(600);
  assert.equal(f.workspace.leftSplit.collapsed, false);
  f.doc.body.children = f.doc.body.children.filter(child => child !== menu); f.win.tick(400);
  assert.equal(f.workspace.leftSplit.collapsed, true);
  f.move(0); f.doc.dispatch("dragstart");
  f.doc.dispatch("dragover", { clientX: 160, clientY: 200, target: f.leftEl });
  f.win.tick(600); assert.equal(f.workspace.leftSplit.collapsed, false);
  f.doc.dispatch("dragover", { clientX: 500, clientY: 200, target: f.workspace.containerEl });
  f.win.tick(179); assert.equal(f.workspace.leftSplit.collapsed, false);
  f.win.tick(1); assert.equal(f.workspace.leftSplit.collapsed, true);
  f.doc.dispatch("dragend");
});

test("dragging a file from an open sidebar survives native pointer cancellation and pointerout", () => {
  for (const [edge, elementKey, dockKey] of [[0, "leftEl", "leftSplit"], [999, "rightEl", "rightSplit"]]) {
    const f = fixture(); const panel = f[elementKey], dock = f.workspace[dockKey];
    const file = panel.append(new Element(f.doc, "nav-file-title"));
    const x = edge === 0 ? 160 : 820;
    f.move(edge); f.move(x, file); f.doc.dispatch("pointerdown");
    f.doc.dispatch("dragstart", { clientX: x, clientY: 200, target: file });
    f.doc.dispatch("pointercancel"); f.doc.dispatch("pointerout");
    f.doc.dispatch("dragover", { clientX: x, clientY: 200, target: file, buttons: 1 });
    f.win.tick(2000); assert.equal(dock.collapsed, false);
    f.doc.dispatch("drop", { clientX: x, clientY: 200, target: file });
    f.doc.dispatch("dragend", { target: file });
    f.win.tick(1000); assert.equal(dock.collapsed, false);
    f.move(500); f.win.tick(180); assert.equal(dock.collapsed, true);
  }
});

test("internal and external file drags open either edge after continuous hover", () => {
  for (const internal of [false, true]) {
    for (const [edge, elementKey, dockKey] of [[0, "leftEl", "leftSplit"], [999, "rightEl", "rightSplit"]]) {
      const f = fixture({ patch: { openDelay: 120 } });
      if (internal) {
        f.move(500); f.doc.dispatch("pointerdown");
        f.doc.dispatch("dragstart", { clientX: 500, clientY: 200, target: f.workspace.containerEl });
        f.doc.dispatch("pointercancel");
      }
      f.doc.dispatch("dragenter", { clientX: edge, clientY: 200, target: f.workspace.containerEl });
      f.win.tick(60);
      f.doc.dispatch("dragover", { clientX: edge, clientY: 200, target: f.workspace.containerEl, buttons: 1 });
      f.win.tick(59); assert.equal(f.workspace[dockKey].collapsed, true);
      f.win.tick(1); assert.equal(f.workspace[dockKey].collapsed, false);
      const x = edge === 0 ? 160 : 820;
      f.doc.dispatch("dragover", { clientX: x, clientY: 200, target: f[elementKey] });
      f.win.tick(2000); assert.equal(f.workspace[dockKey].collapsed, false);
    }
  }
});

test("drag movement across children and the left ribbon does not fold an open sidebar", () => {
  const f = fixture(); f.move(0);
  const file = f.leftEl.append(new Element(f.doc, "nav-file-title"));
  const folder = f.leftEl.append(new Element(f.doc, "nav-folder-title"));
  f.doc.dispatch("dragstart", { clientX: 160, clientY: 200, target: file });
  f.doc.dispatch("dragenter", { clientX: 170, clientY: 200, target: folder });
  f.doc.dispatch("dragleave", { clientX: 170, clientY: 200, target: file, relatedTarget: folder });
  f.win.tick(1000); assert.equal(f.workspace.leftSplit.collapsed, false);
  f.doc.dispatch("dragleave", { clientX: 170, clientY: 200, target: folder, relatedTarget: null });
  f.win.tick(1000); assert.equal(f.workspace.leftSplit.collapsed, false);
  f.doc.dispatch("dragover", { clientX: 22, clientY: 200, target: f.ribbon });
  f.win.tick(1000); assert.equal(f.workspace.leftSplit.collapsed, false);
});

test("crossing edges during a drag cancels the first dwell and starts the other", () => {
  const f = fixture({ patch: { openDelay: 100 } });
  f.doc.dispatch("dragover", { clientX: 0, clientY: 200, target: f.workspace.containerEl });
  f.win.tick(60);
  f.doc.dispatch("dragover", { clientX: 999, clientY: 200, target: f.workspace.containerEl });
  f.win.tick(60); assert.equal(f.workspace.leftSplit.collapsed, true); assert.equal(f.workspace.rightSplit.collapsed, true);
  f.win.tick(40); assert.equal(f.workspace.leftSplit.collapsed, true); assert.equal(f.workspace.rightSplit.collapsed, false);
});

test("leaving the window during a drag cancels opening and resumes folding", () => {
  const f = fixture({ patch: { openDelay: 100 } });
  f.doc.dispatch("dragover", { clientX: 0, clientY: 200, target: f.workspace.containerEl }); f.win.tick(60);
  f.doc.dispatch("dragleave", { clientX: -1, clientY: 200, target: f.workspace.containerEl });
  f.win.tick(200); assert.equal(f.workspace.leftSplit.collapsed, true);
  f.doc.dispatch("dragover", { clientX: 0, clientY: 200, target: f.workspace.containerEl }); f.win.tick(100);
  assert.equal(f.workspace.leftSplit.collapsed, false);
  f.doc.dispatch("dragleave", { clientX: -1, clientY: 200, target: f.leftEl });
  f.win.tick(180); assert.equal(f.workspace.leftSplit.collapsed, true);
});

test("drop and drag cancellation clear pending opening without requiring pointerup", () => {
  for (const name of ["drop", "dragend"]) {
    const f = fixture({ patch: { openDelay: 100 } });
    f.doc.dispatch("pointerdown"); f.doc.dispatch("dragstart");
    f.doc.dispatch("dragover", { clientX: 0, clientY: 200, target: f.workspace.containerEl }); f.win.tick(60);
    f.doc.dispatch(name, { clientX: 0, clientY: 200, target: f.workspace.containerEl });
    f.win.tick(200); assert.equal(f.workspace.leftSplit.collapsed, true);
    f.move(0); f.win.tick(100); assert.equal(f.workspace.leftSplit.collapsed, false);
  }
});

test("hover resumes when an external drag ends outside the window", () => {
  const f = fixture();
  f.doc.dispatch("dragover", { clientX: 0, clientY: 200, target: f.workspace.containerEl });
  f.doc.dispatch("pointerout"); f.win.tick(1000); assert.equal(f.workspace.leftSplit.collapsed, false);
  f.move(500); f.win.tick(180); assert.equal(f.workspace.leftSplit.collapsed, true);
  f.move(999); assert.equal(f.workspace.rightSplit.collapsed, false);
});

test("dragging respects disabled sidebars and overlays and leaves native drop handling untouched", () => {
  const f = fixture({ patch: { leftSidebar: false } });
  f.doc.dispatch("dragover", { clientX: 0, clientY: 200, target: f.workspace.containerEl });
  assert.equal(f.workspace.leftSplit.collapsed, true);
  const menu = f.doc.body.append(new Element(f.doc, "menu"));
  f.doc.dispatch("dragover", { clientX: 999, clientY: 200, target: f.workspace.containerEl });
  assert.equal(f.workspace.rightSplit.collapsed, true); menu.remove();
  let intercepted = 0; const transfer = { types: ["Files"], dropEffect: "move" };
  for (const name of ["dragenter", "dragover", "dragleave", "drop"]) {
    const event = f.doc.dispatch(name, {
      clientX: 999, clientY: 200, target: f.rightEl, dataTransfer: transfer,
      preventDefault: () => intercepted++, stopPropagation: () => intercepted++
    });
    assert.equal(event.dataTransfer, transfer); assert.equal(transfer.dropEffect, "move");
  }
  assert.equal(intercepted, 0);
});

test("unload restores original states, removes listeners, and cancels folding", () => {
  const f = fixture({ left: false }); f.win.tick(180); f.move(999); f.move(500);
  f.sidebar.unload(); f.tabs.unload(); f.win.tick(1000);
  assert.equal(f.workspace.leftSplit.collapsed, false); assert.equal(f.workspace.rightSplit.collapsed, true);
  assert.equal(f.win.timers.size, 0); assert.equal(f.doc.listenerCount(), 0); assert.equal(f.win.listenerCount(), 0); assert.equal(f.workspace.listenerCount(), 0);
});

test("sidebar and page tab hover activate after the delay without requesting focus", () => {
  for (const index of [0, 1, 2]) {
    const f = fixture(); f.over(index); f.win.tick(79); assert.equal(f.workspace.activations.length, 0);
    f.win.tick(1); assert.equal(f.workspace.activations.length, 1); assert.equal(f.workspace.activations[0].leaf, f.leaves[index]);
    assert.equal(f.workspace.activations[0].params.focus, false);
  }
});

test("crossing a tab briefly does not select it; moving to another cancels the first", () => {
  const f = fixture(); f.over(0); f.win.tick(40); f.doc.dispatch("pointerout", { relatedTarget: f.headers[1] }); f.over(1); f.win.tick(80);
  assert.equal(f.workspace.activations.length, 1); assert.equal(f.workspace.activations[0].leaf, f.leaves[1]);
});

test("moving between a tab icon and title does not restart the timer", () => {
  const f = fixture(); const icon = f.headers[0].append(new Element(f.doc)); const title = f.headers[0].append(new Element(f.doc));
  f.over(0, { target: icon }); f.win.tick(40); f.doc.dispatch("pointerout", { relatedTarget: title }); f.over(0, { target: title }); f.win.tick(40);
  assert.equal(f.workspace.activations.length, 1);
});

test("close buttons, click-and-drag, touch, and overlays do not select tabs", () => {
  for (const kind of ["close", "buttons", "pressed", "drag", "touch", "modal", "menu"]) {
    const f = fixture(); const props = {};
    if (kind === "close") props.target = f.headers[0].append(new Element(f.doc, "workspace-tab-header-inner-close-button"));
    if (kind === "buttons") props.buttons = 1;
    if (kind === "pressed") f.doc.dispatch("pointerdown");
    if (kind === "drag") f.doc.dispatch("dragstart");
    if (kind === "touch") props.pointerType = "touch";
    if (kind === "modal") f.doc.body.append(new Element(f.doc, "modal-container"));
    if (kind === "menu") f.doc.body.append(new Element(f.doc, "menu"));
    f.over(0, props); f.win.tick(200); assert.equal(f.workspace.activations.length, 0, kind);
  }
});

test("tab toggle and zero delay apply immediately", () => {
  const f = fixture(); f.over(0); f.settings.hoverTabs = false; f.tabs.refresh(); f.win.tick(200); f.over(1); f.win.tick(200);
  assert.equal(f.workspace.activations.length, 0);
  f.settings.hoverTabs = true; f.settings.tabDelay = 0; f.over(2); assert.equal(f.workspace.activations.length, 1);
});

test("removed tabs and window blur cancel queued selection", () => {
  const f = fixture(); f.over(0); f.headers[0].isConnected = false; f.workspace.dispatch("layout-change"); f.win.tick(200);
  f.over(1); f.win.dispatch("blur"); f.win.tick(200); assert.equal(f.workspace.activations.length, 0);
});

test("popout tab selection works and closing that window removes its listeners", () => {
  const f = fixture(); const doc = new FakeDocument(); const header = doc.body.append(new Element(doc, "workspace-tab-header"));
  const leaf = { tabHeaderEl: header, view: { containerEl: header } }; f.leaves.push(leaf);
  // The real workspace emits two arguments rather than a DOM event.
  for (const callback of f.workspace.listeners.get("window-open")) callback({}, doc.defaultView);
  doc.dispatch("pointerover", { target: header }); doc.defaultView.tick(80);
  assert.equal(f.workspace.activations.at(-1).leaf, leaf);
  for (const callback of f.workspace.listeners.get("window-close")) callback({}, doc.defaultView);
  assert.equal(doc.listenerCount(), 0); assert.equal(doc.defaultView.listenerCount(), 0); assert.equal(doc.defaultView.timers.size, 0);
});

test("unloading before layout readiness prevents delayed initialization", async () => {
  const workspace = { onLayoutReady: callback => { workspace.ready = callback; } };
  const plugin = new HoverExpansionPlugin(); plugin.app = { workspace }; plugin.loaded = true;
  await plugin.onload(); plugin.unload(); workspace.ready(); assert.equal(plugin.children.length, 0);
});
