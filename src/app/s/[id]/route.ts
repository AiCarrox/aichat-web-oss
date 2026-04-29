import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { setShareRefCookie } from "@/lib/config";
import {
  setUserIdCookie,
  shareNamespacedUserId,
  parseShareNamespace,
  getUserId,
} from "@/lib/identity";
import { bumpAccess } from "@/lib/share";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = logger.child({ module: "s[id]" });

const ONE_YEAR_SEC = 60 * 60 * 24 * 365;

/**
 * GET /s/<id>
 * - link.kind == "owner": 直接 set cookie(自动登录到 ownerUserId)→ 跳 /
 * - link.kind == "guest": 跳 /s/<id>/enter 让访客先填 id
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const link = await prisma.shareLink.findUnique({ where: { id } });
  if (!link) {
    return new NextResponse("Share link not found", { status: 404 });
  }
  if (link.revokedAt) {
    return new NextResponse("此分享链接已被撤销", { status: 410 });
  }
  if (link.cleanedAt) {
    return new NextResponse("此分享链接已过期清理", { status: 410 });
  }
  if (link.expiresAt && link.expiresAt.getTime() <= Date.now()) {
    return new NextResponse("此分享链接已过期", { status: 410 });
  }

  await bumpAccess(id);

  if (link.kind === "owner") {
    await setShareRefCookie(id, ONE_YEAR_SEC);
    await setUserIdCookie(link.ownerUserId, ONE_YEAR_SEC);
    log.info("s.owner.consume", { id, ownerUserId: link.ownerUserId });
    redirect("/");
  }

  // guest: 设引用式 cookie(不设 user_id),跳引导页
  const ttl = link.expiresAt
    ? Math.max(60, Math.floor((link.expiresAt.getTime() - Date.now()) / 1000))
    : ONE_YEAR_SEC;
  await setShareRefCookie(id, ttl);

  // 如果用户原先就有 namespaced user_id 且 shareId 匹配,无需再让填
  const existing = await getUserId();
  if (existing) {
    const ns = parseShareNamespace(existing);
    if (ns && ns.shareId === id) {
      log.info("s.guest.consume.repeat", { id, userId: existing });
      redirect("/");
    }
  }

  log.info("s.guest.consume.new", { id });
  redirect(`/s/${id}/enter`);
}
