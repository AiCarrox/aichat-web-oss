import { z } from "zod";
import { tool, type StreamData } from "ai";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";
import {
  generateImage,
  editImage,
  type ImageBackground,
  type ImageGenerationResult,
  type ImageOutputFormat,
  type ImageQuality,
  type ImageSize,
} from "@/lib/newapi";
import { safeUserSegment } from "@/lib/identity";
import { logger } from "@/lib/logger";

const log = logger.child({ module: "tools" });

const PUBLIC_GENERATED_DIR = path.join(process.cwd(), "public", "generated");

function extFor(outputFormat: ImageOutputFormat | undefined): string {
  if (outputFormat === "jpeg") return "jpg";
  if (outputFormat === "webp") return "webp";
  return "png";
}

function mimeFor(outputFormat: ImageOutputFormat | undefined): string {
  if (outputFormat === "jpeg") return "image/jpeg";
  if (outputFormat === "webp") return "image/webp";
  return "image/png";
}

async function persistImages(
  userId: string,
  results: ImageGenerationResult[],
  outputFormat: ImageOutputFormat | undefined,
): Promise<{ url: string | null; b64_json: string | null; revised_prompt: string | null }[]> {
  const seg = safeUserSegment(userId);
  const dir = path.join(PUBLIC_GENERATED_DIR, seg);
  const ext = extFor(outputFormat);
  let dirReady = false;
  const out: { url: string | null; b64_json: string | null; revised_prompt: string | null }[] = [];
  for (const r of results) {
    if (r.b64_json) {
      try {
        if (!dirReady) {
          await mkdir(dir, { recursive: true });
          dirReady = true;
        }
        const name = `${Date.now()}_${randomBytes(4).toString("hex")}.${ext}`;
        const full = path.join(dir, name);
        await writeFile(full, Buffer.from(r.b64_json, "base64"));
        out.push({
          url: `/generated/${seg}/${name}`,
          b64_json: null,
          revised_prompt: r.revised_prompt ?? null,
        });
        continue;
      } catch (e) {
        log.warn("image.persist.fail", { userId: seg, error: e });
        out.push({
          url: null,
          b64_json: r.b64_json,
          revised_prompt: r.revised_prompt ?? null,
        });
        continue;
      }
    }
    out.push({
      url: r.url ?? null,
      b64_json: null,
      revised_prompt: r.revised_prompt ?? null,
    });
  }
  return out;
}

interface HeartbeatPayload {
  type: "image-status";
  id: string;
  tool: "generate_image" | "edit_image";
  phase: "running" | "done" | "error";
  elapsedMs: number;
  message?: string;
}

function beginHeartbeat(
  streamData: StreamData | undefined,
  toolName: HeartbeatPayload["tool"],
): {
  id: string;
  stop: (phase: "done" | "error", message?: string) => void;
} {
  const id = randomUUID();
  const start = Date.now();
  if (!streamData) {
    return { id, stop: () => {} };
  }
  streamData.append({ type: "image-status", id, tool: toolName, phase: "running", elapsedMs: 0 });
  const interval = setInterval(() => {
    try {
      streamData.append({
        type: "image-status",
        id,
        tool: toolName,
        phase: "running",
        elapsedMs: Date.now() - start,
      });
    } catch {
      clearInterval(interval);
    }
  }, 8000);
  return {
    id,
    stop: (phase, message) => {
      clearInterval(interval);
      try {
        streamData.append({
          type: "image-status",
          id,
          tool: toolName,
          phase,
          elapsedMs: Date.now() - start,
          ...(message ? { message } : {}),
        });
      } catch {
        // already closed
      }
    },
  };
}

const SIZE_DESC =
  "图片尺寸: 1024x1024(正方形,默认)/1536x1024(横版,适合风景/封面)/1024x1536(竖版,适合海报/立绘)/auto(模型自选)";

export interface ImageToolContext {
  userId: string;
  baseUrl: string;
  apiKey: string;
  imageModel: string;
  streamData?: StreamData;
}

