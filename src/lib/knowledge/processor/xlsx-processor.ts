import * as XLSX from "xlsx";

export function processXlsx(buffer: Buffer): string {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const parts: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, {
      header: 1,
      defval: "",
    });

    if (rows.length === 0) continue;

    parts.push(`## Sheet: ${sheetName}\n`);

    // Build markdown table from rows
    const [header, ...dataRows] = rows as string[][];
    if (!header || header.length === 0) continue;

    const colCount = header.length;
    parts.push(`| ${header.join(" | ")} |`);
    parts.push(`| ${Array(colCount).fill("---").join(" | ")} |`);

    for (const row of dataRows) {
      const cells = Array(colCount)
        .fill("")
        .map((_, i) => String(row[i] ?? "").replace(/\|/g, "\\|"));
      parts.push(`| ${cells.join(" | ")} |`);
    }

    parts.push("");
  }

  return parts.join("\n");
}
