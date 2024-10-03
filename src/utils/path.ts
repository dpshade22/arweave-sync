export function join(...parts: string[]): string {
  return parts.join("/").replace(/\/+/g, "/");
}

export function dirname(path: string): string {
  return path.replace(/\/+$/, "").replace(/\/[^\/]*$/, "");
}

export function basename(path: string): string {
  return path.split("/").pop() || "";
}
