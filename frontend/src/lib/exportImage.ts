/**
 * Exports a log-sheet <svg> to a PNG.
 *
 * The sheet paints entirely through CSS custom properties, and those resolve
 * against the document. Once the markup is serialised into a standalone blob
 * that link is gone, so the resolved values are copied onto the cloned root
 * first - otherwise every fill comes out transparent.
 */

const INHERITED_VARS = [
  "--log-paper",
  "--log-panel",
  "--log-ink",
  "--log-rule",
  "--log-grid",
  "--log-accent",
  "--duty-off",
  "--duty-sb",
  "--duty-drive",
  "--duty-on",
  "--font-sans",
  "--font-mono",
];

export async function svgToPngBlob(svg: SVGSVGElement, scale = 2): Promise<Blob> {
  const root = getComputedStyle(document.documentElement);
  const clone = svg.cloneNode(true) as SVGSVGElement;

  for (const name of INHERITED_VARS) {
    const value = root.getPropertyValue(name).trim();
    if (value) clone.style.setProperty(name, value);
  }

  // The viewBox is the source of truth for the sheet's size; the literals are
  // only a last resort if it is somehow missing.
  const viewBox = (svg.getAttribute("viewBox") ?? "")
    .split(/\s+/)
    .map(Number);
  const width = viewBox[2] || svg.clientWidth || 1120;
  const height = viewBox[3] || svg.clientHeight || 678;

  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));

  const source = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(
    new Blob([source], { type: "image/svg+xml;charset=utf-8" })
  );

  try {
    const image = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is unavailable in this browser.");

    ctx.fillStyle = root.getPropertyValue("--log-paper").trim() || "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error("Could not encode the image.")),
        "image/png"
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not render the log sheet."));
    image.src = url;
  });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoke on the next tick so the download has started.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
