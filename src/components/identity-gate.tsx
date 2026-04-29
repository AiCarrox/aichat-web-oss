"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export function IdentityGate() {
  const router = useRouter();
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = val.trim();
    if (!trimmed) return;
    setBusy(true);
    const res = await fetch("/api/identity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: trimmed }),
    });
    setBusy(false);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(j?.error ?? "失败");
      return;
    }
    router.refresh();
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-muted/30 p-6">
      <div className="max-w-md w-full bg-background border rounded-xl p-6 space-y-4">
        <h1 className="text-lg font-medium">请输入一个 id,做为唯一标识</h1>
        <form onSubmit={submit} className="flex gap-2">
          <Input
            autoFocus
            value={val}
            onChange={(e) => setVal(e.target.value)}
            placeholder="例如 alice"
            maxLength={32}
          />
          <Button type="submit" disabled={busy || !val.trim()}>
            进入
          </Button>
        </form>
        <p className="text-xs text-muted-foreground">
          同一个 id 可以在不同设备使用同一空间。换 id 即换空间。
        </p>
      </div>
    </div>
  );
}
