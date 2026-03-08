import { promises as fs } from "node:fs";
import path from "node:path";
import { BASE_URL } from "lib/const";

const RELEASE_METADATA_PATH = path.join(
  process.cwd(),
  "public",
  "emma-pilot",
  "releases",
  "latest.json",
);

type ReleaseMetadata = {
  version: string;
  generatedAt: string;
  chrome: {
    downloadUrl: string | null;
    packagePath: string | null;
  };
  edge: {
    downloadUrl: string | null;
    packagePath: string | null;
  };
};

export function getPilotBackendOrigin() {
  return BASE_URL;
}

export async function getPilotReleaseMetadata(): Promise<ReleaseMetadata> {
  try {
    const raw = await fs.readFile(RELEASE_METADATA_PATH, "utf8");
    const parsed = JSON.parse(raw) as ReleaseMetadata;
    return parsed;
  } catch {
    return {
      version: "0.0.0",
      generatedAt: new Date(0).toISOString(),
      chrome: {
        downloadUrl: null,
        packagePath: null,
      },
      edge: {
        downloadUrl: null,
        packagePath: null,
      },
    };
  }
}
