import { randomBytes } from "node:crypto";
import { rm, readdir } from "node:fs/promises";
import * as path from "node:path";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/crypto";
import { shareFileDirPrefix } from "@/lib/identity";
import { logger } from "@/lib/logger";

const log = logger.child({ module: "share" });

const PUBLIC_GENERATED_DIR = path.join(process.cwd(), "public", "generated");

function generateShareId(): string {
  return randomBytes(32).toString("base64url");
}

export interface CreateShareInput {
  kind: "owner" | "guest";
  baseUrl: string;
  apiKey: string;
  defaultChatModel?: string | null;
  defaultImageModel?: string | null;
  ownerUserId: string;
  /** guest 必填(小时),owner 不传 */
  expiresInHours?: number;
}

export async function createShareLink(input: CreateShareInput): Promise<{ id: string; expiresAt: Date | null }> {
  const id = generateShareId();
  const expiresAt =
    input.kind === "guest" && input.expiresInHours
      ? new Date(Date.now() + input.expiresInHours * 60 * 60 * 1000)
      : null;

  await prisma.shareLink.create({
    data: {
      id,
      kind: input.kind,
      encryptedUrl: encrypt(input.baseUrl),
      encryptedKey: encrypt(input.apiKey),
      defaultChatModel: input.defaultChatModel ?? null,
      defaultImageModel: input.defaultImageModel ?? null,
      ownerUserId: input.ownerUserId,
      expiresAt,
    },
  });
  log.info("share.create", { id, kind: input.kind, ownerUserId: input.ownerUserId, expiresAt });
  return { id, expiresAt };
}

/** 当前 user_id 是否已有 active(未撤销)owner link;有则返回它 */
export async function findActiveOwnerLink(ownerUserId: string) {
  return prisma.shareLink.findFirst({
    where: { ownerUserId, kind: "owner", revokedAt: null },
    orderBy: { createdAt: "desc" },
  });
}

/** 仅同步 owner ShareLink 的默认模型字段(模型变更不重建链接) */
export async function updateOwnerLinkDefaults(
  ownerUserId: string,
  defaults: { defaultChatModel: string | null; defaultImageModel: string | null },
): Promise<void> {
  const link = await findActiveOwnerLink(ownerUserId);
  if (!link) return;
  await prisma.shareLink.update({
    where: { id: link.id },
    data: {
      defaultChatModel: defaults.defaultChatModel,
      defaultImageModel: defaults.defaultImageModel,
    },
  });
  log.info("share.owner.update_defaults", {
    id: link.id,
    ownerUserId,
    defaultChatModel: defaults.defaultChatModel,
    defaultImageModel: defaults.defaultImageModel,
  });
}

export async function listGuestLinks(ownerUserId: string) {
  return prisma.shareLink.findMany({
    where: { ownerUserId, kind: "guest" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      expiresAt: true,
      revokedAt: true,
      cleanedAt: true,
      lastAccessedAt: true,
      accessCount: true,
    },
  });
}

export async function bumpAccess(id: string): Promise<void> {
  await prisma.shareLink
    .update({
      where: { id },
      data: { accessCount: { increment: 1 }, lastAccessedAt: new Date() },
    })
    .catch(() => {
      // best-effort
    });
}

export async function revokeOwnerLink(id: string): Promise<void> {
  await prisma.shareLink.update({
    where: { id },
    data: { revokedAt: new Date() },
  });
  log.info("share.owner.revoke", { id });
}

/** 撤销 guest link 并立即触发清理 */
export async function revokeAndCleanGuest(id: string): Promise<void> {
  await prisma.shareLink.update({
    where: { id },
    data: { revokedAt: new Date() },
  });
  await cleanupGuestLink(id);
  log.info("share.guest.revoke", { id });
}

/** 删该 guest share 命名空间下的所有 conversation/message + 落盘图片;幂等 */
export async function cleanupGuestLink(id: string): Promise<void> {
  const link = await prisma.shareLink.findUnique({ where: { id } });
  if (!link || link.kind !== "guest" || link.cleanedAt) return;

  const userIdPrefix = `s:${id}:`;
  // 1) 删 message + conversation(级联)
  const conversations = await prisma.conversation.findMany({
    where: { userId: { startsWith: userIdPrefix } },
    select: { id: true },
  });
  if (conversations.length > 0) {
    await prisma.message.deleteMany({
      where: { conversationId: { in: conversations.map((c) => c.id) } },
    });
    await prisma.conversation.deleteMany({
      where: { id: { in: conversations.map((c) => c.id) } },
    });
  }

  // 2) 删 public/generated/<safeUserSeg>/ 整组目录
  const dirPrefix = shareFileDirPrefix(id);
  try {
    const entries = await readdir(PUBLIC_GENERATED_DIR, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory() && e.name.startsWith(dirPrefix)) {
        await rm(path.join(PUBLIC_GENERATED_DIR, e.name), { recursive: true, force: true }).catch(
          (err) => log.warn("share.cleanup.rmdir_fail", { id, dir: e.name, err: String(err) }),
        );
      }
    }
  } catch (err) {
    log.warn("share.cleanup.readdir_fail", { id, err: String(err) });
  }

  await prisma.shareLink.update({
    where: { id },
    data: { cleanedAt: new Date() },
  });
  log.info("share.cleanup.ok", { id, conversationsRemoved: conversations.length });
}

/** 后台 sweep:扫所有过期且未清理的 guest links 并清掉 */
export async function sweepExpired(): Promise<number> {
  const now = new Date();
  const stale = await prisma.shareLink.findMany({
    where: {
      kind: "guest",
      cleanedAt: null,
      OR: [{ expiresAt: { lte: now } }, { revokedAt: { not: null } }],
    },
    select: { id: true },
  });
  for (const s of stale) {
    await cleanupGuestLink(s.id).catch((err) =>
      log.error("share.sweep.fail", { id: s.id, err: String(err) }),
    );
  }
  if (stale.length > 0) log.info("share.sweep.done", { count: stale.length });
  return stale.length;
}
