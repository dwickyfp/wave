import {
  FilePart,
  ImagePart,
  ModelMessage,
  ToolApprovalResponse,
  ToolResultPart,
  Tool,
  tool as createTool,
  generateText,
  generateImage,
} from "ai";
import {
  generateImageWithGoogle,
  generateImageWithXAI,
} from "lib/ai/image/generate-image";
import { serverFileStorage } from "lib/file-storage";
import { buildChatGeneratedImageUploadPath } from "lib/file-storage/upload-policy";
import z from "zod";
import { ImageToolName } from "..";
import { openai, createOpenAI } from "@ai-sdk/openai";
import { toAny } from "lib/utils";

export type ImageToolResult = {
  images: {
    url: string;
    mimeType?: string;
  }[];
  mode?: "create" | "edit" | "composite";
  guide?: string;
  model: string;
};

type ImageStorageContext = {
  userId: string;
  threadId?: string | null;
};

function getImageExtension(mimeType?: string) {
  const normalized = mimeType?.split(";", 1)[0]?.trim().toLowerCase();

  switch (normalized) {
    case "image/jpeg":
      return "jpg";
    case "image/svg+xml":
      return "svg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/png":
    default:
      return "png";
  }
}

/**
 * Creates a dynamic image generation tool backed by a DB-configured provider/model.
 * Dispatches to the appropriate SDK based on providerName.
 */
