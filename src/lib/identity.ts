import { cookies } from "next/headers";

const USER_ID_COOKIE = "user_id";
const ONE_YEAR = 60 * 60 * 24 * 365;

const SHARE_NAMESPACE_PREFIX = "s:";

export const USER_ID_MAX_LEN = 32;
export const USER_ID_MIN_LEN = 1;

const USER_ID_CHAR_RE = /^[\p{L}\p{N}_\-. ]+$/u;

export function isValidUserId(input: string): boolean {
  if (typeof input !== "string") return false;
  const trimmed = input.trim();
  if (trimmed.length < USER_ID_MIN_LEN) return false;
  if (trimmed.startsWith(SHARE_NAMESPACE_PREFIX)) {
    const ns = parseShareNamespace(trimmed);
    if (!ns) return false;
    if (ns.raw.length < USER_ID_MIN_LEN || ns.raw.length > USER_ID_MAX_LEN) return false;
    return USER_ID_CHAR_RE.test(ns.raw);
  }
  if (trimmed.length > USER_ID_MAX_LEN) return false;
  return USER_ID_CHAR_RE.test(trimmed);
}

export async function getUserId(): Promise<string | null> {
  const c = await cookies();
  const v = c.get(USER_ID_COOKIE)?.value;
  return v && v.length > 0 ? v : null;
}

export async function setUserIdCookie(uid: string, maxAgeSec: number = ONE_YEAR): Promise<void> {
  const c = await cookies();
  c.set(USER_ID_COOKIE, uid, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSec,
  });
}

export async function clearUserIdCookie(): Promise<void> {
  const c = await cookies();
  c.delete(USER_ID_COOKIE);
}

/** 给 guest share 接收方拼命名空间化 user_id */
export function shareNamespacedUserId(shareId: string, raw: string): string {
  return `${SHARE_NAMESPACE_PREFIX}${shareId}:${raw}`;
}

/** 解析 user_id,如果是 guest share namespace 返回 {shareId, raw};否则 null */
export function parseShareNamespace(uid: string): { shareId: string; raw: string } | null {
  if (!uid.startsWith(SHARE_NAMESPACE_PREFIX)) return null;
  const rest = uid.slice(SHARE_NAMESPACE_PREFIX.length);
  const idx = rest.indexOf(":");
  if (idx < 0) return null;
  return { shareId: rest.slice(0, idx), raw: rest.slice(idx + 1) };
}

/** 前端展示用名称(剥掉 share 命名空间前缀) */
export function displayUserId(uid: string): string {
  const ns = parseShareNamespace(uid);
  return ns ? ns.raw : uid;
}

/** 把 user_id 转成文件系统安全段(用于 public/generated/<seg>/) */
export function safeUserSegment(uid: string): string {
  return uid.replace(/[^a-zA-Z0-9_\-]/g, "_");
}

/** 给定 shareId,返回 fs 子目录前缀(用于过期清理) */
export function shareFileDirPrefix(shareId: string): string {
  return safeUserSegment(`${SHARE_NAMESPACE_PREFIX}${shareId}:`);
}
