import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const extensionRoot = path.join(repoRoot, "extensions", "emma-pilot");
const sourceRoot = path.join(extensionRoot, "src");
const releaseRoot = path.join(repoRoot, "public", "emma-pilot", "releases");
const packageJsonPath = path.join(repoRoot, "package.json");
const esbuildBin = path.join(repoRoot, "node_modules", ".bin", "esbuild");

function normalizeOrigin(value?: string) {
  return (value || "http://localhost:3000").replace(/\/+$/, "");
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
}

async function ensureEmptyDir(dirPath: string) {
  await fs.rm(dirPath, { recursive: true, force: true });
  await fs.mkdir(dirPath, { recursive: true });
}

async function copyFile(source: string, destination: string) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(source, destination);
}

function zipDirectory(sourceDir: string, outputPath: string) {
  execFileSync("zip", ["-rq", outputPath, "."], {
    cwd: sourceDir,
    stdio: "inherit",
  });
}

function buildSidepanelBundle(outputDir: string) {
  execFileSync(
    esbuildBin,
    [
      path.join(sourceRoot, "sidepanel.tsx"),
      "--bundle",
      "--format=esm",
      "--platform=browser",
      "--target=chrome116,edge116",
      "--jsx=automatic",
      `--outfile=${path.join(outputDir, "sidepanel.js")}`,
      "--log-level=warning",
    ],
    {
      cwd: repoRoot,
      stdio: "inherit",
    },
  );
}

async function buildBrowserPackage(options: {
  browser: "chrome" | "edge";
  backendOrigin: string;
  version: string;
}) {
  const baseManifest = await readJson<Record<string, any>>(
    path.join(extensionRoot, "manifest.base.json"),
  );
  const overlayManifest = await readJson<Record<string, any>>(
    path.join(extensionRoot, `manifest.${options.browser}.json`),
  );

  const outputDir = path.join(releaseRoot, options.browser);
  await ensureEmptyDir(outputDir);
  await copyFile(
    path.join(sourceRoot, "background.js"),
    path.join(outputDir, "background.js"),
  );
  await copyFile(
    path.join(sourceRoot, "content-script.js"),
    path.join(outputDir, "content-script.js"),
  );
  await copyFile(
    path.join(sourceRoot, "sidepanel.html"),
    path.join(outputDir, "sidepanel.html"),
  );
  buildSidepanelBundle(outputDir);

  const manifest = {
    ...baseManifest,
    ...overlayManifest,
    version: options.version,
    host_permissions: [`${options.backendOrigin}/*`],
  };

  await fs.writeFile(
    path.join(outputDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  await fs.writeFile(
    path.join(outputDir, "runtime-config.json"),
    `${JSON.stringify(
      {
        backendOrigin: options.backendOrigin,
        browser: options.browser,
        version: options.version,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  await copyFile(
    path.join(repoRoot, "src", "app", "favicon-16x16.png"),
    path.join(outputDir, "icons", "icon16.png"),
  );
  await copyFile(
    path.join(repoRoot, "src", "app", "favicon-32x32.png"),
    path.join(outputDir, "icons", "icon32.png"),
  );
  await copyFile(
    path.join(repoRoot, "src", "app", "favicon-96x96.png"),
    path.join(outputDir, "icons", "icon48.png"),
  );
  await copyFile(
    path.join(repoRoot, "src", "app", "web-app-manifest-192x192.png"),
    path.join(outputDir, "icons", "icon128.png"),
  );

  const zipPath = path.join(releaseRoot, `${options.browser}.zip`);
  await fs.rm(zipPath, { force: true });
  zipDirectory(outputDir, zipPath);

  return {
    packagePath: zipPath,
    downloadUrl: `/emma-pilot/releases/${options.browser}.zip`,
  };
}

async function main() {
  const packageJson = await readJson<{ version: string }>(packageJsonPath);
  const version =
    process.env.EMMA_PILOT_EXTENSION_VERSION || packageJson.version;
  const backendOrigin = normalizeOrigin(
    process.env.EMMA_PILOT_BACKEND_ORIGIN ||
      process.env.BETTER_AUTH_URL ||
      process.env.NEXT_PUBLIC_BASE_URL,
  );

  await fs.mkdir(releaseRoot, { recursive: true });

  const [chrome, edge] = await Promise.all([
    buildBrowserPackage({
      browser: "chrome",
      backendOrigin,
      version,
    }),
    buildBrowserPackage({
      browser: "edge",
      backendOrigin,
      version,
    }),
  ]);

  await fs.writeFile(
    path.join(releaseRoot, "latest.json"),
    `${JSON.stringify(
      {
        version,
        generatedAt: new Date().toISOString(),
        chrome,
        edge,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  console.info("Emma Pilot extension packages built in", releaseRoot);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
