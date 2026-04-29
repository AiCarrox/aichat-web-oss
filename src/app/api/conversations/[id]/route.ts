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
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!conv) return NextResponse.json({ error: "不存在" }, { status: 404 });
  return NextResponse.json({ data: conv });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "未设置身份" }, { status: 400 });
  const { id } = await params;
  const body = (await req.json()) as {
    title?: string;
    chatModel?: string;
    imageModel?: string;
    archived?: boolean;
  };
  const conv = await prisma.conversation.updateMany({
    where: { id, userId },
    data: {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.chatModel !== undefined ? { chatModel: body.chatModel } : {}),
      ...(body.imageModel !== undefined ? { imageModel: body.imageModel } : {}),
      ...(body.archived !== undefined ? { archived: body.archived } : {}),
    },
  });
  return NextResponse.json({ data: { count: conv.count } });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "未设置身份" }, { status: 400 });
  const { id } = await params;
  await prisma.conversation.deleteMany({
    where: { id, userId },
  });
  return NextResponse.json({ ok: true });
}
