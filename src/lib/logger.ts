// 轻量 JSON 行日志
// 同时写到 stdout (docker logs) 与 LOG_DIR/aichat-web-YYYY-MM-DD.log
// 按日滚动,best-effort 写入,失败不抛

import { mkdirSync, createWriteStream, type WriteStream } from "node:fs";
import { join } from "node:path";

const LOG_DIR = process.env.LOG_DIR || "/app/logs";
const LOG_LEVEL = (process.env.LOG_LEVEL || "info").toLowerCase();

type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN = ORDER[LOG_LEVEL as Level] ?? ORDER.info;

let stream: WriteStream | null = null;
let currentDay = "";

function dayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function ensureStream(): WriteStream | null {
  const day = dayKey();
  if (day === currentDay && stream) return stream;
  try {
    mkdirSync(LOG_DIR, { recursive: true });
  } catch {
    /* ignore */
  }
  if (stream) {
    try {
      stream.end();
    } catch {
      /* ignore */
    }
  }
  try {
    stream = createWriteStream(join(LOG_DIR, `aichat-web-${day}.log`), { flags: "a" });
    stream.on("error", () => {
      stream = null;
    });
    currentDay = day;
    return stream;
  } catch {
    stream = null;
    return null;
  }
}

function serialize(v: unknown): unknown {
  if (v instanceof Error) {
    return { name: v.name, message: v.message, stack: v.stack };
  }
  return v;
}

function write(level: Level, msg: string, meta?: Record<string, unknown>) {
  if ((ORDER[level] ?? 0) < MIN) return;
  const cleaned: Record<string, unknown> = {};
  if (meta) {
    for (const [k, v] of Object.entries(meta)) cleaned[k] = serialize(v);
  }
  const entry = { time: new Date().toISOString(), level, msg, ...cleaned };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
  const s = ensureStream();
  if (s) {
    try {
      s.write(line + "\n");
    } catch {
      /* ignore */
    }
  }
}

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  child(ctx: Record<string, unknown>): Logger;
}

function make(base: Record<string, unknown>): Logger {
  return {
    debug: (m, meta) => write("debug", m, { ...base, ...meta }),
    info: (m, meta) => write("info", m, { ...base, ...meta }),
    warn: (m, meta) => write("warn", m, { ...base, ...meta }),
    error: (m, meta) => write("error", m, { ...base, ...meta }),
    child: (ctx) => make({ ...base, ...ctx }),
  };
}

export const logger: Logger = make({});

export function maskToken(s: string | null | undefined): string {
  if (!s) return "<empty>";
  if (s.length <= 10) return `${s[0]}***`;
  return `${s.slice(0, 6)}...${s.slice(-4)}`;
}
