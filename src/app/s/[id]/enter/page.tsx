import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { GuestEntryForm } from "./guest-entry-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function GuestEnterPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const link = await prisma.shareLink.findUnique({ where: { id } });
  if (!link || link.kind !== "guest") notFound();
  if (link.revokedAt || link.cleanedAt) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-muted/30 p-6">
        <div className="max-w-md w-full bg-background border rounded-xl p-6 space-y-3">
          <h1 className="text-lg font-medium">此分享链接已不可用</h1>
          <p className="text-sm text-muted-foreground">链接已被撤销或自动清理。</p>
        </div>
      </div>
    );
  }
  if (link.expiresAt && link.expiresAt.getTime() <= Date.now()) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-muted/30 p-6">
        <div className="max-w-md w-full bg-background border rounded-xl p-6 space-y-3">
          <h1 className="text-lg font-medium">此分享链接已过期</h1>
          <p className="text-sm text-muted-foreground">
            过期时间:{link.expiresAt.toLocaleString()}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-muted/30 p-6">
      <div className="max-w-md w-full bg-background border rounded-xl p-6 space-y-4">
        <h1 className="text-lg font-medium">请输入一个 id,做为唯一标识</h1>
        <GuestEntryForm shareId={id} />
        {link.expiresAt && (
          <p className="text-xs text-muted-foreground">
            该链接有效期至 {link.expiresAt.toLocaleString()}
          </p>
        )}
      </div>
    </div>
  );
}