/** 构造图像工具集 - 聊天模型会自行判断是否调用 */
export function buildImageTools(ctx: ImageToolContext) {
  const { userId, baseUrl, apiKey, imageModel, streamData } = ctx;

  return {
    generate_image: tool({
      description:
        "根据文本描述生成一张新图片。当用户明确要求画图、生成图片、制作插画、设计图标/海报等视觉创作时调用。避免在用户只是讨论图像概念时调用。",
      parameters: z.object({
        prompt: z
          .string()
          .describe(
            "详细的英文图像描述,尽量包含主体/风格/构图/光线/色调;若用户给的是中文需要先翻译并扩展",
          ),
        size: z
          .enum(["1024x1024", "1536x1024", "1024x1536", "auto"])
          .optional()
          .describe(SIZE_DESC),
        quality: z
          .enum(["low", "medium", "high", "auto"])
          .optional()
          .describe("渲染质量;默认 auto。"),
        background: z
          .enum(["transparent", "opaque", "auto"])
          .optional()
          .describe("背景透明度。仅支持 png/webp 输出格式。"),
        output_format: z
          .enum(["png", "jpeg", "webp"])
          .optional()
          .describe("输出文件格式: png(默认)/jpeg/webp"),
        n: z
          .number()
          .int()
          .min(1)
          .max(4)
          .optional()
          .describe("生成张数,默认 1;最多 4 张"),
      }),
      execute: async ({ prompt, size, quality, background, output_format, n }) => {
        const start = Date.now();
        const hb = beginHeartbeat(streamData, "generate_image");
        log.info("tool.generate_image.call", {
          userId,
          model: imageModel,
          size: size ?? "1024x1024",
          n: n ?? 1,
          promptLen: prompt.length,
          hbId: hb.id,
        });
        try {
          const results = await generateImage(baseUrl, apiKey, {
            model: imageModel,
            prompt,
            size: size as ImageSize | undefined,
            quality: quality as ImageQuality | undefined,
            background: background as ImageBackground | undefined,
            output_format: output_format as ImageOutputFormat | undefined,
            n: n ?? 1,
          });
          const images = await persistImages(userId, results, output_format as ImageOutputFormat | undefined);
          log.info("tool.generate_image.done", {
            userId,
            model: imageModel,
            count: images.length,
            durationMs: Date.now() - start,
            hbId: hb.id,
          });
          hb.stop("done");
          return {
            model: imageModel,
            prompt,
            size: size ?? "1024x1024",
            mime: mimeFor(output_format as ImageOutputFormat | undefined),
            images,
          };
        } catch (e) {
          log.error("tool.generate_image.fail", {
            userId,
            model: imageModel,
            error: e,
            durationMs: Date.now() - start,
            hbId: hb.id,
          });
          hb.stop("error", e instanceof Error ? e.message : String(e));
          throw e;
        }
      },
    }),

    edit_image: tool({
      description:
        "基于已有图片进行编辑/变体/扩展/局部重绘。必须提供原图 URL。",
      parameters: z.object({
        prompt: z.string().describe("编辑指令,英文优先"),
        image_url: z.string().url().describe("要编辑的原图 URL"),
        mask_url: z.string().url().optional().describe("可选遮罩图 URL"),
        size: z
          .enum(["1024x1024", "1536x1024", "1024x1536", "auto"])
          .optional()
          .describe(SIZE_DESC),
        quality: z.enum(["low", "medium", "high", "auto"]).optional(),
        background: z.enum(["transparent", "opaque", "auto"]).optional(),
        output_format: z.enum(["png", "jpeg", "webp"]).optional(),
      }),
      execute: async ({
        prompt,
        image_url,
        mask_url,
        size,
        quality,
        background,
        output_format,
      }) => {
        const start = Date.now();
        const hb = beginHeartbeat(streamData, "edit_image");
        log.info("tool.edit_image.call", {
          userId,
          model: imageModel,
          hasMask: !!mask_url,
          hbId: hb.id,
        });
        try {
          const results = await editImage(baseUrl, apiKey, {
            model: imageModel,
            prompt,
            imageUrl: image_url,
            maskUrl: mask_url,
            size: size as ImageSize | undefined,
            quality: quality as ImageQuality | undefined,
            background: background as ImageBackground | undefined,
            output_format: output_format as ImageOutputFormat | undefined,
          });
          const images = await persistImages(userId, results, output_format as ImageOutputFormat | undefined);
          log.info("tool.edit_image.done", {
            userId,
            model: imageModel,
            count: images.length,
            durationMs: Date.now() - start,
            hbId: hb.id,
          });
          hb.stop("done");
          return {
            model: imageModel,
            prompt,
            size: size ?? "1024x1024",
            mime: mimeFor(output_format as ImageOutputFormat | undefined),
            images,
          };
        } catch (e) {
          log.error("tool.edit_image.fail", {
            userId,
            model: imageModel,
            error: e,
            durationMs: Date.now() - start,
            hbId: hb.id,
          });
          hb.stop("error", e instanceof Error ? e.message : String(e));
          throw e;
        }
      },
    }),
  };
}
