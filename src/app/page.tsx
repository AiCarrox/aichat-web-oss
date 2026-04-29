import { Sidebar } from "@/components/chat/sidebar";
import { ChatView } from "@/components/chat/chat-view";
import { IdentityGate } from "@/components/identity-gate";
import { getUserId, displayUserId } from "@/lib/identity";
import { resolveConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export default async function Home() {
  const userId = await getUserId();
  if (!userId) {
    return <IdentityGate />;
  }

  const cfg = await resolveConfig();
  const hasConfig = cfg.ok;

  return (
    <div className="flex h-dvh">
      <Sidebar
        userId={userId}
        displayName={displayUserId(userId)}
        isGuest={!!cfg.ok && cfg.config.source === "share" && cfg.config.share?.kind === "guest"}
      />
      <ChatView hasConfig={hasConfig} />
    </div>
  );
}
