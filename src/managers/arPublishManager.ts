import { App, TFolder, TFile, Notice, MarkdownRenderer } from "obsidian";
import ArweaveSync from "../main";
import { join, dirname, relative, basename } from "../utils/path";

interface FileTree {
  [key: string]: FileTree | null;
}

export class ArPublishManager {
  private app: App;

  constructor(
    app: App,
    private plugin: ArweaveSync,
  ) {
    this.app = app;
  }

  async publishFolder(folder: TFolder) {
    const markdownFiles = this.getMarkdownFiles(folder);
    const outputDir = await this.createOutputDirectory(folder.name);

    for (const file of markdownFiles) {
      const content = await this.app.vault.read(file);
      const htmlContent = await this.convertMarkdownToHtml(
        content,
        markdownFiles,
        file,
        outputDir,
      );
      await this.saveHtmlFile(outputDir, file.path, htmlContent);
    }

    await this.createIndexFile(outputDir, markdownFiles);

    new Notice(`Folder "${folder.name}" published to ${outputDir}`);
  }

  private getMarkdownFiles(folder: TFolder): TFile[] {
    const files: TFile[] = [];

    const collectFiles = (item: TFolder | TFile) => {
      if (item instanceof TFolder) {
        item.children.forEach(collectFiles);
      } else if (item instanceof TFile && item.extension === "md") {
        files.push(item);
      }
    };

    collectFiles(folder);
    return files;
  }

  private async createOutputDirectory(folderName: string): Promise<string> {
    const basePath = this.app.vault.configDir;
    const outputDir = join(basePath, "arweave-publish", folderName);
    await this.app.vault.adapter.mkdir(outputDir);
    return outputDir;
  }

  private async saveHtmlFile(
    outputDir: string,
    filePath: string,
    htmlContent: string,
  ) {
    const baseDir = this.getBaseDir(filePath);
    const relativePath = filePath.replace(new RegExp(`^${baseDir}`), ".");
    const htmlFileName = relativePath.replace(/\.md$/, ".html");
    const fullPath = join(outputDir, htmlFileName.slice(1)); // Remove the leading dot

    await this.app.vault.adapter.mkdir(dirname(fullPath));
    await this.app.vault.adapter.write(fullPath, htmlContent);
    console.log(`Saved HTML file: ${fullPath}`);
  }

