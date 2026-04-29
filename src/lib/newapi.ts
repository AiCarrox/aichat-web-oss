// new-api HTTP 客户端
// 全部接收 baseUrl/token 参数,不再读环境变量。
// 由调用方(API 路由)从 cookie/share 解出后注入。

import { Agent, type Dispatcher } from "undici";
import { logger, maskToken } from "@/lib/logger";

const log = logger.child({ module: "newapi" });

// 图像生成/编辑经常 2-5 分钟,undici 默认 headersTimeout=300s 会把它掐断。
const imageAgent = new Agent({
  headersTimeout: 10 * 60 * 1000,
  bodyTimeout: 10 * 60 * 1000,
  connectTimeout: 30 * 1000,
});

type FetchInit = RequestInit & { dispatcher?: Dispatcher };

function trimSlash(s: string): string {
  return s.replace(/\/+$/, "");
}

/** 代理 /v1/models - 返回原始 OpenAI 格式 */
export async function listModels(
  baseUrl: string,
  token: string,
): Promise<{ id: string; object?: string }[]> {
  const start = Date.now();
  const base = trimSlash(baseUrl);
  log.info("models.list.start", { token: maskToken(token) });
  try {
    const res = await fetch(`${base}/v1/models`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      log.warn("models.list.fail", { status: res.status, durationMs: Date.now() - start });
      throw new Error(`获取模型列表失败 (${res.status})`);
    }
    const body = (await res.json()) as { data?: { id: string; object?: string }[] };
    const data = body.data ?? [];
    log.info("models.list.ok", { count: data.length, durationMs: Date.now() - start });
    return data;
  } catch (e) {
    log.error("models.list.error", { error: e, durationMs: Date.now() - start });
    throw e;
  }
}

export type ImageSize = "1024x1024" | "1536x1024" | "1024x1536" | "auto";
export type ImageQuality = "low" | "medium" | "high" | "auto";
export type ImageBackground = "transparent" | "opaque" | "auto";
export type ImageOutputFormat = "png" | "jpeg" | "webp";
export type ImageModeration = "auto" | "low";
export type ImageInputFidelity = "high" | "low";

export interface ImageGenerationRequest {
  model: string;
  prompt: string;
  n?: number;
  size?: ImageSize;
  quality?: ImageQuality;
  background?: ImageBackground;
  output_format?: ImageOutputFormat;
  output_compression?: number;
  moderation?: ImageModeration;
}

export interface ImageGenerationResult {
  url?: string;
  b64_json?: string;
  revised_prompt?: string;
}

function addIfDefined<T extends Record<string, unknown>>(
  body: T,
  key: string,
  value: unknown,
): void {
  if (value !== undefined) (body as Record<string, unknown>)[key] = value;
}

function addFormField(form: FormData, key: string, value: unknown): void {
  if (value !== undefined) form.append(key, String(value));
}

function imageExtension(contentType: string): string {
  if (contentType === "image/jpeg") return "jpg";
  if (contentType === "image/webp") return "webp";
  if (contentType === "image/png") return "png";
  throw new Error(`不支持的图片类型: ${contentType || "unknown"}`);
}

function normalizeImageUrl(url: string): string {
  return url.trim().replace(/[\s　.,,。;;::!?!?)\]\}＞>]+$/u, "");
}

async function fetchImageAsBlob(
  url: string,
  fallbackName: string,
): Promise<{ blob: Blob; filename: string }> {
  const normalizedUrl = normalizeImageUrl(url);
  const res = await fetch(normalizedUrl, {
    signal: AbortSignal.timeout(2 * 60 * 1000),
    dispatcher: imageAgent,
  } as FetchInit as RequestInit);
  if (!res.ok) throw new Error(`下载图片失败 (${res.status})`);

  const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const ext = imageExtension(contentType);
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength === 0) throw new Error("下载图片为空");

  return {
    blob: new Blob([bytes], { type: contentType }),
    filename: `${fallbackName}.${ext}`,
  };
}

