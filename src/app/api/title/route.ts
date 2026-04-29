import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/identity";
import { resolveConfig } from "@/lib/config";

export const runtime = "nodejs";

/**
 * POST /api/title  { conversationId }
 * 让聊天模型根据前几条消息生成 <=20 字标题
 */
export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "未设置身份" }, { status: 400 });

  const { conversationId } = (await req.json()) as { conversationId: string };
  const conv = await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
    include: { messages: { orderBy: { createdAt: "asc" }, take: 4 } },
  });
  if (!conv) return NextResponse.json({ error: "不存在" }, { status: 404 });

  const cfg = await resolveConfig();
  if (!cfg.ok) return NextResponse.json({ data: { title: conv.title || "新对话" } });

  const model =
    conv.chatModel ||
    cfg.config.defaultChatModel ||
    process.env.DEFAULT_CHAT_MODEL ||
    "gpt-5.4";

  const excerpt = conv.messages
    .map((m) => `${m.role}: ${m.content.slice(0, 200)}`)
    .join("\n");

  const base = cfg.config.baseUrl.replace(/\/+$/, "");
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.config.apiKey}`,
    },
    body: JSON.stringify({
      model,
      stream: false,
      max_tokens: 60,
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content:
            "为一段对话生成一个不超过 20 个字的中文标题,只输出标题本身,不要引号,不要标点结尾。",
        },
        { role: "user", content: excerpt },
      ],
    }),
  });
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const raw = body.choices?.[0]?.message?.content?.trim() ?? "新对话";
  const title = raw.replace(/^["'「『]|["'」』]$/g, "").slice(0, 20) || "新对话";

  await prisma.conversation.update({
    where: { id: conv.id },
    data: { title },
  });

  return NextResponse.json({ data: { title } });
}