  private async convertMarkdownToHtml(
    markdown: string,
    allFiles: TFile[],
    currentFile: TFile,
    outputDir: string,
  ): Promise<string> {
    // Create a temporary div element to render the markdown
    const tempDiv = createDiv();

    // Convert wiki links to relative paths
    markdown = this.convertWikiLinks(markdown, currentFile, outputDir);

    // Use MarkdownRenderer.renderMarkdown to convert Markdown to HTML
    await MarkdownRenderer.renderMarkdown(
      markdown,
      tempDiv,
      currentFile.path,
      this.plugin,
    );

    // Get the rendered HTML content
    const htmlContent = tempDiv.innerHTML;

    // Wrap the content in a modern HTML structure with a sidebar
    const sidebarHtml = this.createSidebar(allFiles, currentFile);
    const fullHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${currentFile.basename}</title>
    <style>
        ${this.getStyles()}
    </style>
</head>
<body>
    <div class="app-container">
        <nav class="app-nav">
            <div class="nav-buttons">
                <button class="nav-button">←</button>
                <button class="nav-button">→</button>
            </div>
            <div class="nav-title">${this.getNavTitle(currentFile)}</div>
            <div class="nav-actions">
                <button class="nav-button">⋮</button>
            </div>
        </nav>
        <div class="main-container">
            <aside class="sidebar">
                ${sidebarHtml}
            </aside>
            <main class="content">
                <article class="markdown-content">
                    <h1 class="doc-title">${currentFile.basename}</h1>
                    <div class="metadata">
                        Created: ${this.formatDate(currentFile.stat.ctime)} &nbsp;&nbsp; Modified: ${this.formatDate(currentFile.stat.mtime)}
                    </div>
                    ${htmlContent}
                </article>
            </main>
        </div>
    </div>
    <script>
        ${this.getJavaScript()}
    </script>
</body>
</html>
    `;

    return fullHtml;
  }

  private convertWikiLinks(markdown: string, currentFile: TFile): string {
    const baseDir = this.getBaseDir(currentFile.path);
    return markdown.replace(/\[\[(.*?)\]\]/g, (match, p1) => {
      const [linkText, displayText] = p1.split("|");
      const linkedFile = this.app.metadataCache.getFirstLinkpathDest(
        linkText,
        currentFile.path,
      );

      if (linkedFile instanceof TFile) {
        // Calculate relative path from current file to linked file
        let relativePath = this.getRelativePath(
          currentFile.path,
          linkedFile.path,
        );

        // Replace .md extension with .html
        relativePath = relativePath.replace(/\.md$/, ".html");

        return `[${displayText || linkText}](${relativePath})`;
      }

      return match; // If the link can't be resolved, leave it as is
    });
  }

  private getRelativePath(fromPath: string, toPath: string): string {
    const fromParts = fromPath.split("/");
    const toParts = toPath.split("/");

    // Remove the common base directory
    while (
      fromParts.length > 0 &&
      toParts.length > 0 &&
      fromParts[0] === toParts[0]
    ) {
      fromParts.shift();
      toParts.shift();
    }

    // Calculate upCount, ensuring it's never negative
    const upCount = Math.max(0, fromParts.length - 1);

    // Construct the relative path
    const relativePath = [...Array(upCount).fill(".."), ...toParts].join("/");

    return relativePath || "."; // Return '.' if the paths are identical
  }

  private getBaseDir(path: string): string {
    const parts = path.split("/");
    return parts[0] || "";
  }

  private getStyles(): string {
    return `
    /* Your CSS styles here */
    `;
  }

  private getJavaScript(): string {
    return `
    /* Your JavaScript here */
    `;
  }

  private getNavTitle(currentFile: TFile): string {
    const parts = currentFile.path.split("/");
    return parts.length > 1
      ? `${parts[parts.length - 2]} / ${currentFile.basename}`
      : currentFile.basename;
  }

  private formatDate(timestamp: number): string {
    return new Date(timestamp).toLocaleString([], {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  private createSidebar(files: TFile[], currentFile: TFile): string {
    const tree = this.buildFileTree(files);
    return this.renderFileTree(tree, "", currentFile);
  }

  private buildFileTree(files: TFile[]): FileTree {
    const tree: FileTree = {};
    files.forEach((file) => {
      const parts = file.path.split("/");
      let current: FileTree = tree;
      parts.forEach((part, index) => {
        if (!current[part]) {
          current[part] = index === parts.length - 1 ? null : {};
        }
        if (current[part] !== null) {
          current = current[part] as FileTree;
        }
      });
    });
    return tree;
  }

  private renderFileTree(
    tree: FileTree,
    path: string = "",
    currentFile: TFile,
  ): string {
    let html = "<ul>";
    for (const [name, subtree] of Object.entries(tree)) {
      const fullPath = path ? `${path}/${name}` : name;
      const relativePath = this.getRelativePath(currentFile.path, fullPath);
      const isCurrentFile = fullPath === currentFile.path;
      const itemClass = isCurrentFile ? "current" : "";

      if (subtree === null) {
        html += `<li class="${itemClass}"><a href="${relativePath.replace(/\.md$/, ".html")}">${name}</a></li>`;
      } else {
        html += `<li class="folder ${itemClass}">
                   <span class="folder-name">${name}</span>
                   ${this.renderFileTree(subtree, fullPath, currentFile)}
                 </li>`;
      }
    }
    html += "</ul>";
    return html;
  }

  private async createIndexFile(outputDir: string, files: TFile[]) {
    const indexContent = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Index</title>
      <style>
          ${this.getStyles()}
      </style>
  </head>
  <body>
      <div class="app-container">
          <h1>Index</h1>
          <ul>
              ${files
                .map((file) => {
                  // Remove the base directory (e.g., "Bible") from the file path
                  const relativePath = file.path.split("/").slice(1).join("/");
                  return `<li><a href="${relativePath.replace(/\.md$/, ".html")}">${file.basename}</a></li>`;
                })
                .join("\n")}
          </ul>
      </div>
  </body>
  </html>
    `;

    await this.app.vault.adapter.write(
      join(outputDir, "index.html"),
      indexContent,
    );
    console.log(`Created index.html in ${outputDir}`);
  }
}
