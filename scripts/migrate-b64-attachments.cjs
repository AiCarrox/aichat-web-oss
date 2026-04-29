#!/usr/bin/env node
/**
 * 一次性迁移：扫描 Message.attachments 中 b64_json 字段，
 * 解码落盘到 public/generated/<safeUserSegment(uid)>/，重写为 url。
 *
 * 在容器内运行：docker exec aichat-web-oss node /app/scripts/migrate-b64-attachments.cjs
 */

const { PrismaClient } = require("@prisma/client");
const { mkdir, writeFile } = require("node:fs/promises");
const { randomBytes } = require("node:crypto");
const path = require("node:path");

const PUBLIC_GENERATED_DIR = path.join(process.cwd(), "public", "generated");

function safeUserSegment(uid) {
  return uid.replace(/[^a-zA-Z0-9_\-]/g, "_");
}

function extFromMime(mime) {
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpg";
  if (mime === "image/webp") return "webp";
  return "png";
}

async function main() {
  const prisma = new PrismaClient();
  const candidates = await prisma.$queryRawUnsafe(
    `SELECT m.id, m."conversationId", m.attachments::text AS att, c."userId"
     FROM "Message" m JOIN "Conversation" c ON c.id = m."conversationId"
     WHERE m.attachments::text LIKE '%b64_json%'`,
  );
  console.log(`[migrate] candidates=${candidates.length}`);

  let rewritten = 0;
  let imagesPersisted = 0;
  let bytesFreed = 0;

  for (const row of candidates) {
    const before = row.att.length;
    let attachments;
    try {
      attachments = JSON.parse(row.att);
    } catch (e) {
      console.warn(`[migrate] skip ${row.id} parse fail:`, e.message);
      continue;
    }
    if (!Array.isArray(attachments)) continue;

    let changed = false;
    for (const tr of attachments) {
      if (!tr || typeof tr !== "object") continue;
      const result = tr.result;
      if (!result || typeof result !== "object") continue;
      const imgs = result.images;
      if (!Array.isArray(imgs)) continue;
      const mime = typeof result.mime === "string" ? result.mime : "image/png";
      const ext = extFromMime(mime);
      for (const im of imgs) {
        if (!im || typeof im !== "object") continue;
        if (typeof im.b64_json !== "string" || im.b64_json.length === 0) continue;
        if (im.url) {
          // already has url, just clear b64
          im.b64_json = null;
          changed = true;
          continue;
        }
        const seg = safeUserSegment(row.userId);
        const dir = path.join(PUBLIC_GENERATED_DIR, seg);
        try {
          await mkdir(dir, { recursive: true });
          const name = `${Date.now()}_${randomBytes(4).toString("hex")}.${ext}`;
          const full = path.join(dir, name);
          const buf = Buffer.from(im.b64_json, "base64");
          await writeFile(full, buf);
          im.url = `/generated/${seg}/${name}`;
          im.b64_json = null;
          imagesPersisted += 1;
          changed = true;
          console.log(`[migrate] persisted msg=${row.id} bytes=${buf.length} url=${im.url}`);
        } catch (e) {
          console.warn(`[migrate] write fail msg=${row.id}:`, e.message);
        }
      }
    }

    if (changed) {
      await prisma.message.update({
        where: { id: row.id },
        data: { attachments },
      });
      const after = JSON.stringify(attachments).length;
      bytesFreed += before - after;
      rewritten += 1;
      console.log(`[migrate] rewrote msg=${row.id} ${before}B -> ${after}B`);
    }
  }

  console.log(
    `[migrate] done rows=${rewritten} images_persisted=${imagesPersisted} bytes_freed=${bytesFreed}`,
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("[migrate] fatal:", e);
  process.exit(1);
});
