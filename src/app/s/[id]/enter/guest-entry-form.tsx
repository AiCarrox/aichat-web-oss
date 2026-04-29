"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export function GuestEntryForm({ shareId }: { shareId: string }) {
  const router = useRouter();
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = val.trim();
    if (!trimmed) return;
    setBusy(true);
    const namespaced = `s:${shareId}:${trimmed}`;
    const res = await fetch("/api/identity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: namespaced }),
    });
    setBusy(false);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(j?.error ?? "失败");
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
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
  );
}
