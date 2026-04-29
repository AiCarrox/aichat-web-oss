"use client";

import { useChat } from "ai/react";
import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Composer, type FileAttachment } from "@/components/chat/composer";
import {
  MessageBubble,
  type ChatMessage,
  type ImageAttachment,
  type ImageInteraction,
  type UserFileAttachment,
} from "@/components/chat/message-bubble";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ChevronDown, Download, ImageIcon, Loader2, X } from "lucide-react";

interface PrefilledMessage {
  id: string;
  role: string;
  content: string;
  toolCalls?: unknown;
  attachments?: unknown;
}

interface Props {
  conversationId?: string;
  initialMessages?: PrefilledMessage[];
  hasConfig?: boolean;
}

interface ImageStatus {
  type: "image-status";
  id: string;
  tool: "generate_image" | "edit_image";
  phase: "running" | "done" | "error";
  elapsedMs: number;
  message?: string;
}

interface ImageEditorState extends ImageInteraction {
  selectedAspectRatio: string | null;
}

const ASPECT_RATIO_OPTIONS = [
  { label: "方形", value: "1:1" },
  { label: "竖版", value: "3:4" },
  { label: "故事", value: "9:16" },
  { label: "横屏", value: "4:3" },
  { label: "宽屏", value: "16:9" },
];

function extractImages(attachments: unknown): ImageAttachment[] {
  if (!Array.isArray(attachments)) return [];
  const imgs: ImageAttachment[] = [];
  for (const a of attachments) {
    const result = (a as { result?: { images?: ImageAttachment[] } })?.result;
    if (result?.images) imgs.push(...result.images);
  }
  return imgs;
}

function extractUserFiles(attachments: unknown): UserFileAttachment[] {
  if (!attachments || typeof attachments !== "object") return [];
  const a = attachments as { userFiles?: UserFileAttachment[] };
  return Array.isArray(a.userFiles) ? a.userFiles : [];
}

function imageSrc(a: ImageAttachment): string | null {
  if (a.url) return a.url;
  if (a.b64_json) return `data:image/png;base64,${a.b64_json}`;
  return null;
}

function isPositiveInteger(v: string): boolean {
  return /^[1-9]\d*$/.test(v.trim());
}

