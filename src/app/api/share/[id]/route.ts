import { NextResponse } from "next/server";
import { getUserId } from "@/lib/identity";
import { prisma } from "@/lib/prisma";
import {
  revokeOwnerLink,
  revokeAndCleanGuest,
  createShareLink,
} from "@/lib/share";
import { readSelfConfig } from "@/lib/config";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

const log = logger.child({ module: "share[id]" });

/** DELETE /api/share/[id]
 * - guest: revoke + 立即清理(数据 + 文件)
 * - owner: revoke 旧的 + 自动签发新的(自身重置)
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "未设置身份" }, { status: 400 });
  const { id } = await params;

  const link = await prisma.shareLink.findUnique({ where: { id } });
  if (!link) return NextResponse.json({ error: "不存在" }, { status: 404 });
  if (link.ownerUserId !== userId) {
    return NextResponse.json({ error: "无权操作" }, { status: 403 });
  }

  if (link.kind === "guest") {
    await revokeAndCleanGuest(id);
    return NextResponse.json({ ok: true });
  }

  // owner: revoke + 重新生成
  await revokeOwnerLink(id);
  const self = await readSelfConfig();
  if (!self) return NextResponse.json({ ok: true, regenerated: null });
  const created = await createShareLink({
    kind: "owner",
    baseUrl: self.baseUrl,
    apiKey: self.apiKey,
    defaultChatModel: self.defaultChatModel ?? null,
    defaultImageModel: self.defaultImageModel ?? null,
    ownerUserId: userId,
  });
  log.info("share.owner.regenerate", { userId, oldId: id, newId: created.id });
  return NextResponse.json({ ok: true, regenerated: created.id });
}
