type Child = Node | string;

export interface ElementOptions {
  readonly className?: string;
  readonly text?: string;
  readonly attrs?: Readonly<Record<string, string>>;
}

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

export const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElementOptions = {},
  children: readonly Child[] = [],
): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);
  if (options.className !== undefined) element.className = options.className;
  if (options.text !== undefined) element.textContent = options.text;
  for (const [name, value] of Object.entries(options.attrs ?? {})) {
    element.setAttribute(name, value);
  }
  element.append(...children);
  return element;
};

export const svgEl = (
  tag: keyof SVGElementTagNameMap,
  attrs: Readonly<Record<string, string>>,
  children: readonly SVGElement[] = [],
): SVGElement => {
  const element = document.createElementNS(SVG_NAMESPACE, tag);
  for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, value);
  element.append(...children);
  return element;
};

export const isTextField = (target: EventTarget | null): boolean =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  (target instanceof HTMLElement && target.isContentEditable);

export const blurFocusedTextField = (owner: Document): void => {
  const focused = owner.activeElement;
  if (focused instanceof HTMLElement && isTextField(focused)) focused.blur();
};

/** Capture fails with NotFoundError when the pointer has already lifted; the stroke still works uncaptured. */
export const capturePointer = (element: Element, pointerId: number): void => {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    return;
  }
};

export const releasePointer = (element: Element, pointerId: number): void => {
  if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
};
