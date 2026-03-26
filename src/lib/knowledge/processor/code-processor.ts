import { detectCodeLanguage } from "../content-routing";

export function processCode(input: Buffer | string, filename?: string | null) {
  const raw = Buffer.isBuffer(input) ? input.toString("utf-8") : input;
  const language = detectCodeLanguage(filename) ?? "text";
  const title = filename?.trim() || "Code File";

  return [`# ${title}`, "", `\`\`\`${language}`, raw.trim(), "```", ""].join(
    "\n",
  );
}
