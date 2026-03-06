import { streamObject } from "ai";
import { ChatModel } from "app-types/chat";
import { SkillGenerateSchema } from "app-types/skill";
import { getSession } from "auth/server";
import { buildSkillGenerationPrompt } from "lib/ai/prompts";
import { getDbModel } from "lib/ai/provider-factory";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

async function buildLocalSkillPatternHints() {
  const skillsDir = join(process.cwd(), "awesome-copilot/skills");
  try {
    const entries = await readdir(skillsDir, { withFileTypes: true });
    const skillDirs = entries
      .filter((entry) => entry.isDirectory())
      .slice(0, 8);

    const hints: string[] = [];

    for (const dir of skillDirs) {
      const skillPath = join(skillsDir, dir.name, "SKILL.md");
      const raw = await readFile(skillPath, "utf-8").catch(() => "");
      if (!raw) continue;

      const hasFrontmatter = /^---[\s\S]*?---/.test(raw);
      const body = raw.replace(/^---[\s\S]*?---\n?/, "").trim();
      const headings = (body.match(/^##?\s+.+$/gm) ?? []).slice(0, 3);

      hints.push(
        `- ${dir.name}: frontmatter=${hasFrontmatter ? "yes" : "no"}; headings=${headings.join(" | ") || "none"}`,
      );
    }

    return hints.join("\n");
  } catch {
    return "";
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return new Response("Unauthorized", { status: 401 });
    }

    const json = await request.json();
    const { chatModel, message = "Create a new skill" } = json as {
      chatModel?: ChatModel;
      message: string;
    };

    const dbModelResult = await getDbModel(chatModel);
    if (!dbModelResult) {
      return Response.json(
        {
          message:
            "Model is not configured. Please set it up in Settings → AI Providers.",
        },
        { status: 503 },
      );
    }

    const patternHints = await buildLocalSkillPatternHints();

    const result = streamObject({
      model: dbModelResult.model,
      system: buildSkillGenerationPrompt(patternHints),
      prompt: message,
      schema: SkillGenerateSchema,
    });

    return result.toTextStreamResponse();
  } catch {
    return Response.json(
      { error: "Failed to generate skill" },
      { status: 500 },
    );
  }
}
