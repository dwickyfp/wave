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
  generateImageWithNanoBanana,
  generateImageWithXAI,
} from "lib/ai/image/generate-image";
import { serverFileStorage } from "lib/file-storage";
import { safe, watchError } from "ts-safe";
import z from "zod";
import { ImageToolName } from "..";
import logger from "logger";
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

export const nanoBananaTool = createTool({
  description: `Generate, edit, or composite images based on the conversation context. This tool automatically analyzes recent messages to create images without requiring explicit input parameters. It includes all user-uploaded images from the recent conversation and only the most recent AI-generated image to avoid confusion. Use the 'mode' parameter to specify the operation type: 'create' for new images, 'edit' for modifying existing images, or 'composite' for combining multiple images. Use this when the user requests image creation, modification, or visual content generation.`,
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
    try {
      let hasFoundImage = false;

      // Get latest 6 messages and extract only the most recent image for editing context
      // This prevents multiple image references that could confuse the image generation model
      const latestMessages = messages
        .slice(-6)
        .reverse()
        .map((m) => {
          if (m.role != "tool") return m;
          if (hasFoundImage) return m; // Skip if we already found an image
          const fileParts = m.content.flatMap(convertToImageToolPartToFilePart);
          if (fileParts.length === 0) return m;
          hasFoundImage = true; // Mark that we found the most recent image
          return {
            ...m,
            role: "assistant",
            content: fileParts,
          };
        })
        .filter((v) => Boolean(v?.content?.length))
        .reverse() as ModelMessage[];

      const images = await generateImageWithNanoBanana({
        prompt: "",
        abortSignal,
        messages: latestMessages,
      });

      const resultImages = await safe(images.images)
        .map((imgs) =>
          Promise.all(
            imgs.map(async (image) => {
              const mimeType = image.mimeType ?? "image/png";
              const uploaded = await serverFileStorage.upload(
                Buffer.from(image.base64, "base64"),
                { contentType: mimeType },
              );
              const buf = await serverFileStorage.download(uploaded.key);
              return {
                url: `data:${mimeType};base64,${buf.toString("base64")}`,
                mimeType,
              };
            }),
          ),
        )
        .watch(
          watchError((e) => {
            logger.error(e);
            logger.info("upload/download image failed");
          }),
        )
        .unwrap();

      return {
        images: resultImages,
        mode,
        model: "gemini-2.5-flash-image",
        guide:
          resultImages.length > 0
            ? "The image has been successfully generated and is now displayed above. If you need any edits, modifications, or adjustments to the image, please let me know."
            : "I apologize, but the image generation was not successful. To help me create a better image for you, could you please provide more specific details about what you'd like to see? For example:\n\n• What style are you looking for? (realistic, cartoon, abstract, etc.)\n• What colors or mood should the image have?\n• Are there any specific objects, people, or scenes you want included?\n• What size or format would work best for your needs?\n\nPlease share these details and I'll try generating the image again with your specifications.",
      };
    } catch (e) {
      logger.error(e);
      throw e;
    }
  },
});

