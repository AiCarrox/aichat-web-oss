import { NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import * as path from "node:path";
import { getUserId, safeUserSegment } from "@/lib/identity";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

const log = logger.child({ module: "upload-image" });
const PUBLIC_GENERATED_DIR = path.join(process.cwd(), "public", "generated");
const MAX_BYTES = 12 * 1024 * 1024;

const DATA_URL_RE = /^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=]+)$/;

function extFromMime(mime: string): string {
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpg";
  if (mime === "image/webp") return "webp";
  return "png";
}

interface UploadBody {
  dataUrl?: string;
}

export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json({ error: "请先设置身份 ID" }, { status: 400 });
  }

  let body: UploadBody;
  try {
    body = (await req.json()) as UploadBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const dataUrl = body.dataUrl;
  if (typeof dataUrl !== "string" || dataUrl.length === 0) {
    return NextResponse.json({ error: "dataUrl 缺失" }, { status: 400 });
  }
  const m = dataUrl.match(DATA_URL_RE);
  if (!m) {
    return NextResponse.json({ error: "不支持的 data URL 格式" }, { status: 400 });
  }
  const mime = m[1];
  const b64 = m[2];
  const buf = Buffer.from(b64, "base64");
  if (buf.length === 0) {
    return NextResponse.json({ error: "空图片" }, { status: 400 });
  }
  if (buf.length > MAX_BYTES) {
    return NextResponse.json({ error: "图片过大" }, { status: 413 });
  }

  const seg = safeUserSegment(userId);
  const dir = path.join(PUBLIC_GENERATED_DIR, seg);
  const ext = extFromMime(mime);
  const name = `${Date.now()}_${randomBytes(4).toString("hex")}.${ext}`;
  const full = path.join(dir, name);
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(full, buf);
  } catch (e) {
    log.error("upload-image.persist_fail", { userId, error: e });
    return NextResponse.json({ error: "落盘失败" }, { status: 500 });
  }
  const url = `/generated/${seg}/${name}`;
  log.info("upload-image.ok", { userId, url, bytes: buf.length });
  return NextResponse.json({ url });
}
