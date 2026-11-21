type Options = { cls?: string; text?: string; attr?: Record<string, string> };
function create(parent: HTMLElement, tag: string, options?: Options) {
  const el = document.createElement(tag);
  if (options?.cls) el.className = options.cls;
  if (options?.text) el.textContent = options.text;
  for (const [key, value] of Object.entries(options?.attr ?? {})) el.setAttribute(key, value);
  parent.append(el);
  return el;
}
Object.assign(HTMLElement.prototype, {
  createEl(this: HTMLElement, tag: string, options?: Options) { return create(this, tag, options); },
  createDiv(this: HTMLElement, options?: Options) { return create(this, "div", options); },
  createSpan(this: HTMLElement, options?: Options) { return create(this, "span", options); },
});
export const Platform = { isMobile: true };
export const setIcon = (el: HTMLElement) => { el.textContent = "◇"; };
export class TFile {
  stat: { size: number; mtime: number };
  basename: string;
  extension: string;
  constructor(public path: string, size: number) {
    this.extension = path.split(".").at(-1)!;
    this.basename = path.split("/").at(-1)!.replace(/\.[^.]+$/, "");
    this.stat = { size, mtime: Date.now() };
  }
}
