import { NextResponse } from "next/server";
import { resolveConfig } from "@/lib/config";
import { listModels } from "@/lib/newapi";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const revalidate = 60;

const log = logger.child({ module: "models" });

export async function GET() {
  const cfg = await resolveConfig();
  if (!cfg.ok) {
    return NextResponse.json(
      { needsConfig: true, data: [], defaults: { chat: "", image: "" } },
      { status: 200 },
    );
  }

  const defaults = {
    chat: cfg.config.defaultChatModel ?? process.env.DEFAULT_CHAT_MODEL ?? "gpt-5.4",
    image: cfg.config.defaultImageModel ?? process.env.DEFAULT_IMAGE_MODEL ?? "gpt-image-2",
  };

  try {
    const list = await listModels(cfg.config.baseUrl, cfg.config.apiKey);
    return NextResponse.json({ data: list, defaults });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    log.error("models.fail", { error: e });
    return NextResponse.json({ error: msg, data: [], defaults }, { status: 502 });
  }
}
