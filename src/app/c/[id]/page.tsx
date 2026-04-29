import { notFound } from "next/navigation";
import { Sidebar } from "@/components/chat/sidebar";
import { ChatView } from "@/components/chat/chat-view";
import { IdentityGate } from "@/components/identity-gate";
import { prisma } from "@/lib/prisma";
import { getUserId, displayUserId } from "@/lib/identity";
import { resolveConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export default async function Conversation({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const userId = await getUserId();
  if (!userId) return <IdentityGate />;

  const { id } = await params;
  const conv = await prisma.conversation.findFirst({
    where: { id, userId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!conv) notFound();

  const cfg = await resolveConfig();
  const hasConfig = cfg.ok;

  return (
    <div className="flex h-dvh">
      <Sidebar
        userId={userId}
        displayName={displayUserId(userId)}
        isGuest={!!cfg.ok && cfg.config.source === "share" && cfg.config.share?.kind === "guest"}
      />
      <ChatView
        hasConfig={hasConfig}
        conversationId={conv.id}
        initialMessages={conv.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          toolCalls: m.toolCalls ?? undefined,
          attachments: m.attachments ?? undefined,
        }))}
      />
    </div>
  );
}
