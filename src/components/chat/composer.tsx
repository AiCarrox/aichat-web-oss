"use client";

import { useEffect, useRef, useState } from "react";
import { Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SendHorizontal, Loader2, Paperclip, X } from "lucide-react";

const MAX_FILES = 5;
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB
const ACCEPT =
  "image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.txt,.md,.json,.xml,.html,.css,.js,.ts,.py,.go,.rs,.java,.c,.cpp,.h,.zip,.tar,.gz";

export interface FileAttachment {
  name: string;
  data: string; // base64 data URL
  mimeType: string;
  size: number;
}

interface Props {
  onSend: (text: string, files?: FileAttachment[]) => void;
  disabled?: boolean;
  loading?: boolean;
  onStop?: () => void;
  mode?: "chat" | "image-edit";
  canSubmitEmpty?: boolean;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function Composer({
  onSend,
  disabled,
  loading,
  onStop,
  mode = "chat",
  canSubmitEmpty = false,
}: Props) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<FileAttachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [text]);

  async function readFiles(fileList: FileList | File[]) {
    const incoming = Array.from(fileList);
    if (files.length + incoming.length > MAX_FILES) {
      alert(`最多 ${MAX_FILES} 个文件`);
      return;
    }
    const results: FileAttachment[] = [];
    for (const f of incoming) {
      if (f.size > MAX_SIZE) {
        alert(`"${f.name}" 超过 10 MB 限制`);
        return;
      }
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(f);
      });
      results.push({ name: f.name, data, mimeType: f.type || "application/octet-stream", size: f.size });
    }
    setFiles((prev) => [...prev, ...results]);
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  const submit = () => {
    const t = text.trim();
    if ((!t && !canSubmitEmpty && files.length === 0) || disabled) return;
    onSend(t, files.length > 0 ? files : undefined);
    setText("");
    setFiles([]);
  };

  const isImageEdit = mode === "image-edit";
  const canSubmit = !disabled && (!!text.trim() || canSubmitEmpty || files.length > 0);

  return (
    <div className="border-t bg-background">
      <div className="max-w-3xl mx-auto px-4 py-3">
        {/* File chips */}
        {files.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {files.map((f, i) => (
              <div
                key={`${f.name}-${i}`}
                className="inline-flex items-center gap-1.5 rounded-full border bg-muted/60 px-3 py-1 text-xs"
              >
                <span className="max-w-[140px] truncate font-medium">{f.name}</span>
                <span className="text-muted-foreground">{formatSize(f.size)}</span>
                <button
                  type="button"
                  className="ml-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20"
                  onClick={() => removeFile(i)}
                  title="移除"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div
          className={`flex items-end gap-2 rounded-2xl border bg-background shadow-sm p-2 ${
            dragOver ? "ring-2 ring-primary/50" : ""
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragOver(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragOver(false);
          }}
          onDrop={async (e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragOver(false);
            if (e.dataTransfer.files.length > 0) await readFiles(e.dataTransfer.files);
          }}
        >
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            onChange={async (e) => {
              if (e.target.files && e.target.files.length > 0) {
                await readFiles(e.target.files);
                e.target.value = "";
              }
            }}
          />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            disabled={disabled || files.length >= MAX_FILES}
            onClick={() => fileInputRef.current?.click()}
            title="上传文件"
            className="flex-shrink-0"
          >
            <Paperclip className="h-4 w-4" />
          </Button>
          <Textarea
            ref={ref}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={async (e) => {
              const items = Array.from(e.clipboardData.items);
              const imageItems = items.filter((it) => it.type.startsWith("image/"));
              if (imageItems.length === 0) return;
              e.preventDefault();
              const fs: File[] = [];
              for (const it of imageItems) {
                const f = it.getAsFile();
                if (f) fs.push(f);
              }
              if (fs.length > 0) await readFiles(fs);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder={
              isImageEdit
                ? "描述编辑"
                : "给 AI 发送消息… (Enter 发送, Shift+Enter 换行，可拖放/粘贴文件)"
            }
            className="border-0 focus-visible:ring-0 bg-transparent min-h-[40px] max-h-60"
            disabled={disabled}
          />
          {loading && onStop ? (
            <Button size="icon" variant="outline" onClick={onStop} title="停止">
              <Loader2 className="h-4 w-4 animate-spin" />
            </Button>
          ) : (
            <Button size="icon" onClick={submit} disabled={!canSubmit} title="发送">
              <SendHorizontal className="h-4 w-4" />
            </Button>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground text-center mt-2">
          {isImageEdit
            ? "将基于当前图片生成编辑后的新图。"
            : `支持图片/文档/代码文件，单文件 ≤10MB，最多 ${MAX_FILES} 个。AI 可能生成不准确信息，请自行核对。`}
        </p>
      </div>
    </div>
  );
}
