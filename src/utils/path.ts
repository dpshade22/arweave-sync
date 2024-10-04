export function join(...parts: string[]): string {
  return parts.join("/").replace(/\/+/g, "/");
}

export function dirname(path: string): string {
  return path.replace(/\/+$/, "").replace(/\/[^\/]*$/, "");
}

export function basename(path: string): string {
  return path.split("/").pop() || "";
}

export function relative(from: string, to: string): string {
  const fromParts = from.split("/").filter(Boolean);
  const toParts = to.split("/").filter(Boolean);

  let commonLength = 0;
  for (let i = 0; i < Math.min(fromParts.length, toParts.length); i++) {
    if (fromParts[i] !== toParts[i]) break;
    commonLength++;
  }

  const upCount = fromParts.length - commonLength;
  const downParts = toParts.slice(commonLength);

  const relativePath = [...Array(upCount).fill(".."), ...downParts];
  return relativePath.join("/") || ".";
}
