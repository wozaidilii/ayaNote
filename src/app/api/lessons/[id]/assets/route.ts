import { lookup } from "node:dns/promises";
import { NextRequest, NextResponse } from "next/server";
import { getAccessibleLesson } from "@/lib/classroom-access";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 4 * 1024 * 1024; // 4MB
const ALLOWED = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: lessonId } = await ctx.params;
  const access = await getAccessibleLesson(lessonId);
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  }

  const form = await req.formData();
  const sourceUrl = String(form.get("sourceUrl") ?? "").trim();
  const fileField = form.get("file");

  let buf: Buffer;
  let mimeType: string;
  let filename: string;

  if (sourceUrl) {
    const remote = await fetchPublicImage(sourceUrl);
    if (!remote) {
      return NextResponse.json({ error: "fetch_failed" }, { status: 422 });
    }
    buf = remote.buf;
    mimeType = remote.mimeType;
    filename = remote.filename;
  } else {
    if (!fileField || typeof fileField === "string") {
      return NextResponse.json({ error: "missing_file" }, { status: 400 });
    }
    const blob = fileField as File;
    mimeType = blob.type === "image/jpg" ? "image/jpeg" : blob.type;
    if (!ALLOWED.has(mimeType)) {
      return NextResponse.json({ error: "unsupported_type" }, { status: 415 });
    }
    buf = Buffer.from(await blob.arrayBuffer());
    filename = (blob.name || "image").slice(0, 120);
  }

  if (buf.length < 32 || buf.length > MAX_BYTES) {
    return NextResponse.json({ error: "invalid_size" }, { status: 413 });
  }

  const uploadedBy =
    access.role === "teacher"
      ? `teacher`
      : access.role === "student"
        ? `student`
        : `guest:${access.guestId ?? ""}`;

  const asset = await prisma.lessonAsset.create({
    data: {
      lessonId,
      mimeType,
      filename,
      byteSize: buf.length,
      data: Uint8Array.from(buf),
      uploadedBy,
    },
    select: { id: true },
  });

  return NextResponse.json({
    ok: true,
    id: asset.id,
    url: `/api/lessons/${lessonId}/assets/${asset.id}`,
  });
}

async function fetchPublicImage(
  sourceUrl: string,
): Promise<{ buf: Buffer; mimeType: string; filename: string } | null> {
  try {
    let url = await assertPublicHttpUrl(sourceUrl);
    for (let hop = 0; hop < 4; hop++) {
      const res = await fetch(url.toString(), {
        redirect: "manual",
        headers: { Accept: "image/*,*/*;q=0.8" },
        signal: AbortSignal.timeout(12000),
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return null;
        url = await assertPublicHttpUrl(new URL(loc, url).toString());
        continue;
      }
      if (!res.ok) return null;
      const headerMime = (res.headers.get("content-type") || "")
        .split(";")[0]
        .trim()
        .toLowerCase();
      const mimeType = headerMime === "image/jpg" ? "image/jpeg" : headerMime;
      const buf = Buffer.from(await res.arrayBuffer());
      const sniffed = sniffImageMime(buf);
      const resolved = ALLOWED.has(mimeType) ? mimeType : sniffed;
      if (!resolved || !ALLOWED.has(resolved)) return null;
      const name =
        url.pathname.split("/").filter(Boolean).at(-1) ||
        `image.${extFor(resolved)}`;
      return {
        buf,
        mimeType: resolved,
        filename: name.slice(0, 120),
      };
    }
    return null;
  } catch {
    return null;
  }
}

async function assertPublicHttpUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("protocol");
  }
  if (url.username || url.password) throw new Error("userinfo");
  if (isBlockedHost(url.hostname)) throw new Error("host");
  const { address } = await lookup(url.hostname);
  if (isBlockedHost(address)) throw new Error("ip");
  return url;
}

function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "metadata" ||
    host === "metadata.google.internal"
  ) {
    return true;
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return isPrivateIpv4(host);
  if (host.includes(":")) {
    const h = host.replace(/^\[/, "").replace(/\]$/, "");
    if (
      h === "::1" ||
      h === "::" ||
      h.startsWith("fe80:") ||
      h.startsWith("fc") ||
      h.startsWith("fd")
    ) {
      return true;
    }
    const v4 = h.match(/::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
    if (v4?.[1] && isPrivateIpv4(v4[1])) return true;
  }
  return false;
}

function isPrivateIpv4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = p;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function sniffImageMime(buf: Buffer): string | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8)
    return "image/jpeg";
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
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

function extFor(mime: string): string {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/gif") return "gif";
  if (mime === "image/webp") return "webp";
  return "png";
}
