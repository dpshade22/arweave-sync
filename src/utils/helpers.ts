export function getFolderPath(filePath: string): string {
  return filePath.substring(0, filePath.lastIndexOf("/"));
}

export function getFileName(filePath: string): string {
  return filePath.substring(filePath.lastIndexOf("/") + 1);
}
