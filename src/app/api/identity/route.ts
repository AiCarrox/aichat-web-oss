import { NextResponse } from "next/server";
import { setUserIdCookie, clearUserIdCookie, isValidUserId } from "@/lib/identity";
import { findActiveOwnerLink } from "@/lib/share";
import { setSelfConfigCookie } from "@/lib/config";
import { decrypt } from "@/lib/crypto";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

const log = logger.child({ module: "identity" });

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { userId?: string };
  const raw = (body.userId ?? "").trim();
  if (!isValidUserId(raw)) {
    return NextResponse.json(
      { error: "ID 必须是 1-32 个字母/数字/下划线/连字符/点号/空格" },
      { status: 400 },
    );
  }
  await setUserIdCookie(raw);
  log.info("identity.set", { userId: raw });

  // 跨设备同步:若该 ID 已有 active owner 永久链接,则把该 owner 当前的 URL/Key/默认模型
  // 解密写入新浏览器的 cfg_self,等价于打开 owner 永久链接。
  // 安全语义:此时 ID 即身份认证密钥(无密码),与 oss 版"输入相同 ID 即同一空间"的设计一致。
  let adoptedConfig = false;
  try {
    const owner = await findActiveOwnerLink(raw);
    if (owner) {
      await setSelfConfigCookie({
        baseUrl: decrypt(owner.encryptedUrl),
        apiKey: decrypt(owner.encryptedKey),
        defaultChatModel: owner.defaultChatModel,
        defaultImageModel: owner.defaultImageModel,
      });
      adoptedConfig = true;
      log.info("identity.config.adopted", { userId: raw, shareId: owner.id });
    }
  } catch (e) {
    log.warn("identity.config.adopt_failed", { userId: raw, error: String(e) });
  }

  return NextResponse.json({ ok: true, userId: raw, adoptedConfig });
}

export async function DELETE() {
  await clearUserIdCookie();
  return NextResponse.json({ ok: true });
}
