import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/identity";

export const runtime = "nodejs";

async function loadOwnedMessage(messageId: string, userId: string) {
  return prisma.message.findFirst({
    where: { id: messageId, conversation: { userId } },
    select: { id: true, conversationId: true, createdAt: true, role: true },
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "未设置身份" }, { status: 400 });
  const { id } = await params;
  const body = (await req.json()) as { content?: string };
  if (typeof body.content !== "string") {
    return NextResponse.json({ error: "content 必须是字符串" }, { status: 400 });
  }
  const owned = await loadOwnedMessage(id, userId);
  if (!owned) return NextResponse.json({ error: "不存在" }, { status: 404 });
  await prisma.message.update({
    where: { id },
    data: { content: body.content },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "未设置身份" }, { status: 400 });
  const { id } = await params;
  const url = new URL(req.url);
  const cascade = url.searchParams.get("cascade");
  const owned = await loadOwnedMessage(id, userId);
  if (!owned) return NextResponse.json({ error: "不存在" }, { status: 404 });

  if (cascade === "after") {
    await prisma.message.deleteMany({
      where: {
        conversationId: owned.conversationId,
        createdAt: { gte: owned.createdAt },
      },
    });
  } else if (cascade === "descendants") {
    await prisma.message.deleteMany({
      where: {
        conversationId: owned.conversationId,
        createdAt: { gt: owned.createdAt },
      },
    });
  } else {
    await prisma.message.delete({ where: { id } });
  }
  return NextResponse.json({ ok: true });
}
