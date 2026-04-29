import { NextResponse } from "next/server";
import { getUserId } from "@/lib/identity";
import { readSelfConfig } from "@/lib/config";
import {
  createShareLink,
  findActiveOwnerLink,
  listGuestLinks,
} from "@/lib/share";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

const log = logger.child({ module: "share" });

/** GET /api/share - 列出当前用户的所有 share(owner + guest) */
export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ owner: null, guests: [] });
  const self = await readSelfConfig();
  if (!self) return NextResponse.json({ owner: null, guests: [] });

  const owner = await findActiveOwnerLink(userId);
  const guests = await listGuestLinks(userId);
  return NextResponse.json({
    owner: owner
      ? {
          id: owner.id,
          createdAt: owner.createdAt,
          lastAccessedAt: owner.lastAccessedAt,
          accessCount: owner.accessCount,
        }
      : null,
    guests,
  });
}

/**
 * POST /api/share  { kind: "guest", expiresInHours }
 * 仅自包含配置(创建者)可用。
 */
export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "请先设置身份 ID" }, { status: 400 });
  const self = await readSelfConfig();
  if (!self) {
    return NextResponse.json(
      { error: "只有配置了 URL+Key 的创建者才能签发分享链接" },
      { status: 400 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    expiresInHours?: number;
  };
  const hours = Number(body.expiresInHours);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24 * 365) {
    return NextResponse.json({ error: "有效期必须是 1-8760 之间的小时数" }, { status: 400 });
  }

  const created = await createShareLink({
    kind: "guest",
    baseUrl: self.baseUrl,
    apiKey: self.apiKey,
    defaultChatModel: self.defaultChatModel ?? null,
    defaultImageModel: self.defaultImageModel ?? null,
    ownerUserId: userId,
    expiresInHours: hours,
  });
  log.info("share.guest.create", { userId, shareId: created.id, hours });
  return NextResponse.json({ ok: true, id: created.id, expiresAt: created.expiresAt });
}
