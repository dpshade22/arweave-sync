import { App, TFolder, TFile, Notice } from "obsidian";
import ArweaveSync from "../main";
import * as path from "path";

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
      const htmlContent = this.convertMarkdownToHtml(
        content,
        markdownFiles,
        file,
      );

      await this.saveHtmlFile(outputDir, file.name, htmlContent);
    }

    new Notice(`Folder "${folder.name}" published to ${outputDir}`);
  }

  private getMarkdownFiles(folder: TFolder): TFile[] {
    return folder.children.filter(
      (file): file is TFile => file instanceof TFile && file.extension === "md",
    );
  }

  private async createOutputDirectory(folderName: string): Promise<string> {
    const basePath = this.app.vault.configDir;
    const outputDir = path.join(basePath, "arweave-publish", folderName);

    await this.app.vault.adapter.mkdir(outputDir);

    return outputDir;
  }

  private async saveHtmlFile(
    outputDir: string,
    fileName: string,
    htmlContent: string,
  ) {
    const htmlFileName = fileName.replace(/\.md$/, ".html");
    const filePath = path.join(outputDir, htmlFileName);

    await this.app.vault.adapter.mkdir(path.dirname(filePath));
    await this.app.vault.adapter.write(filePath, htmlContent);
    console.log(`Saved HTML file: ${filePath}`);
  }

  private convertMarkdownToHtml(
    markdown: string,
    allFiles: TFile[],
    currentFile: TFile,
  ): string {
    const lines = markdown.split("\n");
    let html = "";
    let blockStack: number[] = [];
    let inCodeBlock = false;

    const processLine = (line: string): string => {
      // Check for code blocks
      if (line.trim().startsWith("```")) {
        inCodeBlock = !inCodeBlock;
        return inCodeBlock ? "<pre><code>" : "</code></pre>";
      }
      if (inCodeBlock) return this.escapeHtml(line);

      // Process headings
      if (line.startsWith("#")) {
        const level = line.split(" ")[0].length;
        const content = line.substring(level + 1).trim();
        return `<h${level}>${this.processInlineMarkdown(content)}</h${level}>`;
      }

      // Process list items and indentation
      const listMatch = line.match(/^(\s*)([•\-*+]|\d+\.)\s(.+)/);
      if (listMatch) {
        const [, indent, bullet, content] = listMatch;
        const indentLevel = indent.length / 2;

        while (blockStack.length > indentLevel) {
          html += `</div>`.repeat(
            blockStack.pop()! - (blockStack[blockStack.length - 1] || 0),
          );
        }

        if (blockStack.length < indentLevel) {
          html += `<div class="block-children">`.repeat(
            indentLevel - blockStack.length,
          );
          blockStack.push(indentLevel);
        }

        return `
        <div class="block">
          <div class="block-header">
            <span class="block-bullet">${bullet}</span>
            <span class="block-content">${this.processInlineMarkdown(content)}</span>
          </div>
        </div>
      `;
      }

      // Close any open blocks
      if (blockStack.length > 0 && line.trim() === "") {
        const closeTags = `</div>`.repeat(blockStack.length);
        blockStack = [];
        return closeTags;
      }

      // Process regular paragraphs
      return line.trim() ? `<p>${this.processInlineMarkdown(line)}</p>` : "";
    };

    html = lines.map(processLine).join("\n");

    // Close any remaining open blocks
    html += `</div>`.repeat(blockStack.length);

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
                    ${html}
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

  private processInlineMarkdown(text: string): string {
    // Convert bold
    text = text.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");

    // Convert italic
    text = text.replace(/\*(.*?)\*/g, "<em>$1</em>");

    // Convert highlights
    text = text.replace(/==(.*?)==/g, "<mark>$1</mark>");

    // Convert internal links
    text = text.replace(/\[\[(.*?)\]\]/g, (match, p1) => {
      const parts = p1.split("|");
      const link = parts[0].trim();
      const label = parts[1] ? parts[1].trim() : link;
      return `<a href="${link}.html" class="internal-link">${label}</a>`;
    });

    // Convert external links
    text = text.replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" class="external-link">$1</a>',
    );

    return text;
  }

  private getStyles(): string {
    return `
    :root {
      --background-primary: #ffffff;
      --background-secondary: #f5f6f8;
      --text-normal: #2e3338;
      --text-muted: #888888;
      --text-faint: #999999;
      --interactive-accent: #7b6cd9;
      --background-modifier-border: #ddd;
      --background-modifier-form-field: #fff;
    }

    body, html {
      margin: 0;
      padding: 0;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
      font-size: 16px;
      line-height: 1.5;
      color: var(--text-normal);
      background-color: var(--background-primary);
    }

    .app-container {
      display: flex;
      flex-direction: column;
      height: 100vh;
    }

    .app-nav {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 20px;
      background-color: var(--background-secondary);
      border-bottom: 1px solid var(--background-modifier-border);
    }

    .nav-buttons, .nav-actions {
      display: flex;
    }

    .nav-button {
      background: none;
      border: none;
      font-size: 18px;
      cursor: pointer;
      color: var(--text-muted);
      padding: 5px 10px;
    }

    .nav-title {
      font-weight: 600;
      color: var(--text-normal);
    }

    .main-container {
      display: flex;
      flex: 1;
      overflow: hidden;
    }

    .sidebar {
      width: 250px;
      background-color: var(--background-secondary);
      overflow-y: auto;
      padding: 20px;
      border-right: 1px solid var(--background-modifier-border);
    }

    .content {
      flex: 1;
      padding: 40px;
      overflow-y: auto;
    }

    .markdown-content {
      max-width: 750px;
      margin: 0 auto;
    }

    h1, h2, h3, h4, h5, h6 {
      margin-top: 1.5em;
      margin-bottom: 0.5em;
      font-weight: 600;
      color: var(--text-normal);
    }

    h1 { font-size: 2em; }
    h2 { font-size: 1.5em; }
    h3 { font-size: 1.3em; }

    a {
      color: var(--interactive-accent);
      text-decoration: none;
    }

    a:hover {
      text-decoration: underline;
    }

    mark {
      background-color: rgba(123, 108, 217, 0.15);
      padding: 0.1em 0.2em;
      border-radius: 3px;
    }

    .metadata {
      font-size: 0.9em;
      color: var(--text-muted);
      margin-bottom: 2em;
    }

    .block {
      margin-bottom: 5px;
    }

    .block-children {
      margin-left: 20px;
      padding-left: 10px;
      border-left: 2px solid var(--background-modifier-border);
    }

    .block-header {
      display: flex;
      align-items: flex-start;
    }

    .block-bullet {
      color: var(--text-muted);
      margin-right: 5px;
      flex-shrink: 0;
    }

    .block-content {
      flex-grow: 1;
    }

    pre {
      background-color: var(--background-secondary);
      padding: 10px;
      border-radius: 5px;
      overflow-x: auto;
    }

    code {
      font-family: 'Fira Code', monospace;
      font-size: 0.9em;
    }

    .doc-title {
      border-bottom: 1px solid var(--background-modifier-border);
      padding-bottom: 10px;
      margin-bottom: 20px;
    }
  `;
  }

  private getJavaScript(): string {
    return `
    document.addEventListener('DOMContentLoaded', (event) => {
      document.querySelectorAll('.block-header').forEach(header => {
        header.addEventListener('click', () => {
          const block = header.closest('.block');
          const children = block.querySelector('.block-children');
          if (children) {
            children.classList.toggle('collapsed');
            const bullet = header.querySelector('.block-bullet');
            bullet.textContent = children.classList.contains('collapsed') ? '▸' : bullet.textContent.replace('▸', '•');
          }
        });
      });
    });
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
      const isCurrentFile = fullPath === currentFile.path;
      const itemClass = isCurrentFile ? "current" : "";

      if (subtree === null) {
        html += `<li class="${itemClass}"><a href="${fullPath.replace(/\.md$/, ".html")}">${name}</a></li>`;
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

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
}
