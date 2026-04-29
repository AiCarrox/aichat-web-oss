"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/markdown/markdown";
import { cn } from "@/lib/utils";
import {
  User,
  Bot,
  ImageIcon,
  Pencil,
  Download,
  FileText,
  CornerDownRight,
  RotateCcw,
  Trash2,
  Check,
  X,
} from "lucide-react";

export interface ImageAttachment {
  url?: string | null;
  b64_json?: string | null;
  revised_prompt?: string | null;
}

export interface UserFileAttachment {
  name: string;
  mimeType: string;
  size: number;
  preview?: string; // data URL for images
}

export interface ChatMessage {
  id?: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  images?: ImageAttachment[];
  userFiles?: UserFileAttachment[];
  toolCallPreview?: { name: string; args: unknown } | null;
  pending?: boolean;
}

export interface ImageInteraction {
  image: ImageAttachment;
  src: string;
  images: ImageAttachment[];
  index: number;
}

function imageSrc(a: ImageAttachment): string | null {
  if (a.url) return a.url;
  if (a.b64_json) return `data:image/png;base64,${a.b64_json}`;
  return null;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const ORIGINAL_IMAGE_PREFIX_RE = /^Original image URL:\s*(\S+)\s*\n+([\s\S]*)$/;

function parseUserContent(content: string): {
  referencedImageUrl: string | null;
  text: string;
  rawPrefix: string | null;
} {
  if (!content) return { referencedImageUrl: null, text: content, rawPrefix: null };
  const m = content.match(ORIGINAL_IMAGE_PREFIX_RE);
  if (m) {
    const prefix = `Original image URL: ${m[1]}\n\n`;
    return { referencedImageUrl: m[1], text: m[2], rawPrefix: prefix };
  }
  return { referencedImageUrl: null, text: content, rawPrefix: null };
}

interface Props {
  msg: ChatMessage;
  isEditing?: boolean;
  canEdit?: boolean;
  onImageOpen?: (payload: ImageInteraction) => void;
  onImageDownload?: (src: string, image: ImageAttachment) => void;
  onRegenerate?: (id: string, role: "user" | "assistant") => void;
  onEditStart?: (id: string) => void;
  onEditCancel?: () => void;
  onEditSave?: (id: string, newContent: string) => void;
  onDelete?: (id: string) => void;
}

export function MessageBubble({
  msg,
  isEditing = false,
  canEdit = false,
  onImageOpen,
  onImageDownload,
  onRegenerate,
  onEditStart,
  onEditCancel,
  onEditSave,
  onDelete,
}: Props) {
  const isUser = msg.role === "user";
  const parsed = isUser
    ? parseUserContent(msg.content)
    : { referencedImageUrl: null, text: msg.content, rawPrefix: null };
  const displayContent = parsed.text;
  const referencedImageUrl = parsed.referencedImageUrl;

  const [draft, setDraft] = useState(displayContent);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isEditing) setDraft(displayContent);
  }, [isEditing, displayContent]);

  useEffect(() => {
    if (!isEditing) return;
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, window.innerHeight * 0.6)}px`;
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }, [isEditing]);

  const showToolbar = canEdit && !!msg.id && !msg.pending && !isEditing;

  function commitEdit() {
    if (!msg.id) return;
    const final = parsed.rawPrefix ? `${parsed.rawPrefix}${draft}` : draft;
    onEditSave?.(msg.id, final);
  }

  return (
    <div
      className={cn(
        "group relative flex gap-3 px-4 py-5",
        isUser ? "bg-transparent" : "bg-muted/30",
      )}
    >
      <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-background border">
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>
      <div className="flex-1 min-w-0 space-y-3">
        {msg.toolCallPreview && (
          <div className="inline-flex items-center gap-2 text-xs bg-accent text-accent-foreground rounded-full px-3 py-1">
            <ImageIcon className="h-3 w-3" />
            正在调用 <code className="font-mono">{msg.toolCallPreview.name}</code>
          </div>
        )}
        {msg.userFiles && msg.userFiles.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {msg.userFiles.map((f, i) =>
              f.preview ? (
                <div
                  key={`${f.name}-${i}`}
                  className="relative h-20 w-20 rounded-lg overflow-hidden border bg-muted flex-shrink-0"
                >
                  <Image
                    src={f.preview}
                    alt={f.name}
                    fill
                    className="object-cover"
                    unoptimized
                  />
                </div>
              ) : (
                <div
                  key={`${f.name}-${i}`}
                  className="inline-flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-xs"
                >
                  <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <span className="max-w-[160px] truncate font-medium">{f.name}</span>
                  <span className="text-muted-foreground flex-shrink-0">{formatSize(f.size)}</span>
                </div>
              ),
            )}
          </div>
        )}
        {referencedImageUrl && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <CornerDownRight className="h-3.5 w-3.5 flex-shrink-0" />
            <div className="relative h-10 w-10 rounded-md overflow-hidden border bg-muted flex-shrink-0">
              <Image
                src={referencedImageUrl}
                alt="原图"
                fill
                className="object-cover"
                unoptimized
              />
            </div>
            <span className="truncate">基于原图编辑</span>
          </div>
        )}
        {isEditing ? (
          <div className="space-y-2">
            <textarea
              ref={taRef}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                e.currentTarget.style.height = "auto";
                e.currentTarget.style.height = `${Math.min(
                  e.currentTarget.scrollHeight,
                  window.innerHeight * 0.6,
                )}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  onEditCancel?.();
                } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  commitEdit();
                }
              }}
              className="w-full resize-none rounded-md border bg-background p-3 text-sm leading-6 focus:outline-none focus:ring-2 focus:ring-ring overflow-auto min-h-[3rem]"
            />
            <div className="flex items-center justify-end gap-2 text-xs">
              <span className="text-muted-foreground mr-auto">
                Ctrl/⌘+Enter 保存 · Esc 取消
              </span>
              <button
                type="button"
                onClick={onEditCancel}
                className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 hover:bg-accent"
              >
                <X className="h-3.5 w-3.5" />
                取消
              </button>
              <button
                type="button"
                onClick={commitEdit}
                className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-primary-foreground hover:bg-primary/90"
              >
                <Check className="h-3.5 w-3.5" />
                保存
              </button>
            </div>
          </div>
        ) : displayContent ? (
          <Markdown>{displayContent}</Markdown>
        ) : msg.pending ? (
          <span className="inline-block w-2 h-5 align-middle bg-foreground/70 animate-blink" />
        ) : null}
        {msg.images && msg.images.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
            {msg.images.map((a, i) => {
              const src = imageSrc(a);
              if (!src) return null;
              const payload = { image: a, src, images: msg.images ?? [], index: i };
              return (
                <div
                  key={i}
                  role="button"
                  tabIndex={0}
                  className="group/img relative rounded-lg overflow-hidden border bg-muted cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => onImageOpen?.(payload)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onImageOpen?.(payload);
                    }
                  }}
                >
                  <Image
                    src={src}
                    alt={a.revised_prompt ?? "generated"}
                    width={1024}
                    height={1024}
                    className="w-full h-auto"
                    unoptimized
                  />
                  <div className="absolute inset-x-0 bottom-0 flex items-end justify-between p-3 bg-gradient-to-t from-black/55 to-transparent pointer-events-none">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onImageOpen?.(payload);
                      }}
                      className="pointer-events-auto inline-flex items-center gap-1 rounded-full bg-black/55 px-3 py-1.5 text-xs font-medium text-white backdrop-blur transition-colors hover:bg-black/70"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      编辑
                    </button>
                    <button
                      type="button"
                      className="pointer-events-auto inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur hover:bg-black/70"
                      title="下载"
                      onClick={(e) => {
                        e.stopPropagation();
                        onImageDownload?.(src, a);
                      }}
                    >
                      <Download className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {showToolbar && (
        <div className="absolute bottom-2 right-3 flex items-center gap-0.5 rounded-md border bg-background/95 backdrop-blur shadow-sm p-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <button
            type="button"
            title="重新生成"
            onClick={() => msg.id && onRegenerate?.(msg.id, isUser ? "user" : "assistant")}
            className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title="编辑"
            onClick={() => msg.id && onEditStart?.(msg.id)}
            className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title="删除"
            onClick={() => msg.id && onDelete?.(msg.id)}
            className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
