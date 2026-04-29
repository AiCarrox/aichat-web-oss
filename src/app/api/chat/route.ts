import { NextResponse } from "next/server";
import { streamText, convertToCoreMessages, StreamData, type CoreMessage } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/identity";
import { resolveConfig } from "@/lib/config";
import { buildImageTools } from "@/lib/tools";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 600;

const log = logger.child({ module: "chat" });

interface ChatFileBody {
  name: string;
  data: string; // base64 data URL
  mimeType: string;
  size: number;
}

interface ChatRequest {
  conversationId?: string;
  messages: { id?: string; role: "user" | "assistant" | "system" | "tool"; content: string; parts?: unknown[] }[];
  chatModel?: string;
  imageModel?: string;
  files?: ChatFileBody[];
}

export async function POST(req: Request) {
  const reqStart = Date.now();
  const userId = await getUserId();
  if (!userId) {
    log.warn("chat.no_user");
    return NextResponse.json({ error: "请先设置身份 ID" }, { status: 400 });
  }
  const cfg = await resolveConfig();
  if (!cfg.ok) {
    log.warn("chat.no_config", { userId, reason: cfg.reason });
    return NextResponse.json(
      { error: cfg.reason === "no-config" ? "请先在设置中配置 API URL 和 Key" : `配置无效: ${cfg.reason}` },
      { status: 400 },
    );
  }
  const { baseUrl, apiKey, defaultChatModel, defaultImageModel } = cfg.config;

  const body = (await req.json()) as ChatRequest;

  let conv = body.conversationId
    ? await prisma.conversation.findFirst({
        where: { id: body.conversationId, userId },
      })
    : null;

  const lastUser = [...body.messages].reverse().find((m) => m.role === "user");
  const firstUserTitle = lastUser?.content.trim().slice(0, 40) || "新对话";

  const chatModel =
    body.chatModel || conv?.chatModel || defaultChatModel || process.env.DEFAULT_CHAT_MODEL || "gpt-5.4";
  const imageModel =
    body.imageModel || conv?.imageModel || defaultImageModel || process.env.DEFAULT_IMAGE_MODEL || "gpt-image-2";

  if (!conv) {
    conv = await prisma.conversation.create({
      data: { userId, chatModel, imageModel, title: firstUserTitle },
    });
    log.info("chat.conv.create", { userId, convId: conv.id });
  } else if (body.chatModel || body.imageModel || (conv.title === "新对话" && lastUser)) {
    conv = await prisma.conversation.update({
      where: { id: conv.id },
      data: {
        ...(body.chatModel ? { chatModel: body.chatModel } : {}),
        ...(body.imageModel ? { imageModel: body.imageModel } : {}),
        ...(conv.title === "新对话" && lastUser ? { title: firstUserTitle } : {}),
      },
    });
  }

  const hasFiles = body.files && body.files.length > 0;
  if (lastUser) {
    // 当 reload() 触发 regenerate 时,客户端会用已存在的 user message id 再次提交;
    // 此处按 id 查重,避免重复落库。新建消息(没有 id)走 create 分支。
    const existing = lastUser.id
      ? await prisma.message.findFirst({
          where: { id: lastUser.id, conversationId: conv.id },
          select: { id: true },
        })
      : null;
    if (!existing) {
      await prisma.message.create({
        data: {
          conversationId: conv.id,
          role: "user",
          content: lastUser.content,
          model: chatModel,
          ...(lastUser.id ? { id: lastUser.id } : {}),
          ...(hasFiles
            ? {
                attachments: {
                  userFiles: body.files!.map((f) => ({
                    name: f.name,
                    mimeType: f.mimeType,
                    size: f.size,
                  })),
                } as object,
              }
            : {}),
        },
      });
    }
  }

  log.info("chat.request", {
    userId,
    convId: conv.id,
    chatModel,
    imageModel,
    messageCount: body.messages.length,
    lastUserLen: lastUser?.content.length ?? 0,
    fileCount: body.files?.length ?? 0,
  });

  const upstreamLog = logger.child({ module: "openai-upstream", convId: conv.id });
  const loggedFetch: typeof fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    const method = init?.method ?? "GET";
    const bodyLen =
      typeof init?.body === "string"
        ? init.body.length
        : init?.body instanceof ArrayBuffer
          ? init.body.byteLength
          : init?.body instanceof Uint8Array
            ? init.body.byteLength
            : 0;
    const start = Date.now();
    upstreamLog.info("upstream.start", { url, method, bodyLen });
    try {
      const res = await fetch(input, init);
      upstreamLog.info("upstream.headers", {
        url,
        status: res.status,
        ok: res.ok,
        contentType: res.headers.get("content-type"),
        durationMs: Date.now() - start,
      });
      return res;
    } catch (e) {
      upstreamLog.error("upstream.error", {
        url,
        error: e,
        durationMs: Date.now() - start,
      });
      throw e;
    }
  };

  const provider = createOpenAI({
    apiKey,
    baseURL: `${baseUrl.replace(/\/+$/, "")}/v1`,
    compatibility: "compatible",
    fetch: loggedFetch,
  });

  const streamData = new StreamData();
  let dataClosed = false;
  const closeData = async () => {
    if (dataClosed) return;
    dataClosed = true;
    try {
      await streamData.close();
    } catch (e) {
      log.warn("chat.streamData.close_error", { convId: conv.id, error: e });
    }
  };

  const tools = buildImageTools({
    userId,
    baseUrl,
    apiKey,
    imageModel,
    streamData,
  });

  // Build CoreMessages — if the last user message has files, construct a parts-based content array.
  const lastMsg = body.messages[body.messages.length - 1];
  const lastMsgHasFiles = hasFiles && lastMsg?.role === "user";
  let coreMessages: CoreMessage[];
  if (lastMsgHasFiles) {
    const parts: ({ type: "text"; text: string } | { type: "image"; image: string; mimeType?: string } | { type: "file"; data: string; mimeType: string })[] = [];
    for (const f of body.files!) {
      if (f.mimeType.startsWith("image/")) {
        parts.push({ type: "image", image: f.data, mimeType: f.mimeType });
      } else if (f.mimeType.startsWith("text/")) {
        // OpenAI Chat Completions 的 `file` 部件不接受 text/*，AI SDK 会直接抛 UnsupportedFunctionalityError。
        // 改为读出文本内联成 TextPart，避免到上游前就被 SDK 自检拒绝。
        const raw = f.data.replace(/^data:[^;]+;base64,/, "");
        const text = Buffer.from(raw, "base64").toString("utf-8");
        parts.push({ type: "text", text: `[file: ${f.name}]\n${text}` });
      } else {
        // Strip "data:<mime>;base64," prefix — AI SDK expects raw base64 for FilePart.
        const raw = f.data.replace(/^data:[^;]+;base64,/, "");
        parts.push({ type: "file", data: raw, mimeType: f.mimeType });
      }
    }
    if (lastMsg.content) parts.push({ type: "text", text: lastMsg.content });

    const otherMsgs = convertToCoreMessages(
      body.messages.slice(0, -1).map((m) => ({
        role: m.role,
        content: m.content,
      })) as Parameters<typeof convertToCoreMessages>[0],
    );


    coreMessages = [...otherMsgs, { role: "user", content: parts } as CoreMessage];
  } else {
    coreMessages = convertToCoreMessages(
      body.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })) as Parameters<typeof convertToCoreMessages>[0],
    );

  }

  const result = streamText({
    model: provider(chatModel),
    messages: coreMessages,
    tools,
    maxSteps: 1,
    system:
      "你是一个通用 AI 助手。当用户明确要求生成、绘制、制作、设计图片/插图/海报/图标/头像时，调用 generate_image 工具；要求修改已有图片时调用 edit_image。只要用户消息包含 Original image URL，就必须调用 edit_image，并把该 URL 原样作为 image_url。调用图像工具时不要输出额外文字，前端会直接展示图片。其它情况直接回答，回答使用 Markdown，必要时用代码块和 LaTeX ($...$ / $$...$$)。对中文画图请求，转成英文 prompt 传给图像工具，并尽量扩写细节。",
    onStepFinish: ({ stepType, finishReason, toolCalls, toolResults, usage }) => {
      log.info("chat.step.finish", {
        userId,
        convId: conv!.id,
        stepType,
        finishReason,
        toolCallCount: toolCalls?.length ?? 0,
        toolResultCount: toolResults?.length ?? 0,
        usage,
      });
    },
    onError: ({ error }) => {
      log.error("chat.stream.error", {
        userId,
        convId: conv!.id,
        error,
        elapsedMs: Date.now() - reqStart,
      });
      void closeData();
    },
    onFinish: async ({ text, toolCalls, toolResults, usage, finishReason }) => {
      try {
        await prisma.message.create({
          data: {
            conversationId: conv!.id,
            role: "assistant",
            content: text ?? "",
            model: chatModel,
            toolCalls: toolCalls?.length
              ? (JSON.parse(JSON.stringify(toolCalls)) as object)
              : undefined,
            attachments: toolResults?.length
              ? (JSON.parse(JSON.stringify(toolResults)) as object)
              : undefined,
          },
        });
        await prisma.conversation.update({
          where: { id: conv!.id },
          data: { updatedAt: new Date() },
        });
        log.info("chat.finish", {
          userId,
          convId: conv!.id,
          finishReason,
          textLen: text?.length ?? 0,
          toolCalls: toolCalls?.length ?? 0,
          usage,
          totalMs: Date.now() - reqStart,
        });
      } catch (e) {
        log.error("chat.finish.persist_error", {
          userId,
          convId: conv!.id,
          error: e,
        });
      } finally {
        await closeData();
      }
    },
  });

  return result.toDataStreamResponse({
    data: streamData,
    headers: { "X-Conversation-Id": conv.id },
    getErrorMessage: (error) => {
      const msg = error instanceof Error ? error.message : String(error);
      log.error("chat.stream.errorMessage", {
        userId,
        convId: conv!.id,
        message: msg,
      });
      void closeData();
      return msg;
    },
  });
}
