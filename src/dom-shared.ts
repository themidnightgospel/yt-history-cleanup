const SVG_NS = "http://www.w3.org/2000/svg";
const TRASH_PATH_D =
  "M9 3v1H4v2h1v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6h1V4h-5V3H9zm0 5h2v10H9V8zm4 0h2v10h-2V8z";
const TOAST_LIFETIME_MS = 4000;

// YouTube's CSP enforces Trusted Types; setting `innerHTML` to a raw string
// throws. Build SVG nodes via DOM APIs instead. Several `d` strings become
// separate <path>s, each filled on its own.
export function makeSvgIcon(pathD: string | readonly string[], size = 24): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("aria-hidden", "true");
  for (const d of typeof pathD === "string" ? [pathD] : pathD) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  }
  return svg;
}

/**
 * An outlined icon in the line weight of YouTube's own masthead icons (the
 * bell, Create): each `d` is drawn as a stroke, not filled.
 */
export function makeStrokeIcon(pathDs: readonly string[], size = 24): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.75");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const d of pathDs) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  }
  return svg;
}

export function makeTrashIcon(size = 24): SVGSVGElement {
  return makeSvgIcon(TRASH_PATH_D, size);
}

export type ToastAction = { label: string; onClick: () => void };

/**
 * Shows a short-lived toast. With an `action`, the toast carries one
 * button; clicking it runs the action and removes the toast at once.
 */
export function showToast(
  message: string,
  action?: ToastAction,
  lifetimeMs: number = TOAST_LIFETIME_MS,
): void {
  const t = document.createElement("div");
  t.className = "ythc-toast";
  t.setAttribute("role", "status");
  const text = document.createElement("span");
  text.className = "ythc-toast-text";
  text.textContent = message;
  t.appendChild(text);
  const timer = setTimeout(() => t.remove(), lifetimeMs);
  if (action) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ythc-toast-action";
    btn.textContent = action.label;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      clearTimeout(timer);
      t.remove();
      action.onClick();
    });
    t.appendChild(btn);
  }
  document.body.appendChild(t);
}
