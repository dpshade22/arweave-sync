export function getFolderPath(filePath: string): string {
  return filePath.substring(0, filePath.lastIndexOf("/"));
}

export function getFileName(filePath: string): string {
  return filePath.substring(filePath.lastIndexOf("/") + 1);
}

export function debounce(func: Function, wait: number) {
  let timeout: NodeJS.Timeout | null = null;
  return function (...args: any[]) {
    const later = () => {
      timeout = null;
      func(...args);
    };
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}