export function createDbImageTool(
  providerName: string,
  modelApiName: string,
  apiKey: string | null | undefined,
  baseUrl?: string | null,
  storageContext?: ImageStorageContext,
): Tool {
  const DESCRIPTION = `Generate, edit, or composite images based on the conversation context. This tool automatically analyzes recent messages to create images without requiring explicit input parameters. It includes all user-uploaded images from the recent conversation and only the most recent AI-generated image to avoid confusion. Use the 'mode' parameter to specify the operation type: 'create' for new images, 'edit' for modifying existing images, or 'composite' for combining multiple images. Use this when the user requests image creation, modification, or visual content generation.`;

  const uploadGeneratedImage = async (
    base64: string,
    mimeType: string,
    index: number,
  ) => {
    const filename = storageContext
      ? buildChatGeneratedImageUploadPath({
          userId: storageContext.userId,
          threadId: storageContext.threadId,
          filename: `image-${index}.${getImageExtension(mimeType)}`,
        })
      : undefined;

    const uploaded = await serverFileStorage
      .upload(Buffer.from(base64, "base64"), {
        ...(filename ? { filename } : {}),
        contentType: mimeType,
      })
      .catch(() => {
        throw new Error(
          "Image generation was successful, but file upload failed. Please check your file upload configuration and try again.",
        );
      });

    const buf = await serverFileStorage.download(uploaded.key);

    return {
      url: `data:${mimeType};base64,${buf.toString("base64")}`,
      mimeType,
    };
  };

  const uploadAndBase64 = async (
    generatedImages: { base64: string; mimeType?: string }[],
  ) =>
    Promise.all(
      generatedImages.map((image, index) =>
        uploadGeneratedImage(
          image.base64,
          image.mimeType ?? "image/png",
          index + 1,
        ),
      ),
    );

  const extractPrompt = (messages: ModelMessage[]): string => {
    const last = [...messages].reverse().find((m) => m.role === "user");
    if (!last) return "";
    const content = last.content;
    if (typeof content === "string") return content;
    return (content as any[])
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join(" ");
  };

  return createTool({
    description: DESCRIPTION,
    inputSchema: z.object({
      mode: z
        .enum(["create", "edit", "composite"])
        .optional()
        .default("create")
        .describe(
          "Image generation mode: 'create' for new images, 'edit' for modifying existing images, 'composite' for combining multiple images",
        ),
    }),
    execute: async ({ mode }, { messages, abortSignal }) => {
      const provider = providerName.toLowerCase();

      // ── Google (Gemini) — uses @ai-sdk/google + generateText ────────────
      if (provider === "google") {
        let hasFoundImage = false;
        const latestMessages = messages
          .slice(-6)
          .reverse()
          .map((m) => {
            if (m.role !== "tool") return m;
            if (hasFoundImage) return m;
            const fileParts = m.content.flatMap(
              convertToImageToolPartToFilePart,
            );
            if (fileParts.length === 0) return m;
            hasFoundImage = true;
            return { ...m, role: "assistant", content: fileParts };
          })
          .filter((v) => Boolean((v as any)?.content?.length))
          .reverse() as ModelMessage[];

        const generated = await generateImageWithGoogle({
          prompt: "",
          abortSignal,
          messages: latestMessages,
          apiKey,
          model: modelApiName,
        });
        const resultImages = await uploadAndBase64(generated.images);
        return {
          images: resultImages,
          mode,
          model: modelApiName,
          guide:
            resultImages.length > 0
              ? "The image has been successfully generated and is now displayed above. If you need any edits, modifications, or adjustments to the image, please let me know."
              : "I apologize, but the image generation was not successful. Please provide more specific details about what you'd like to see.",
        } satisfies ImageToolResult;
      }

      // ── OpenAI — uses native imageGeneration tool via generateText ───────
      if (provider === "openai") {
        const openaiProvider = apiKey ? createOpenAI({ apiKey }) : openai;
        const imageGenerationTool = openaiProvider.tools.imageGeneration({
          outputFormat: "webp",
          model: modelApiName,
        }) as unknown as Tool;
        let hasFoundImage = false;
        const latestMessages = messages
          .slice(-6)
          .reverse()
          .flatMap((m) => {
            if (m.role !== "tool") return m;
            if (hasFoundImage) return m;
            const imageParts = m.content.flatMap(
              convertToImageToolPartToImagePart,
            );
            if (imageParts.length === 0) return m;
            hasFoundImage = true;
            return [{ role: "user", content: imageParts }, m] as ModelMessage[];
          })
          .filter((v) => Boolean((v as any)?.content?.length))
          .reverse() as ModelMessage[];

        const result = await generateText({
          model: openaiProvider("gpt-4.1-mini"),
          abortSignal,
          messages: latestMessages,
          tools: {
            image_generation: imageGenerationTool,
          },
          toolChoice: "required",
        });

        for (const toolResult of result.staticToolResults) {
          if (toolResult.toolName === "image_generation") {
            const base64Image = toolResult.output.result;
            const mimeType = "image/webp";
            return {
              images: [await uploadGeneratedImage(base64Image, mimeType, 1)],
              mode,
              model: modelApiName,
              guide:
                "The image has been successfully generated and is now displayed above. If you need any edits, modifications, or adjustments to the image, please let me know.",
            } satisfies ImageToolResult;
          }
        }
        return { images: [], mode, model: modelApiName, guide: "" };
      }

      // ── xAI (Grok) — prompt-based ────────────────────────────────────────
      if (provider === "xai") {
        const prompt = extractPrompt(messages);
        const generated = await generateImageWithXAI({
          prompt,
          abortSignal,
          apiKey,
          model: modelApiName,
        });
        const resultImages = await uploadAndBase64(generated.images);
        return {
          images: resultImages,
          mode,
          model: modelApiName,
          guide:
            resultImages.length > 0
              ? "The image has been successfully generated and is now displayed above. If you need any edits, modifications, or adjustments to the image, please let me know."
              : "Image generation was not successful. Please try again with a more specific prompt.",
        } satisfies ImageToolResult;
      }

      // ── OpenRouter — chat/completions with modalities parameter ──────────
      // OpenRouter image models (Flux, Gemini, etc.) do NOT support the
      // /v1/images/generations endpoint. They require /api/v1/chat/completions
      // with `modalities: ["image", "text"]` or `["image"]`.
      if (provider === "openrouter") {
        const prompt = extractPrompt(messages);
        const openrouterBaseUrl =
          baseUrl?.replace(/\/$/, "") ?? "https://openrouter.ai/api/v1";
        const response = await fetch(`${openrouterBaseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey ?? ""}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: modelApiName,
            messages: [{ role: "user", content: prompt }],
            modalities: ["image", "text"],
          }),
          signal: abortSignal,
        });

        if (!response.ok) {
          const errorBody = await response.text().catch(() => "");
          throw new Error(
            `OpenRouter image generation failed (${response.status}): ${errorBody}`,
          );
        }

        const data = await response.json();
        const message = data?.choices?.[0]?.message;
        const rawImages: { image_url?: { url?: string } }[] =
          message?.images ?? [];

        if (!rawImages.length) {
          return { images: [], mode, model: modelApiName, guide: "" };
        }

        // OpenRouter returns data:image/...;base64,... URLs
        const rawBase64Images = rawImages
          .map((img) => {
            const dataUrl = img?.image_url?.url ?? "";
            const match = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
            if (!match) return null;
            return { base64: match[2], mimeType: match[1] };
          })
          .filter(Boolean) as { base64: string; mimeType: string }[];
        const resultImages = await uploadAndBase64(rawBase64Images);

        return {
          images: resultImages,
          mode,
          model: modelApiName,
          guide:
            resultImages.length > 0
              ? "The image has been successfully generated and is now displayed above. If you need any edits, modifications, or adjustments to the image, please let me know."
              : "Image generation was not successful. Please try again with a more specific prompt.",
        } satisfies ImageToolResult;
      }

      // ── Fallback: OpenAI-compatible prompt-based ─────────────────────────
      const compatProvider = createOpenAI({
        apiKey: apiKey ?? "",
        baseURL: baseUrl ?? undefined,
      });
      const prompt = extractPrompt(messages);
      const result = await generateImage({
        model: compatProvider.image(modelApiName),
        prompt,
        abortSignal,
      });
      const resultImages = await uploadAndBase64(
        result.images.map((img) => ({
          base64: Buffer.from(img.uint8Array).toString("base64"),
          mimeType: img.mediaType,
        })),
      );
      return {
        images: resultImages,
        mode,
        model: modelApiName,
        guide:
          resultImages.length > 0
            ? "The image has been successfully generated and is now displayed above. If you need any edits, modifications, or adjustments to the image, please let me know."
            : "Image generation was not successful. Please try again with a more specific prompt.",
      } satisfies ImageToolResult;
    },
  });
}

function convertToImageToolPartToImagePart(
  part: ToolResultPart | ToolApprovalResponse,
): ImagePart[] {
  if (part.type !== "tool-result") return [];
  if (part.toolName !== ImageToolName) return [];
  if (!toAny(part).output?.value?.images?.length) return [];
  const result = toAny(part.output).value as ImageToolResult;
  return result.images.map((image) => ({
    type: "image",
    image: image.url,
    mediaType: image.mimeType,
  }));
}

function convertToImageToolPartToFilePart(
  part: ToolResultPart | ToolApprovalResponse,
): FilePart[] {
  if (part.type !== "tool-result") return [];
  if (part.toolName !== ImageToolName) return [];
  if (!toAny(part).output?.value?.images?.length) return [];
  const result = toAny(part.output).value as ImageToolResult;
  return result.images.map((image) => ({
    type: "file",
    mediaType: image.mimeType!,
    data: image.url,
  }));
}
