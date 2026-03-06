import path from "node:path";
import { del, head, put } from "@vercel/blob";
import { FileNotFoundError } from "lib/errors";
import type {
  FileMetadata,
  FileStorage,
  UploadOptions,
} from "./file-storage.interface";
import {
  resolveStoragePrefix,
  sanitizeFilename,
  toBuffer,
} from "./storage-utils";
import { generateUUID } from "lib/utils";

const STORAGE_PREFIX = resolveStoragePrefix();

export interface VercelBlobStorageConfig {
  token?: string;
}

const buildPathname = (filename: string) => {
  const safeName = sanitizeFilename(filename);
  const id = generateUUID();
  const prefix = STORAGE_PREFIX ? `${STORAGE_PREFIX}/` : "";
  return path.posix.join(prefix, `${id}-${safeName}`);
};

const mapMetadata = (
  key: string,
  info: { contentType: string; size: number; uploadedAt?: Date },
) =>
  ({
    key,
    filename: path.posix.basename(key),
    contentType: info.contentType,
    size: info.size,
    uploadedAt: info.uploadedAt,
  }) satisfies FileMetadata;

const fetchSourceBuffer = async (url: string) => {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    if (response.status === 404) {
      throw new FileNotFoundError(url);
    }
    throw new Error(`Failed to download blob. Status: ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
};

export const createVercelBlobStorage = (
  cfg?: VercelBlobStorageConfig,
): FileStorage => {
  const token = cfg?.token || process.env.BLOB_READ_WRITE_TOKEN;
  const tokenOpt = token ? { token } : {};

  const getHead = async (key: string) => {
    try {
      return await head(key, tokenOpt);
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "BlobNotFoundError") {
        throw new FileNotFoundError(key, error);
      }
      throw error;
    }
  };

  return {
    async upload(content, options: UploadOptions = {}) {
      const buffer = await toBuffer(content);
      const filename = options.filename ?? "file";
      const pathname = buildPathname(filename);

      const result = await put(pathname, buffer, {
        access: "public",
        contentType: options.contentType,
        ...tokenOpt,
      });

      const metadata: FileMetadata = {
        key: result.pathname,
        filename: path.posix.basename(result.pathname),
        contentType: result.contentType,
        size: buffer.byteLength,
        uploadedAt: new Date(),
      };

      return {
        key: result.pathname,
        sourceUrl: result.url,
        metadata,
      };
    },

    // Vercel Blob uses handleUpload flow instead of createUploadUrl
    async createUploadUrl() {
      return null;
    },

    async download(key) {
      const info = await getHead(key);
      return fetchSourceBuffer(info.url);
    },

    async delete(key) {
      await del(key, tokenOpt);
    },

    async exists(key) {
      try {
        await getHead(key);
        return true;
      } catch (error: unknown) {
        if (error instanceof FileNotFoundError) {
          return false;
        }
        throw error;
      }
    },

    async getMetadata(key) {
      try {
        const info = await getHead(key);
        return mapMetadata(key, {
          contentType: info.contentType,
          size: info.size,
          uploadedAt: info.uploadedAt,
        });
      } catch (error: unknown) {
        if (error instanceof FileNotFoundError) {
          return null;
        }
        throw error;
      }
    },

    async getSourceUrl(key) {
      try {
        const info = await getHead(key);
        return info.url;
      } catch (error: unknown) {
        if (error instanceof FileNotFoundError) {
          return null;
        }
        throw error;
      }
    },

    async getDownloadUrl(key) {
      try {
        const info = await getHead(key);
        return info.downloadUrl ?? info.url;
      } catch (error: unknown) {
        if (error instanceof FileNotFoundError) {
          return null;
        }
        throw error;
      }
    },
  } satisfies FileStorage;
};
