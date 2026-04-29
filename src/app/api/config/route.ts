import { NextResponse } from "next/server";
import { getUserId, isValidUserId } from "@/lib/identity";
import {
  setSelfConfigCookie,
  clearConfigCookie,
  readSelfConfig,
  normalizeBaseUrl,
} from "@/lib/config";
import {
  findActiveOwnerLink,
  createShareLink,
  updateOwnerLinkDefaults,
} from "@/lib/share";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

const log = logger.child({ module: "config" });

export async function GET() {
  const self = await readSelfConfig();
  if (!self) return NextResponse.json({ hasSelf: false });
  return NextResponse.json({
    hasSelf: true,
    baseUrl: self.baseUrl,
    apiKeyMasked: self.apiKey.length > 10 ? `${self.apiKey.slice(0, 4)}...${self.apiKey.slice(-4)}` : "***",
    defaultChatModel: self.defaultChatModel ?? null,
    defaultImageModel: self.defaultImageModel ?? null,
  });
}

/**
 * PUT /api/config
 * 写入/更新自包含配置 cookie。支持两种调用形态:
 * 1) 全量保存:body 含 baseUrl + apiKey,可一并带模型;首次成功保存自动建 owner 永久链接。
 * 2) 仅模型保存:body 不带 baseUrl/apiKey,服务端必须已有 cfg_self,会复用旧 URL/Key,只改模型字段;
 *    同时把已有 owner ShareLink 的 defaultChatModel / defaultImageModel 同步更新(不重建链接)。
 * Body: { baseUrl?, apiKey?, defaultChatModel?, defaultImageModel? }
 */
export async function PUT(req: Request) {
  const userId = await getUserId();
  if (!userId || !isValidUserId(userId)) {
    return NextResponse.json({ error: "请先设置身份 ID" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    baseUrl?: string;
    apiKey?: string;
    defaultChatModel?: string | null;
    defaultImageModel?: string | null;
  };
  const baseUrlInput = (body.baseUrl ?? "").trim();
  const apiKeyInput = (body.apiKey ?? "").trim();
  const hasUrl = baseUrlInput.length > 0;
  const hasKey = apiKeyInput.length > 0;
  const partialUpdate = !hasUrl && !hasKey;

  // 仅模型更新 → 必须已有 cfg_self
  if (partialUpdate) {
    const existing = await readSelfConfig();
    if (!existing) {
      return NextResponse.json(
        { error: "尚未保存 URL+Key,请先完整保存一次" },
        { status: 400 },
      );
    }
    const defaultChatModel = body.defaultChatModel ?? null;
    const defaultImageModel = body.defaultImageModel ?? null;
    await setSelfConfigCookie({
      baseUrl: existing.baseUrl,
      apiKey: existing.apiKey,
      defaultChatModel,
      defaultImageModel,
    });
    await updateOwnerLinkDefaults(userId, { defaultChatModel, defaultImageModel });
    log.info("config.set.models_only", { userId, defaultChatModel, defaultImageModel });
    return NextResponse.json({ ok: true, partial: true });
  }

  // 全量保存 → URL+Key 都必填
  if (!hasUrl || !/^https?:\/\//i.test(baseUrlInput)) {
    return NextResponse.json({ error: "API URL 必须是 http(s):// 开头的合法地址" }, { status: 400 });
  }
  if (!hasKey) {
    return NextResponse.json({ error: "API Key 不能为空" }, { status: 400 });
  }

  const normalized = normalizeBaseUrl(baseUrlInput);
  const defaultChatModel = body.defaultChatModel ?? null;
  const defaultImageModel = body.defaultImageModel ?? null;
  await setSelfConfigCookie({
    baseUrl: normalized,
    apiKey: apiKeyInput,
    defaultChatModel,
    defaultImageModel,
  });
  log.info("config.set", { userId });

  // 首次配置自动创建 owner 永久 share link;已有则同步默认模型字段
  let ownerShare = await findActiveOwnerLink(userId);
  if (!ownerShare) {
    const created = await createShareLink({
      kind: "owner",
      baseUrl: normalized,
      apiKey: apiKeyInput,
      defaultChatModel,
      defaultImageModel,
      ownerUserId: userId,
    });
    ownerShare = await findActiveOwnerLink(userId);
    log.info("config.owner_share.auto_create", { userId, shareId: created.id });
  } else {
    await updateOwnerLinkDefaults(userId, { defaultChatModel, defaultImageModel });
  }

  return NextResponse.json({
    ok: true,
    ownerShareId: ownerShare?.id ?? null,
  });
}

export async function DELETE() {
  await clearConfigCookie();
  return NextResponse.json({ ok: true });
}
