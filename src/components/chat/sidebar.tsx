"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Plus, MessageSquare, Trash2, LogOut, Settings, Sun, Moon } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Conv {
  id: string;
  title: string;
  updatedAt: string;
}

export function Sidebar({
  userId,
  displayName,
  isGuest,
}: {
  userId: string;
  displayName: string;
  isGuest: boolean;
}) {
  const router = useRouter();
  const path = usePathname();
  const [list, setList] = useState<Conv[]>([]);
  const { theme, setTheme } = useTheme();
  void userId;

  async function load() {
    const r = await fetch("/api/conversations");
    const j = await r.json();
    setList(j.data ?? []);
  }

  useEffect(() => {
    load();
    const onUpdate = () => load();
    window.addEventListener("conversations:update", onUpdate);
    return () => window.removeEventListener("conversations:update", onUpdate);
  }, []);

  async function del(id: string) {
    if (!confirm("删除该会话?")) return;
    await fetch(`/api/conversations/${id}`, { method: "DELETE" });
    toast.success("已删除");
    if (path === `/c/${id}`) router.push("/");
    load();
  }

  async function switchId() {
    if (!confirm("切换 ID?当前 cookie 会被清除,数据保留在原 ID 下。")) return;
    await fetch("/api/identity", { method: "DELETE" });
    if (!isGuest) await fetch("/api/config", { method: "DELETE" });
    router.push("/");
    router.refresh();
  }

  return (
    <aside className="flex flex-col w-64 bg-sidebar text-sidebar-foreground border-r h-dvh">
      <div className="p-3 border-b">
        <Button
          className="w-full justify-start"
          variant="outline"
          onClick={() => router.push("/")}
        >
          <Plus className="h-4 w-4" />
          新对话
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {list.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-8">暂无历史</p>
        )}
        {list.map((c) => (
          <div
            key={c.id}
            className={cn(
              "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer hover:bg-accent",
              path === `/c/${c.id}` && "bg-accent",
            )}
            onClick={() => router.push(`/c/${c.id}`)}
          >
            <MessageSquare className="h-4 w-4 flex-shrink-0 opacity-70" />
            <span className="flex-1 truncate">{c.title}</span>
            <button
              className="opacity-0 group-hover:opacity-70 hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                del(c.id);
              }}
              title="删除"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
      <div className="border-t p-2 space-y-1">
        <div className="flex items-center justify-between px-2 py-1 text-xs">
          <span className="truncate font-medium">
            {displayName}
            {isGuest && <span className="ml-1 text-amber-600 dark:text-amber-400">[访客]</span>}
          </span>
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="hover:opacity-70"
            title="切换主题"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
        <Link
          href="/settings"
          className="flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-accent"
        >
          <Settings className="h-4 w-4" />
          设置
        </Link>
        <button
          className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-accent"
          onClick={switchId}
        >
          <LogOut className="h-4 w-4" />
          切换 ID
        </button>
      </div>
    </aside>
  );
}
