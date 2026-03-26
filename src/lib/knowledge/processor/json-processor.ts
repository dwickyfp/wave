export function processJson(input: Buffer | string): string {
  const raw = Buffer.isBuffer(input) ? input.toString("utf-8") : input;
  try {
    const parsed = JSON.parse(raw);
    const pretty = JSON.stringify(parsed, null, 2);
    return ["# JSON Document", "", "```json", pretty, "```", ""].join("\n");
  } catch {
    return ["# JSON Document", "", "```json", raw.trim(), "```", ""].join("\n");
  }
}
