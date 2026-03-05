"use server";
import { openai, createOpenAI } from "@ai-sdk/openai";
import { createXai, xai } from "@ai-sdk/xai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { ModelMessage, generateImage, generateText } from "ai";
import logger from "logger";

type GenerateImageOptions = {
  messages?: ModelMessage[];
  prompt: string;
  abortSignal?: AbortSignal;
  /** Override API key (falls back to env var) */
  apiKey?: string | null;
  /** Override model name (falls back to default) */
  model?: string | null;
};

type GeneratedImage = {
  base64: string;
  mimeType?: string;
};

export type GeneratedImageResult = {
  images: GeneratedImage[];
};

export async function generateImageWithOpenAI(
  options: GenerateImageOptions,
): Promise<GeneratedImageResult> {
  const provider = options.apiKey
    ? createOpenAI({ apiKey: options.apiKey })
    : openai;
  const modelName = options.model || "gpt-image-1-mini";
  return generateImage({
    model: provider.image(modelName),
    abortSignal: options.abortSignal,
    prompt: options.prompt,
  }).then((res) => {
    return {
      images: res.images.map((v) => {
        const item: GeneratedImage = {
          base64: Buffer.from(v.uint8Array).toString("base64"),
          mimeType: v.mediaType,
        };
        return item;
      }),
    };
  });
}

export async function generateImageWithXAI(
  options: GenerateImageOptions,
): Promise<GeneratedImageResult> {
  const provider = options.apiKey ? createXai({ apiKey: options.apiKey }) : xai;
  const modelName = options.model || "grok-2-image";
  return generateImage({
    model: provider.image(modelName),
    abortSignal: options.abortSignal,
    prompt: options.prompt,
  }).then((res) => {
    return {
      images: res.images.map((v) => ({
        base64: Buffer.from(v.uint8Array).toString("base64"),
        mimeType: v.mediaType,
      })),
    };
  });
}

/**
 * Generate images using Google's Gemini image models via the AI SDK.
 * Supports both prompt-only and message-context-based generation (for editing).
 */
export const generateImageWithGoogle = async (
  options: GenerateImageOptions,
): Promise<GeneratedImageResult> => {
  const apiKey = options.apiKey || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is not set");
  }

  const modelName = options.model || "gemini-2.5-flash-image";
  const googleProvider = createGoogleGenerativeAI({ apiKey });

  // Use provided messages for edit/composite context, or build a single user message from the prompt
  const messages: ModelMessage[] = options.messages?.length
    ? options.messages
    : [{ role: "user", content: options.prompt || "Generate an image" }];

  const result = await generateText({
    model: googleProvider(modelName),
    abortSignal: options.abortSignal,
    messages,
  }).catch((err) => {
    logger.error(err);
    throw err;
  });

  return {
    images: result.files
      .filter((f) => f.mediaType.startsWith("image/"))
      .map((f) => ({
        base64: Buffer.from(f.uint8Array).toString("base64"),
        mimeType: f.mediaType,
      })),
  };
};
