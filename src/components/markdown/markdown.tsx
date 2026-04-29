"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import { memo, useState } from "react";
import { cn } from "@/lib/utils";
import { Check, Copy } from "lucide-react";

function CodeBlock({ className, children }: { className?: string; children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const text = String(children ?? "").replace(/\n$/, "");
  const lang = (className ?? "").replace(/^language-/, "");
  return (
    <div className="relative my-2 group rounded-md overflow-hidden bg-zinc-950">
      <div className="flex items-center justify-between px-3 py-1 text-xs text-zinc-400 border-b border-zinc-800">
        <span className="font-mono">{lang || "text"}</span>
        <button
          className="flex items-center gap-1 hover:text-zinc-100 transition-colors"
          onClick={async () => {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre className="px-4 py-3 text-sm overflow-x-auto text-zinc-100">
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

function MarkdownImpl({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("prose prose-zinc dark:prose-invert max-w-none break-words", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, [rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children, ...rest }: React.HTMLAttributes<HTMLElement>) => {
            const isBlock = className?.startsWith("language-");
            if (isBlock) return <CodeBlock className={className}>{children}</CodeBlock>;
            return (
              <code className={className} {...rest}>
                {children}
              </code>
            );
          },
          a: ({ children, ...rest }) => (
            <a target="_blank" rel="noreferrer" {...rest}>
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

export const Markdown = memo(MarkdownImpl, (a, b) => a.children === b.children);