function absoluteImageUrl(src: string): string {
  if (/^https?:\/\//i.test(src) || src.startsWith("data:")) return src;
  return `${window.location.origin}${src.startsWith("/") ? src : `/${src}`}`;
}

function downloadFileName(src: string): string {
  if (src.startsWith("data:image/jpeg")) return "aichat-image.jpg";
  if (src.startsWith("data:image/webp")) return "aichat-image.webp";
  const clean = src.split("?")[0]?.split("#")[0] ?? "";
  const ext = clean.match(/\.(png|jpg|jpeg|webp)$/i)?.[1]?.toLowerCase();
  return `aichat-image.${ext === "jpeg" ? "jpg" : ext || "png"}`;
}

export function ChatView({ conversationId: initialId, initialMessages = [], hasConfig: initialHasConfig }: Props) {
  const [convId, setConvId] = useState<string | undefined>(initialId);
  const [hasConfig, setHasConfig] = useState<boolean | null>(
    typeof initialHasConfig === "boolean" ? initialHasConfig : null,
  );
  const [editor, setEditor] = useState<ImageEditorState | null>(null);
  const [aspectMenuOpen, setAspectMenuOpen] = useState(false);
  const [customWidth, setCustomWidth] = useState("");
  const [customHeight, setCustomHeight] = useState("");
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Track user files for messages sent in the current session.
  // Initial-message files come from DB attachments; live-send files come through this ref.
  const pendingUserFilesRef = useRef<{ files: UserFileAttachment[]; consumed: boolean }>({
    files: [],
    consumed: true,
  });

  useEffect(() => {
    if (typeof initialHasConfig === "boolean") return;
    fetch("/api/self")
      .then((r) => r.json())
      .then((j) => setHasConfig(!!j?.hasConfig))
      .catch(() => setHasConfig(false));
  }, [initialHasConfig]);

  const seed = useMemo(
    () =>
      initialMessages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          id: m.id,
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
    [initialMessages],
  );

  const { messages, isLoading, stop, append, data, setMessages, reload } = useChat({
    api: "/api/chat",
    id: convId ?? "new",
    initialMessages: seed,
    body: { conversationId: convId },
    onResponse: (res) => {
      const id = res.headers.get("X-Conversation-Id");
      if (id && id !== convId) {
        setConvId(id);
        window.history.replaceState(null, "", `/c/${id}`);
      }
    },
    onFinish: async () => {
      window.dispatchEvent(new Event("conversations:update"));
    },
    onError: (e) => toast.error(e.message || "请求失败"),
  });

  useEffect(() => {
    if (!editor) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, data, editor]);

  useEffect(() => {
    if (!editor) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEditor(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor]);

  const activeImageStatus: ImageStatus | null = useMemo(() => {
    if (!isLoading || !data || !Array.isArray(data)) return null;
    const latestById = new Map<string, ImageStatus>();
    for (const d of data) {
      if (!d || typeof d !== "object") continue;
      const s = d as unknown as ImageStatus;
      if (s.type !== "image-status" || !s.id) continue;
      latestById.set(s.id, s);
    }
    for (const s of latestById.values()) {
      if (s.phase === "running") return s;
    }
    return null;
  }, [data, isLoading]);

  const activeImageStartRef = useRef<{ id: string; wallStart: number; serverElapsed: number } | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!activeImageStatus) {
      activeImageStartRef.current = null;
      return;
    }
    if (
      !activeImageStartRef.current ||
      activeImageStartRef.current.id !== activeImageStatus.id
    ) {
      activeImageStartRef.current = {
        id: activeImageStatus.id,
        wallStart: Date.now(),
        serverElapsed: activeImageStatus.elapsedMs,
      };
    } else {
      activeImageStartRef.current.serverElapsed = activeImageStatus.elapsedMs;
      activeImageStartRef.current.wallStart = Date.now();
    }
  }, [activeImageStatus]);
  useEffect(() => {
    if (!activeImageStatus) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [activeImageStatus]);
  const displayElapsedSec = useMemo(() => {
    if (!activeImageStatus) return 0;
    const ref = activeImageStartRef.current;
    if (!ref) return Math.floor(activeImageStatus.elapsedMs / 1000);
    const extraMs = Date.now() - ref.wallStart;
    return Math.max(1, Math.floor((ref.serverElapsed + extraMs) / 1000));
  }, [activeImageStatus, tick]);

  const historyImages = useMemo(() => {
    const map = new Map<string, ImageAttachment[]>();
    for (const m of initialMessages) {
      if (m.role === "assistant" && m.attachments) {
        map.set(m.id, extractImages(m.attachments));
      }
    }
    return map;
  }, [initialMessages]);

  const historyUserFiles = useMemo(() => {
    const map = new Map<string, UserFileAttachment[]>();
    for (const m of initialMessages) {
      if (m.role === "user" && m.attachments) {
        const uf = extractUserFiles(m.attachments);
        if (uf.length > 0) map.set(m.id, uf);
      }
    }
    return map;
  }, [initialMessages]);

  const renderList: ChatMessage[] = messages.map((m) => {
    const attachFromTool: ImageAttachment[] = [];
    const anyM = m as unknown as { toolInvocations?: { state: string; toolName: string; result?: { images?: ImageAttachment[] } }[] };
    if (anyM.toolInvocations) {
      for (const inv of anyM.toolInvocations) {
        if (inv.state === "result" && inv.result?.images) attachFromTool.push(...inv.result.images);
      }
    }
    const seeded = historyImages.get(m.id) ?? [];

    let userFiles: UserFileAttachment[] | undefined;
    if (m.role === "user") {
      const hist = historyUserFiles.get(m.id);
      if (hist) {
        userFiles = hist;
      } else if (!pendingUserFilesRef.current.consumed) {
        userFiles = pendingUserFilesRef.current.files;
        pendingUserFilesRef.current.consumed = true;
      }
    }

    return {
      id: m.id,
      role: m.role as ChatMessage["role"],
      content: m.content,
      images: [...seeded, ...attachFromTool],
      userFiles,
      pending: isLoading && m === messages[messages.length - 1] && !m.content,
    };
  });

  function openEditor(payload: ImageInteraction) {
    setEditor({ ...payload, selectedAspectRatio: null });
    setAspectMenuOpen(false);
  }

  async function downloadImage(src: string) {
    try {
      const a = document.createElement("a");
      a.href = src;
      a.download = downloadFileName(src);
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      toast.error("下载失败");
    }
  }

  function selectAspectRatio(value: string) {
    setEditor((current) => (current ? { ...current, selectedAspectRatio: value } : current));
    setAspectMenuOpen(false);
  }

  function selectCustomAspectRatio() {
    if (!isPositiveInteger(customWidth) || !isPositiveInteger(customHeight)) {
      toast.error("自定义比例必须填写正整数");
      return;
    }
    selectAspectRatio(`${customWidth.trim()}:${customHeight.trim()}`);
  }

  async function handleRegenerate(id: string, role: "user" | "assistant") {
    if (isLoading) return;
    const idx = messages.findIndex((m) => m.id === id);
    if (idx < 0) return;
    const cascade = role === "user" ? "descendants" : "after";
    try {
      const r = await fetch(`/api/messages/${id}?cascade=${cascade}`, {
        method: "DELETE",
      });
      if (!r.ok) throw new Error(await r.text());
    } catch (e) {
      toast.error(`重新生成失败: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    const trimEnd = role === "user" ? idx + 1 : idx;
    const trimmed = messages.slice(0, trimEnd);
    if (trimmed.length === 0 || trimmed[trimmed.length - 1]?.role !== "user") {
      toast.error("找不到上一条用户消息,无法重新生成");
      setMessages(trimmed);
      return;
    }
    if (editingMsgId) setEditingMsgId(null);
    setMessages(trimmed);
    setTimeout(() => {
      void reload();
    }, 0);
  }

  async function handleEditSave(id: string, newContent: string) {
    try {
      const r = await fetch(`/api/messages/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: newContent }),
      });
      if (!r.ok) throw new Error(await r.text());
    } catch (e) {
      toast.error(`保存失败: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    setMessages(
      messages.map((m) => (m.id === id ? { ...m, content: newContent } : m)),
    );
    setEditingMsgId(null);
  }

  async function handleDelete(id: string) {
    try {
      const r = await fetch(`/api/messages/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(await r.text());
    } catch (e) {
      toast.error(`删除失败: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    setMessages(messages.filter((m) => m.id !== id));
    if (editingMsgId === id) setEditingMsgId(null);
  }

  async function onSend(text: string, files?: FileAttachment[]) {
    const editingSrc = editor?.src ?? null;
    if (editor) setEditor(null);

    let finalText = text;
    if (editingSrc) {
      let usableSrc = editingSrc;
      if (editingSrc.startsWith("data:")) {
        try {
          const r = await fetch("/api/upload-image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dataUrl: editingSrc }),
          });
          if (!r.ok) {
            const j = (await r.json().catch(() => null)) as { error?: string } | null;
            throw new Error(j?.error ?? `HTTP ${r.status}`);
          }
          const j = (await r.json()) as { url: string };
          usableSrc = j.url;
        } catch (e) {
          toast.error(`原图持久化失败: ${e instanceof Error ? e.message : String(e)}`);
          return;
        }
      }
      const absolute = absoluteImageUrl(usableSrc);
      finalText = `Original image URL: ${absolute}\n\n${text}`.trim();
    }

    const displayFiles: UserFileAttachment[] = (files ?? []).map((f) => ({
      name: f.name,
      mimeType: f.mimeType,
      size: f.size,
      preview: f.mimeType.startsWith("image/") ? f.data : undefined,
    }));
    pendingUserFilesRef.current = { files: displayFiles, consumed: false };

    const bodyFiles =
      files && files.length > 0
        ? files.map((f) => ({ name: f.name, data: f.data, mimeType: f.mimeType, size: f.size }))
        : undefined;

    await append({ role: "user", content: finalText }, bodyFiles ? { body: { files: bodyFiles } } : undefined);
  }

  const editorImageOptions = editor?.images
    .map((image, index) => ({ image, index, src: imageSrc(image) }))
    .filter((item): item is { image: ImageAttachment; index: number; src: string } => !!item.src) ?? [];

  return (
    <div className="flex flex-col h-dvh flex-1 min-w-0">
      {hasConfig === false && !editor && (
        <div className="px-4 py-2 text-sm bg-amber-500/10 text-amber-700 dark:text-amber-300 border-b border-amber-500/20">
          还没配置 API URL/Key，聊天和绘画前请先到{" "}
          <Link href="/settings" className="underline font-medium">
            设置
          </Link>{" "}
          填好。
        </div>
      )}
      {editor ? (
        <div
          className="flex-1 min-h-0 bg-background"
          onClick={() => setEditor(null)}
        >
          <div
            className="h-14 border-b flex items-center justify-between px-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex min-w-0 items-center gap-2">
              <Button variant="ghost" size="icon" onClick={() => setEditor(null)} title="关闭">
                <X className="h-5 w-5" />
              </Button>
              <div className="truncate text-sm font-medium">
                {editor.image.revised_prompt || "图片编辑"}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Button
                  variant="outline"
                  disabled
                  aria-disabled="true"
                  className="h-10 min-w-[92px] rounded-full px-3 leading-tight opacity-50 cursor-not-allowed"
                >
                  {editor.selectedAspectRatio ? (
                    <span className="flex flex-col items-center text-xs leading-tight">
                      <span>宽高比</span>
                      <span>{editor.selectedAspectRatio}</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      宽高比
                      <ChevronDown className="h-4 w-4" />
                    </span>
                  )}
                </Button>
              </div>
              <Button variant="outline" className="rounded-full" onClick={() => downloadImage(editor.src)}>
                <Download className="h-4 w-4" />
                下载
              </Button>
            </div>
          </div>
          <div className="relative h-[calc(100%-3.5rem)] overflow-auto">
            {editorImageOptions.length > 1 && (
              <div
                className="absolute left-3 top-1/2 z-10 flex -translate-y-1/2 flex-col gap-3"
                onClick={(e) => e.stopPropagation()}
              >
                {editorImageOptions.map((item) => (
                  <button
                    key={item.index}
                    type="button"
                    className={cn(
                      "relative h-14 w-14 overflow-hidden rounded-lg border bg-muted opacity-75 hover:opacity-100",
                      item.index === editor.index && "opacity-100 ring-2 ring-ring",
                    )}
                    onClick={() => setEditor({ ...editor, image: item.image, src: item.src, index: item.index })}
                  >
                    <Image src={item.src} alt="thumbnail" fill className="object-cover" unoptimized />
                  </button>
                ))}
              </div>
            )}
            <div
              className="flex min-h-full items-center justify-center p-8"
              onClick={(e) => e.stopPropagation()}
            >
              <Image
                src={editor.src}
                alt={editor.image.revised_prompt ?? "generated"}
                width={1536}
                height={1536}
                className="max-h-[calc(100dvh-15rem)] w-auto max-w-full rounded-sm object-contain shadow-2xl"
                unoptimized
                priority
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {renderList.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground px-6">
              <h1 className="text-2xl font-semibold mb-2">有什么我可以帮忙的?</h1>
              <p className="text-sm">需要画图时直接说"画一只…"/"生成一张…"，模型会自动调用图像工具。</p>
            </div>
          )}
          <div className="max-w-3xl mx-auto w-full">
            {renderList.map((m, i) => (
              <MessageBubble
                key={m.id ?? i}
                msg={m}
                isEditing={!!m.id && editingMsgId === m.id}
                canEdit={!isLoading && !!m.id && !m.pending}
                onImageOpen={openEditor}
                onImageDownload={(src) => downloadImage(src)}
                onRegenerate={handleRegenerate}
                onEditStart={(id) => setEditingMsgId(id)}
                onEditCancel={() => setEditingMsgId(null)}
                onEditSave={handleEditSave}
                onDelete={handleDelete}
              />
            ))}
            {activeImageStatus && (
              <div className="flex gap-3 px-4 py-5 bg-muted/30">
                <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-background border">
                  <ImageIcon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0 flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {activeImageStatus.tool === "edit_image" ? "正在修图" : "正在生图"}
                  <span className="font-mono tabular-nums">
                    {displayElapsedSec}s
                  </span>
                  <span className="text-xs">· gpt-image 模型通常需要 15-70 秒，请稍候</span>
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>
        </div>
      )}
      <Composer
        onSend={onSend}
        loading={isLoading}
        onStop={stop}
        disabled={hasConfig === false}
        mode={editor ? "image-edit" : "chat"}
        canSubmitEmpty={false}
      />
    </div>
  );
}
