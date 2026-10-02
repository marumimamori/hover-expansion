// Avoid instanceof Element: tabs may belong to a different popout window.
export function asElement(target: EventTarget | null): Element | null {
  return target && (target as Node).nodeType === 1 ? target as Element : null;
}

export function hasOverlay(doc: Document): boolean {
  return !!doc.querySelector(".modal-container, .menu, .suggestion-container");
}

export function containsPoint(element: HTMLElement, x: number, y: number): boolean {
  if (!element.isConnected) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 &&
    x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}
