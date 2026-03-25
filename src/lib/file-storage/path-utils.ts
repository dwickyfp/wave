export const sanitizePathSegment = (segment: string) => {
  return segment.replace(/[^a-zA-Z0-9._-]/g, "_") || "file";
};

export const sanitizeFilename = (filename: string) => {
  const base = filename.split(/[/\\]/).pop() ?? "file";
  return sanitizePathSegment(base);
};

export const sanitizeStoragePath = (pathname: string) => {
  const segments = pathname
    .split(/[\\/]+/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .filter((segment) => segment !== "." && segment !== "..")
    .map(sanitizePathSegment);

  if (segments.length === 0) {
    return "file";
  }

  return segments.join("/");
};
