const SVG_NS = "http://www.w3.org/2000/svg";
const TRASH_PATH_D =
  "M9 3v1H4v2h1v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6h1V4h-5V3H9zm0 5h2v10H9V8zm4 0h2v10h-2V8z";
const TOAST_LIFETIME_MS = 4000;

// YouTube's CSP enforces Trusted Types; setting `innerHTML` to a raw string
// throws. Build SVG nodes via DOM APIs instead.
export function makeTrashIcon(size = 24): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", TRASH_PATH_D);
  svg.appendChild(path);
  return svg;
}

export function showToast(message: string): void {
  const t = document.createElement("div");
  t.className = "ythc-toast";
  t.textContent = message;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), TOAST_LIFETIME_MS);
}
