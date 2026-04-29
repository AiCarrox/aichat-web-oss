import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/identity";

export const runtime = "nodejs";

export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ data: [] });
  const list = await prisma.conversation.findMany({
    where: { userId, archived: false },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, updatedAt: true, chatModel: true, imageModel: true },
  });
  return NextResponse.json({ data: list });
}

export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "未设置身份" }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    chatModel?: string;
    imageModel?: string;
  };
  const conv = await prisma.conversation.create({
    data: {
      userId,
      title: body.title ?? "新对话",
      chatModel: body.chatModel ?? null,
      imageModel: body.imageModel ?? null,
    },
  });
  return NextResponse.json({ data: conv });
}
