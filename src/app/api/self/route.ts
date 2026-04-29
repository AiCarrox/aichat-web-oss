import { NextResponse } from "next/server";
import { resolveConfig } from "@/lib/config";
import { getUserId, displayUserId, parseShareNamespace } from "@/lib/identity";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

const log = logger.child({ module: "self" });

export async function GET() {
  const userId = await getUserId();
  const cfg = await resolveConfig();

  if (!userId) {
    return NextResponse.json({
      userId: null,
      displayName: null,
      hasConfig: false,
      source: null,
      defaultChatModel: null,
      defaultImageModel: null,
      share: null,
    });
  }

  if (!cfg.ok) {
    log.info("self.no_config", { userId, reason: cfg.reason });
    return NextResponse.json({
      userId,
      displayName: displayUserId(userId),
      hasConfig: false,
      source: null,
      defaultChatModel: null,
      defaultImageModel: null,
      share: null,
      reason: cfg.reason,
    });
  }

  const ns = parseShareNamespace(userId);
  return NextResponse.json({
    userId,
    displayName: displayUserId(userId),
    hasConfig: true,
    source: cfg.config.source,
    defaultChatModel: cfg.config.defaultChatModel,
    defaultImageModel: cfg.config.defaultImageModel,
    share: cfg.config.share
      ? {
          id: cfg.config.share.id,
          kind: cfg.config.share.kind,
          expiresAt: cfg.config.share.expiresAt,
          isGuest: !!ns,
        }
      : null,
  });
}
