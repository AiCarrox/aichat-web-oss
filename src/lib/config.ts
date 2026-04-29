import { cookies } from "next/headers";
import { encrypt, decrypt } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";

const CONFIG_COOKIE = "config_enc";
const ONE_YEAR = 60 * 60 * 24 * 365;

export interface SelfConfigPayload {
  kind: "self";
  baseUrl: string;
  apiKey: string;
  defaultChatModel?: string | null;
  defaultImageModel?: string | null;
}

export interface ShareRefPayload {
  kind: "share";
  shareId: string;
}

export type ConfigCookiePayload = SelfConfigPayload | ShareRefPayload;

/** 从 cookie 读出原始 payload(自包含 / 引用式),不做 share 校验 */
export async function readRawConfigPayload(): Promise<ConfigCookiePayload | null> {
  const c = await cookies();
  const enc = c.get(CONFIG_COOKIE)?.value;
  if (!enc) return null;
  try {
    const json = decrypt(enc);
    const parsed = JSON.parse(json) as ConfigCookiePayload;
    if (parsed.kind === "self" || parsed.kind === "share") return parsed;
    return null;
  } catch {
    return null;
  }
}

export interface ResolvedConfig {
  source: "self" | "share";
  baseUrl: string;
  apiKey: string;
  defaultChatModel: string | null;
  defaultImageModel: string | null;
  /** 引用式时携带 share 元数据,自包含时为 null */
  share: {
    id: string;
    kind: "owner" | "guest";
    expiresAt: Date | null;
    ownerUserId: string;
  } | null;
}

export type ResolveError =
  | "no-config"
  | "share-not-found"
  | "share-expired"
  | "share-revoked"
  | "share-cleaned";

export interface ResolveFailure {
  ok: false;
  reason: ResolveError;
}

export interface ResolveOk {
  ok: true;
  config: ResolvedConfig;
}

/** 解析当前 cookie 配置,引用式 share 会查 DB 校验有效期/撤销/已清理 */
export async function resolveConfig(): Promise<ResolveOk | ResolveFailure> {
  const raw = await readRawConfigPayload();
  if (!raw) return { ok: false, reason: "no-config" };

  if (raw.kind === "self") {
    return {
      ok: true,
      config: {
        source: "self",
        baseUrl: raw.baseUrl,
        apiKey: raw.apiKey,
        defaultChatModel: raw.defaultChatModel ?? null,
        defaultImageModel: raw.defaultImageModel ?? null,
        share: null,
      },
    };
  }

  const link = await prisma.shareLink.findUnique({ where: { id: raw.shareId } });
  if (!link) return { ok: false, reason: "share-not-found" };
  if (link.revokedAt) return { ok: false, reason: "share-revoked" };
  if (link.cleanedAt) return { ok: false, reason: "share-cleaned" };
  if (link.expiresAt && link.expiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: "share-expired" };
  }

  const baseUrl = decrypt(link.encryptedUrl);
  const apiKey = decrypt(link.encryptedKey);

  return {
    ok: true,
    config: {
      source: "share",
      baseUrl,
      apiKey,
      defaultChatModel: link.defaultChatModel,
      defaultImageModel: link.defaultImageModel,
      share: {
        id: link.id,
        kind: link.kind as "owner" | "guest",
        expiresAt: link.expiresAt,
        ownerUserId: link.ownerUserId,
      },
    },
  };
}

export async function setSelfConfigCookie(payload: Omit<SelfConfigPayload, "kind">): Promise<void> {
  const enc = encrypt(JSON.stringify({ kind: "self", ...payload } satisfies SelfConfigPayload));
  const c = await cookies();
  c.set(CONFIG_COOKIE, enc, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ONE_YEAR,
  });
}

export async function setShareRefCookie(shareId: string, maxAgeSec: number): Promise<void> {
  const enc = encrypt(JSON.stringify({ kind: "share", shareId } satisfies ShareRefPayload));
  const c = await cookies();
  c.set(CONFIG_COOKIE, enc, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSec,
  });
}

export async function clearConfigCookie(): Promise<void> {
  const c = await cookies();
  c.delete(CONFIG_COOKIE);
}

/** 仅自包含 cookie 才允许创建/管理分享。返回 SelfConfigPayload 或 null */
export async function readSelfConfig(): Promise<SelfConfigPayload | null> {
  const raw = await readRawConfigPayload();
  if (!raw || raw.kind !== "self") return null;
  return raw;
}

export function normalizeBaseUrl(input: string): string {
  return input.trim().replace(/\/+$/, "");
}
