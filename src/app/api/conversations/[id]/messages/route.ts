import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/identity";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "未设置身份" }, { status: 400 });
  const { id } = await params;
  const conv = await prisma.conversation.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (!conv) return NextResponse.json({ error: "不存在" }, { status: 404 });
  const msgs = await prisma.message.findMany({
    where: { conversationId: conv.id },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ data: msgs });
}