/** 调 /v1/images/generations */
export async function generateImage(
  baseUrl: string,
  token: string,
  req: ImageGenerationRequest,
): Promise<ImageGenerationResult[]> {
  const start = Date.now();
  const base = trimSlash(baseUrl);
  log.info("image.generate.start", {
    token: maskToken(token),
    model: req.model,
    size: req.size ?? "1024x1024",
    n: req.n ?? 1,
    promptLen: req.prompt.length,
  });
  const body: Record<string, unknown> = {
    model: req.model,
    prompt: req.prompt,
    n: req.n ?? 1,
    size: req.size ?? "1024x1024",
  };
  addIfDefined(body, "quality", req.quality);
  addIfDefined(body, "background", req.background);
  addIfDefined(body, "output_format", req.output_format);
  addIfDefined(body, "output_compression", req.output_compression);
  addIfDefined(body, "moderation", req.moderation);
  const init: FetchInit = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10 * 60 * 1000),
    dispatcher: imageAgent,
  };
  try {
    const res = await fetch(`${base}/v1/images/generations`, init as RequestInit);
    const respBody = (await res.json()) as {
      data?: ImageGenerationResult[];
      error?: { message?: string };
    };
    if (!res.ok) {
      log.warn("image.generate.fail", {
        status: res.status,
        message: respBody?.error?.message,
        durationMs: Date.now() - start,
      });
      throw new Error(respBody?.error?.message || `图像生成失败 (${res.status})`);
    }
    const data = respBody.data ?? [];
    log.info("image.generate.ok", {
      model: req.model,
      count: data.length,
      durationMs: Date.now() - start,
    });
    return data;
  } catch (e) {
    log.error("image.generate.error", {
      model: req.model,
      error: e,
      durationMs: Date.now() - start,
    });
    throw e;
  }
}

export interface ImageEditRequest {
  model: string;
  prompt: string;
  imageUrl: string;
  maskUrl?: string;
  n?: number;
  size?: ImageSize;
  quality?: ImageQuality;
  background?: ImageBackground;
  output_format?: ImageOutputFormat;
  output_compression?: number;
  input_fidelity?: ImageInputFidelity;
}

/** 调 /v1/images/edits - new-api 当前要求 multipart/form-data */
export async function editImage(
  baseUrl: string,
  token: string,
  params: ImageEditRequest,
): Promise<ImageGenerationResult[]> {
  const start = Date.now();
  const base = trimSlash(baseUrl);
  log.info("image.edit.start", {
    token: maskToken(token),
    model: params.model,
    size: params.size ?? "1024x1024",
    hasMask: !!params.maskUrl,
    n: params.n ?? 1,
    promptLen: params.prompt.length,
  });
  try {
    const form = new FormData();
    form.append("model", params.model);
    form.append("prompt", params.prompt);
    form.append("n", String(params.n ?? 1));
    form.append("size", params.size ?? "1024x1024");
    addFormField(form, "quality", params.quality);
    addFormField(form, "background", params.background);
    addFormField(form, "output_format", params.output_format);
    addFormField(form, "output_compression", params.output_compression);
    addFormField(form, "input_fidelity", params.input_fidelity);

    const image = await fetchImageAsBlob(params.imageUrl, "image");
    form.append("image", image.blob, image.filename);

    if (params.maskUrl) {
      const mask = await fetchImageAsBlob(params.maskUrl, "mask");
      form.append("mask", mask.blob, mask.filename);
    }

    const res = await fetch(`${base}/v1/images/edits`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      signal: AbortSignal.timeout(10 * 60 * 1000),
      dispatcher: imageAgent,
    } as FetchInit as RequestInit);
    const respBody = (await res.json()) as {
      data?: ImageGenerationResult[];
      error?: { message?: string };
    };
    if (!res.ok) {
      log.warn("image.edit.fail", {
        status: res.status,
        message: respBody?.error?.message,
        durationMs: Date.now() - start,
      });
      throw new Error(respBody?.error?.message || `图像编辑失败 (${res.status})`);
    }
    const data = respBody.data ?? [];
    log.info("image.edit.ok", {
      model: params.model,
      count: data.length,
      durationMs: Date.now() - start,
    });
    return data;
  } catch (e) {
    log.error("image.edit.error", {
      model: params.model,
      error: e,
      durationMs: Date.now() - start,
    });
    throw e;
  }
}
