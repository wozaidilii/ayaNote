/** Client-only helpers for paste/drop images (Finder, browser, Sheets, Excel). */

export type ClipboardImage =
  { kind: "file"; file: File } | { kind: "url"; url: string };

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|tiff?)$/i;
const PASTE_IMAGE_MAX_EDGE = 1600;

export function dataTransferLooksLikeImage(
  data: DataTransfer | null | undefined,
): boolean {
  if (!data) return false;
  const types = Array.from(data.types ?? []);
  if (types.some((t) => t.startsWith("image/"))) return true;
  if (Array.from(data.files ?? []).some(isUsableImageFile)) return true;
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === "file" && item.type.startsWith("image/")) return true;
  }
  if (types.includes("text/html")) {
    const html = data.getData("text/html");
    if (
      /<img\b/i.test(html) &&
      /(?:src|data-src)\s*=\s*["']?(?:data:image|https?:|\/\/)/i.test(html)
    ) {
      return true;
    }
  }
  if (types.includes("text/uri-list")) {
    const uris = data.getData("text/uri-list");
    if (uris.split(/\r?\n/).some((line) => looksLikeImageUrl(line.trim()))) {
      return true;
    }
  }
  return false;
}

export async function collectImagesFromDataTransfer(
  data: DataTransfer | null | undefined,
): Promise<ClipboardImage[]> {
  if (!data) return [];

  // Read file items synchronously before any await — clipboard files expire.
  const files: File[] = [];
  for (const file of Array.from(data.files ?? [])) {
    if (isUsableImageFile(file)) files.push(file);
  }
  if (files.length === 0) {
    for (const item of Array.from(data.items ?? [])) {
      if (item.kind !== "file") continue;
      const file = item.getAsFile();
      if (file && isUsableImageFile(file)) files.push(file);
    }
  }

  const urls: string[] = [];
  if (files.length === 0) {
    const html = safeGetData(data, "text/html");
    for (const src of imgSrcsFromHtml(html)) {
      if (src.startsWith("data:image/")) {
        const file = await fileFromDataUrl(src);
        if (file) files.push(file);
      } else if (src.startsWith("//")) {
        urls.push(`https:${src}`);
      } else if (/^https?:\/\//i.test(src)) {
        urls.push(src);
      }
    }
  }

  if (files.length === 0 && urls.length === 0) {
    const uris = safeGetData(data, "text/uri-list");
    for (const line of uris.split(/\r?\n/)) {
      const src = line.trim();
      if (!src || src.startsWith("#")) continue;
      if (looksLikeImageUrl(src) || isHostedSheetImage(src)) urls.push(src);
    }
  }

  const out: ClipboardImage[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const normalized = await normalizeImageFile(file);
    if (!normalized) continue;
    const key = `f:${normalized.size}:${normalized.name}:${normalized.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: "file", file: normalized });
  }
  for (const url of urls) {
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ kind: "url", url });
  }
  return out;
}

function safeGetData(data: DataTransfer, type: string): string {
  try {
    return data.getData(type) || "";
  } catch {
    return "";
  }
}

function isUsableImageFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  return IMAGE_EXT.test(file.name || "");
}

function looksLikeImageUrl(src: string): boolean {
  if (!/^https?:\/\//i.test(src)) return false;
  try {
    const path = new URL(src).pathname;
    return IMAGE_EXT.test(path);
  } catch {
    return false;
  }
}

function isHostedSheetImage(src: string): boolean {
  if (!/^https?:\/\//i.test(src)) return false;
  return /googleusercontent\.com|ggpht\.com|google\.com\/chart|onedrive\.live\.com|sharepoint\.com|livefilestore\.com/i.test(
    src,
  );
}

function imgSrcsFromHtml(html: string): string[] {
  if (!html.trim()) return [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  const srcs: string[] = [];
  for (const img of Array.from(doc.querySelectorAll("img"))) {
    const src =
      img.getAttribute("src") ||
      img.getAttribute("data-src") ||
      img.getAttribute("data-image-src") ||
      "";
    if (src) srcs.push(src.trim());
  }
  return srcs;
}

async function fileFromDataUrl(src: string): Promise<File | null> {
  try {
    const res = await fetch(src);
    const blob = await res.blob();
    if (!blob.type.startsWith("image/") || blob.size < 32) return null;
    const ext = extForMime(blob.type);
    return new File([blob], `paste.${ext}`, { type: blob.type });
  } catch {
    return null;
  }
}

function extForMime(mime: string): string {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/gif") return "gif";
  if (mime === "image/webp") return "webp";
  return "png";
}

/** Rasterize TIFF/BMP/SVG and cap huge screenshots before upload. */
export async function normalizeImageFile(file: File): Promise<File | null> {
  const sniffed = file.type || (await sniffImageMime(file)) || "";
  const mime = sniffed === "image/jpg" ? "image/jpeg" : sniffed;
  const needsRaster =
    mime === "image/tiff" ||
    mime === "image/tif" ||
    mime === "image/bmp" ||
    mime === "image/x-ms-bmp" ||
    mime === "image/svg+xml" ||
    mime === "image/svg";
  if (mime === "image/gif" && !needsRaster) return file;

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    bitmap = await bitmapFromObjectUrl(file);
  }
  if (!bitmap) {
    if (
      mime === "image/png" ||
      mime === "image/jpeg" ||
      mime === "image/webp" ||
      mime === "image/gif"
    ) {
      return file;
    }
    return null;
  }

  const scale = Math.min(
    1,
    PASTE_IMAGE_MAX_EDGE / Math.max(bitmap.width, bitmap.height),
  );
  const alreadyOk =
    !needsRaster &&
    scale >= 1 &&
    file.size <= 1.2 * 1024 * 1024 &&
    (mime === "image/png" || mime === "image/jpeg" || mime === "image/webp");
  if (alreadyOk) {
    bitmap.close();
    return file;
  }

  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return file;
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const outMime =
    mime === "image/png" || needsRaster ? "image/png" : "image/jpeg";
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, outMime, 0.86),
  );
  if (!blob || blob.size === 0) return file;
  const ext = extForMime(outMime);
  const base = (file.name || "image").replace(/\.[^.]+$/, "") || "image";
  return new File([blob], `${base}.${ext}`, { type: outMime });
}

async function sniffImageMime(file: File): Promise<string | null> {
  const buf = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e
  ) {
    return "image/png";
  }
  if (
    buf.length >= 3 &&
    buf[0] === 0xff &&
    buf[1] === 0xd8 &&
    buf[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    buf.length >= 6 &&
    buf[0] === 0x47 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46
  ) {
    return "image/gif";
  }
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return "image/webp";
  }
  if (
    buf.length >= 4 &&
    buf[0] === 0x49 &&
    buf[1] === 0x49 &&
    buf[2] === 0x2a &&
    buf[3] === 0x00
  ) {
    return "image/tiff";
  }
  if (
    buf.length >= 4 &&
    buf[0] === 0x4d &&
    buf[1] === 0x4d &&
    buf[2] === 0x00 &&
    buf[3] === 0x2a
  ) {
    return "image/tiff";
  }
  if (buf.length >= 2 && buf[0] === 0x42 && buf[1] === 0x4d) return "image/bmp";
  return null;
}

async function bitmapFromObjectUrl(file: File): Promise<ImageBitmap | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = document.createElement("img");
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("decode"));
      el.src = url;
    });
    return await createImageBitmap(img);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