export const openaiImageTool = createTool({
  description: `Generate, edit, or composite images based on the conversation context. This tool automatically analyzes recent messages to create images without requiring explicit input parameters. It includes all user-uploaded images from the recent conversation and only the most recent AI-generated image to avoid confusion. Use the 'mode' parameter to specify the operation type: 'create' for new images, 'edit' for modifying existing images, or 'composite' for combining multiple images. Use this when the user requests image creation, modification, or visual content generation.`,
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
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not set");
    }

    let hasFoundImage = false;
    const latestMessages = messages
      .slice(-6)
      .reverse()
      .flatMap((m) => {
        if (m.role != "tool") return m;
        if (hasFoundImage) return m; // Skip if we already found an image)
        const fileParts = m.content.flatMap(convertToImageToolPartToImagePart);
        if (fileParts.length === 0) return m;
        hasFoundImage = true; // Mark that we found the most recent image
        return [
          {
            role: "user",
            content: fileParts,
          },
          m,
        ] as ModelMessage[];
      })
      .filter((v) => Boolean(v?.content?.length))
      .reverse() as ModelMessage[];
    const result = await generateText({
      model: openai("gpt-4.1-mini"),
      abortSignal,
      messages: latestMessages,
      tools: {
        image_generation: openai.tools.imageGeneration({
          outputFormat: "webp",
          model: "gpt-image-1-mini",
        }),
      },
      toolChoice: "required",
    });

    for (const toolResult of result.staticToolResults) {
      if (toolResult.toolName === "image_generation") {
        const base64Image = toolResult.output.result;
        const mimeType = "image/webp";
        const uploaded = await serverFileStorage.upload(
          Buffer.from(base64Image, "base64"),
          { contentType: mimeType },
        );
        const buf = await serverFileStorage.download(uploaded.key);
        return {
          images: [
            {
              url: `data:${mimeType};base64,${buf.toString("base64")}`,
              mimeType,
            },
          ],
          mode,
          model: "gpt-image-1-mini",
          guide:
            "The image has been successfully generated and is now displayed above. If you need any edits, modifications, or adjustments to the image, please let me know.",
        };
      }
    }
    return {
      images: [],
      mode,
      model: "gpt-image-1-mini",
      guide: "",
    };
  },
});

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

/**
 * Creates a dynamic image generation tool backed by a DB-configured provider/model.
 * Dispatches to the appropriate SDK based on providerName.
 */
export function createDbImageTool(
  providerName: string,
  modelApiName: string,
  apiKey: string | null | undefined,
  baseUrl?: string | null,
): Tool {
  const DESCRIPTION = `Generate, edit, or composite images based on the conversation context. This tool automatically analyzes recent messages to create images without requiring explicit input parameters. It includes all user-uploaded images from the recent conversation and only the most recent AI-generated image to avoid confusion. Use the 'mode' parameter to specify the operation type: 'create' for new images, 'edit' for modifying existing images, or 'composite' for combining multiple images. Use this when the user requests image creation, modification, or visual content generation.`;

  const uploadAndBase64 = async (
    generatedImages: { base64: string; mimeType?: string }[],
  ) =>
    Promise.all(
      generatedImages.map(async (image) => {
        const mimeType = image.mimeType ?? "image/png";
        const uploaded = await serverFileStorage
          .upload(Buffer.from(image.base64, "base64"), {
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
      }),
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

      // Google (Gemini) — passes full message context
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

        const generated = await generateImageWithNanoBanana({
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

      // OpenAI — uses native imageGeneration tool via generateText
      if (provider === "openai") {
        const openaiProvider = apiKey ? createOpenAI({ apiKey }) : openai;
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
            image_generation: openaiProvider.tools.imageGeneration({
              outputFormat: "webp",
              model: modelApiName,
            }),
          },
          toolChoice: "required",
        });

        for (const toolResult of result.staticToolResults) {
          if (toolResult.toolName === "image_generation") {
            const base64Image = toolResult.output.result;
            const mimeType = "image/webp";
            const uploaded = await serverFileStorage
              .upload(Buffer.from(base64Image, "base64"), {
                contentType: mimeType,
              })
              .catch(() => {
                throw new Error(
                  "Image generation was successful, but file upload failed. Please check your file upload configuration and try again.",
                );
              });
            const buf = await serverFileStorage.download(uploaded.key);
            return {
              images: [
                {
                  url: `data:${mimeType};base64,${buf.toString("base64")}`,
                  mimeType,
                },
              ],
              mode,
              model: modelApiName,
              guide:
                "The image has been successfully generated and is now displayed above. If you need any edits, modifications, or adjustments to the image, please let me know.",
            } satisfies ImageToolResult;
          }
        }
        return { images: [], mode, model: modelApiName, guide: "" };
      }

      // xAI (Grok) — prompt-based
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

      // OpenRouter — uses chat completions with modalities parameter
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

        // OpenRouter returns data:image/...;base64,... URLs — upload to MinIO then serve back as base64
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

      // Fallback: OpenAI-compatible prompt-based (e.g. local SDXLs, custom endpoints)
      // Note: createOpenAICompatible does not expose .image(); use createOpenAI
      // with a custom baseURL instead, which works for any OpenAI-compatible endpoint.
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
