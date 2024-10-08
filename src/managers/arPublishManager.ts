import { App, TFolder, TFile, Notice, MarkdownRenderer } from "obsidian";
import ArweaveSync from "../main";
import { join, dirname, relative } from "../utils/path";
import { walletManager } from "./walletManager";

interface PathManifest {
  fallback: { id: string };
  index: { path: string };
  manifest: string;
  paths: { [key: string]: { id: string } };
  version: string;
}

interface FileTree {
  [key: string]: FileTree | null;
}

export class ArPublishManager {
  private app: App;
  private plugin: ArweaveSync;

  constructor(app: App, plugin: ArweaveSync) {
    this.app = app;
    this.plugin = plugin;
  }

  async publishWebsiteToArweave(folder: TFolder) {
    const markdownFiles = this.getMarkdownFiles(folder);
    const indexFile = markdownFiles.find((file) => file.name === "index.md");

    if (!indexFile) {
      new Notice("Error: index.md file is required in the root of the folder.");
      return;
    }

    const outputDir = await this.createOutputDirectory(folder.name);
    const pathManifest: PathManifest = {
      fallback: { id: "" },
      index: { path: "index.html" },
      manifest: "arweave/paths",
      paths: {},
      version: "0.2.0",
    };

    for (const file of markdownFiles) {
      const content = await this.app.vault.read(file);
      const htmlContent = await this.convertMarkdownToHtml(
        content,
        markdownFiles,
        file,
      );
      const htmlFilePath = await this.saveHtmlFile(
        outputDir,
        file.path,
        htmlContent,
      );
      const relativePath = this.getManifestRelativePath(folder.name, file.path);

      // const txId = "Test";
      const txId = await this.uploadToArweave(htmlContent, "text/html");
      pathManifest.paths[relativePath] = { id: txId };

      if (file === indexFile) {
        pathManifest.index.path = relativePath;
      }
    }

    // Create and upload 404 page
    const notFoundContent = await this.createNotFoundPage(markdownFiles);
    // const notFoundTxId = "test";
    const notFoundTxId = await this.uploadToArweave(
      notFoundContent,
      "text/html",
    );
    pathManifest.fallback.id = notFoundTxId;
    pathManifest.paths["404.html"] = { id: notFoundTxId };

    // Upload path manifest
    // const manifestTxId = "test";

    const manifestTxId = await this.uploadToArweave(
      JSON.stringify(pathManifest),
      "application/x.arweave-manifest+json",
    );

    const arweaveLink = `https://arweave.net/${manifestTxId}`;
    console.log("Manifest uploaded:", arweaveLink);
    navigator.clipboard
      .writeText(arweaveLink)
      .then(() => {
        new Notice(`Website link copied to clipboard: ${arweaveLink}`);
      })
      .catch((err) => {
        console.error("Failed to copy to clipboard:", err);
        new Notice(`Website published to Arweave. Link: ${arweaveLink}`);
      });
  }

  private getRelativePath(folderPath: string, filePath: string): string {
    const relativePath = relative(folderPath, filePath);
    return relativePath.replace(/\.md$/, ".html");
  }

  private async uploadToArweave(
    content: string,
    contentType: string,
  ): Promise<string> {
    const wallet = walletManager.getJWK();
    if (!wallet) {
      throw new Error("Wallet not connected");
    }

    const transaction = await this.plugin
      .getArweave()
      .createTransaction({ data: content }, wallet);

    transaction.addTag("Content-Type", contentType);
    transaction.addTag("App-Name", "ArweaveSync");

    await this.plugin.getArweave().transactions.sign(transaction, wallet);
    const response = await this.plugin
      .getArweave()
      .transactions.post(transaction);

    if (response.status !== 200) {
      throw new Error(
        `Upload failed with status ${response.status}: ${response.statusText}`,
      );
    }

    return transaction.id;
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
    return fullPath;
  }

  private async convertMarkdownToHtml(
    markdown: string,
    allFiles: TFile[],
    currentFile: TFile,
  ): Promise<string> {
    // Convert wiki links to Markdown links
    markdown = this.convertWikiLinks(markdown, currentFile);

    // Create a temporary div element to render the markdown
    const tempDiv = createDiv();

    // Use MarkdownRenderer.renderMarkdown to convert Markdown to HTML
    await MarkdownRenderer.renderMarkdown(
      markdown,
      tempDiv,
      currentFile.path,
      this.plugin,
    );

    // Get the rendered HTML content
    let htmlContent = tempDiv.innerHTML;

    // Clean up any remaining artifacts and fix link issues
    htmlContent = htmlContent.replace(/" dir="auto">/g, '">');
    htmlContent = htmlContent.replace(/data-heading="[^"]*"/g, "");
    htmlContent = htmlContent.replace(
      /\[([^\]]+)\]\(([^\)]+)\.html\)/g,
      '<a href="$2.html">$1</a>',
    );

    // Update the HTML structure
    const baseDir = this.getBaseDir(currentFile.path);
    const isIndex = currentFile.name === "index.md";
    const pageTitle = isIndex ? "Home" : currentFile.basename;

    const fullHtml = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${pageTitle}</title>
          <style>${this.getStyles()}</style>
      </head>
      <body>
      <div class="app-container">
              <aside class="sidebar">
                <div class="sidebar-header">
                  <div class="logo">
                      <!-- SVG element goes here -->
                  </div>
                  <h1 class="site-title">${baseDir}</h1>
                </div>
                <div class="sidebar-search">
                  <input type="text" placeholder="Search pages...">
                </div>
                <nav class="sidebar-nav">
                    ${this.createSidebar(allFiles, currentFile)}
                </nav>
              </aside>
              <main class="content">
                  <article class="markdown-content">
                      <h1 class="doc-title">${pageTitle}</h1>
                      ${htmlContent}
                  </article>
              </main>
              <aside class="page-toc">
                  <h3>ON THIS PAGE</h3>
                  ${this.generateTableOfContents(htmlContent)}
              </aside>
          </div>
          <script>${this.getJavaScript()}</script>
      </body>
      </html>
    `;

    return fullHtml;
  }

  private generateTableOfContents(htmlContent: string): string {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContent, "text/html");
    const headings = doc.querySelectorAll("h1, h2, h3");

    let toc = "<ul>";
    headings.forEach((heading) => {
      const level = parseInt(heading.tagName.charAt(1));
      const text = heading.textContent || "";
      const id = heading.id || this.slugify(text);
      toc += `<li class="toc-item toc-item-${level}"><a href="#${id}">${text}</a></li>`;
    });
    toc += "</ul>";

    return toc;
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
  }

  private convertWikiLinks(markdown: string, currentFile: TFile): string {
    return markdown.replace(
      /\[\[([^\]|]+)(\|[^\]]+)?\]\](\([^\)]+\))?/g,
      (match, linkText, displayText, linkUrl) => {
        const display = displayText ? displayText.slice(1) : linkText;
        const url = linkUrl ? linkUrl.slice(1, -1) : `${linkText}.html`;
        return `[${display}](${url})`;
      },
    );
  }

  private getManifestRelativePath(
    folderName: string,
    filePath: string,
  ): string {
    const parts = filePath.split("/");
    const folderIndex = parts.indexOf(folderName);
    if (folderIndex === -1) {
      throw new Error(
        `Folder name "${folderName}" not found in file path "${filePath}"`,
      );
    }
    return parts
      .slice(folderIndex + 1)
      .join("/")
      .replace(/\.md$/, ".html");
  }

  private getRelativePathToRoot(path: string): string {
    const depth = Math.max(0, path.split("/").length - 2);
    return depth === 0 ? "./" : "../".repeat(depth);
  }

  private getBaseDir(path: string): string {
    const parts = path.split("/");
    return parts[0] || "";
  }

  private getStyles(): string {
    return `
      :root {
        --background-primary: #ffffff;
        --background-secondary: #f5f6f8;
        --text-normal: #2e3338;
        --text-muted: #6e7781;
        --text-faint: #999999;
        --interactive-accent: #7f6df2;
        --interactive-accent-rgb: 127, 109, 242;
        --font-ui-small: 13px;
      }

      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }

      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen-Sans, Ubuntu, Cantarell, 'Helvetica Neue', sans-serif;
        line-height: 1.6;
        color: var(--text-normal);
        background-color: var(--background-primary);
      }

      input {
        outline: none;
      }

      .app-container {
        display: flex;
        height: 100vh;
      }

      .sidebar {
        width: 300px;
        background-color: var(--background-secondary);
        padding: 20px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
      }

      .sidebar-header {
        margin-bottom: 20px;
      }

      .logo {
        margin-right: 10px;
      }

      .site-title {
        font-size: 1.2rem;
        font-weight: 600;
      }

      .sidebar-search {
        margin-bottom: 20px;
      }

      .sidebar-search input {
        width: 100%;
        padding: 8px;
        border: 1px solid var(--text-faint);
        border-radius: 4px;
        font-size: var(--font-ui-small);
      }

      .sidebar-nav {
        flex-grow: 1;
        margin-top: 2vh;
      }

      .sidebar-nav ul {
        list-style-type: none;
        padding-left: 0;
      }

      .sidebar-nav li {
        margin-bottom: 0;
      }

      .nav-file-title, .nav-folder-title {
        display: flex;
        align-items: center;
        width: 100%;
        padding: 2px 0;
        color: var(--text-muted);
        font-size: var(--font-ui-small);
        text-decoration: none;
      }

      .nav-file-title:hover, .nav-folder-title:hover {
        color: var(--text-normal);
      }

      .nav-file-title-content, .nav-folder-title-content {
        flex-grow: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .tree-item-self {
        padding-left: 4px;
      }

      .tree-item-icon {
        width: 16px;
        height: 16px;
        margin-right: 5px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .tree-item-icon svg {
        width: 16px;
        height: 16px;
      }

      .nav-folder-children {
        padding-left: 20px;
      }

      .is-active > .nav-file-title {
        color: var(--text-normal);
        font-weight: bold;
      }

      .content {
        flex: 1;
        padding: 20px 40px;
        overflow-y: auto;
        scrollbar-width: none;
      }

      .markdown-content {
        max-width: 750px;
        margin: 0 auto;
      }

      .doc-title {
        font-size: 2rem;
        margin-bottom: 20px;
        color: var(--text-normal);
      }

      .page-toc {
        width: 200px;
        padding: 20px;
        border-left: 1px solid var(--background-secondary);
      }

      .page-toc h3 {
        font-size: 0.8rem;
        text-transform: uppercase;
        color: var(--text-muted);
        margin-bottom: 10px;
      }

      .page-toc ul {
        list-style-type: none;
      }

      .page-toc a {
        color: var(--text-muted);
        text-decoration: none;
        font-size: var(--font-ui-small);
      }

      .page-toc a:hover {
        color: var(--interactive-accent);
      }

      .tree-item-children {
        margin-left: 20px;
      }

      .tree-item-self {
        display: flex;
        align-items: center;
        cursor: pointer;
      }

      .nav-folder-children {
        display: block;
        padding-left: 20px;
      }

      .nav-folder.is-collapsed > .nav-folder-children {
        display: none;
      }

      .nav-folder > .nav-folder-title > .nav-folder-collapse-indicator {
        transition: transform 100ms ease-in-out;
      }

      .nav-folder.is-collapsed > .nav-folder-title > .nav-folder-collapse-indicator {
        transform: rotate(-90deg);
      }

      .tree-item-icon svg {
        width: 12px;
        height: 12px;
      }

      .collapse-icon {
        transition: transform 0.3s ease;
      }

      .collapse-icon.is-collapsed {
        transform: rotate(-90deg);
      }

      .markdown-content a {
        color: var(--interactive-accent);
        text-decoration: none;
      }

      .markdown-content a:hover {
        text-decoration: underline;
      }

      .markdown-content h1, .markdown-content h2, .markdown-content h3,
      .markdown-content h4, .markdown-content h5, .markdown-content h6 {
        margin-top: 1em;
        margin-bottom: 0.5em;
      }

      .markdown-content pre {
        background-color: var(--background-secondary);
        padding: 10px;
        border-radius: 4px;
        overflow-x: auto;
      }

      .markdown-content code {
        font-family: monospace;
        font-size: 0.9em;
      }

      .markdown-content blockquote {
        border-left: 3px solid var(--interactive-accent);
        margin: 1em 0;
        padding-left: 1em;
        color: var(--text-muted);
      }

      .tree-item {
        margin-bottom: 2px;
      }

      .tree-item-self {
        display: flex;
        align-items: center;
      }

      .nav-file-title, .nav-folder-title {
        display: flex;
        align-items: center;
        width: 100%;
      }

      .nav-file-title-content, .nav-folder-title-content {
        flex-grow: 1;
      }
    `;
  }

  private getJavaScript(): string {
    return `
        document.addEventListener('DOMContentLoaded', (event) => {
          // Expand/collapse folders in sidebar
          const folderTitles = document.querySelectorAll('.nav-folder > .nav-folder-title');
          folderTitles.forEach(folderTitle => {
            folderTitle.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              const folder = folderTitle.closest('.nav-folder');
              folder.classList.toggle('is-collapsed');

              // Save folder state
              const folderPath = folder.querySelector('.nav-folder-title').getAttribute('data-path');
              localStorage.setItem('folderState_' + folderPath, folder.classList.contains('is-collapsed'));
            });
          });

          // Restore folder state
          document.querySelectorAll('.nav-folder').forEach(folder => {
            const folderPath = folder.querySelector('.nav-folder-title').getAttribute('data-path');
            const isCollapsed = localStorage.getItem('folderState_' + folderPath) === 'true';
            if (isCollapsed) {
              folder.classList.add('is-collapsed');
            } else {
              folder.classList.remove('is-collapsed');
            }
          });

          // Expand parent folders of the current page
          const currentFileLink = document.querySelector('.nav-file-title.is-active');
          if (currentFileLink) {
            let parent = currentFileLink.closest('.nav-folder');
            while (parent) {
              parent.classList.remove('is-collapsed');
              parent = parent.parentElement.closest('.nav-folder');
            }
          }

          // Highlight active page in sidebar
          const currentPath = window.location.pathname;
          const sidebarLinks = document.querySelectorAll('.nav-file-title');
          sidebarLinks.forEach(link => {
            if (link.getAttribute('href') === currentPath) {
              link.classList.add('is-active');
            }
          });

          // Search functionality
          const searchInput = document.querySelector('.sidebar-search input');
          const navItems = document.querySelectorAll('.nav-file-title, .nav-folder-title');

          searchInput.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase();

            navItems.forEach(item => {
              const text = item.textContent.toLowerCase();
              const parent = item.closest('.tree-item');

              if (text.includes(searchTerm)) {
                parent.style.display = 'block';
                let folder = parent.closest('.nav-folder');
                while (folder) {
                  folder.classList.remove('is-collapsed');
                  folder = folder.parentElement.closest('.nav-folder');
                }
              } else {
                parent.style.display = 'none';
              }
            });
          });
        });
      `;
  }

  private createSidebar(files: TFile[], currentFile: TFile): string {
    const tree = this.buildFileTree(files);
    const baseDir = Object.keys(tree)[0];

    // Create the home link
    const homeLink = this.createHomeLink(currentFile);

    // Render the tree starting from the subdirectories
    const fileTree = this.renderFileTree(
      tree[baseDir] as FileTree,
      baseDir,
      currentFile,
    );

    return homeLink + fileTree;
  }

  private createHomeLink(currentFile: TFile): string {
    const isActive = currentFile.name === "index.md" ? "is-active" : "";
    const homeHref = this.getCorrectRelativePath(currentFile.path, "index.md");

    return `
      <div class="tree-item nav-file">
        <div class="tree-item-self is-clickable ${isActive}" data-path="index.md">
          <a href="${homeHref}" class="nav-file-title">
            <div class="tree-item-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-home">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                <polyline points="9 22 9 12 15 12 15 22"></polyline>
              </svg>
            </div>
            <div class="nav-file-title-content">Home</div>
          </a>
        </div>
      </div>
    `;
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
    level: number = 0,
  ): string {
    let html = "";

    for (const [name, subtree] of Object.entries(tree)) {
      if (name === "index.md") continue;

      const fullPath = path ? `${path}/${name}` : name;
      const isCurrentFile = fullPath === currentFile.path;
      const itemClass = isCurrentFile ? "is-active" : "";
      const displayName = name.replace(/\.md$/, "");

      if (subtree === null) {
        // File
        const href = this.getCorrectRelativePath(currentFile.path, fullPath);

        html += `
          <div class="tree-item nav-file">
            <div class="tree-item-self is-clickable ${itemClass}" data-path="${fullPath}">
              <a href="${href}" class="nav-file-title">
                <div class="nav-file-title-content">${displayName}</div>
              </a>
            </div>
          </div>
        `;
      } else {
        // Folder
        html += `
          <div class="tree-item nav-folder">
            <div class="tree-item-self is-clickable nav-folder-title" data-path="${fullPath}">
              <div class="tree-item-icon collapse-icon nav-folder-collapse-indicator">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon right-triangle">
                  <path d="M3 8L12 17L21 8"></path>
                </svg>
              </div>
              <div class="nav-folder-title-content">${displayName}</div>
            </div>
            <div class="tree-item-children nav-folder-children">
              ${this.renderFileTree(subtree, fullPath, currentFile, level + 1)}
            </div>
          </div>
        `;
      }
    }

    return html;
  }

  private getCorrectRelativePath(
    currentPath: string,
    targetPath: string,
  ): string {
    const currentParts = currentPath.split("/").slice(0, -1);
    const targetParts = targetPath.split("/");

    // Special case for index.md
    if (targetPath === "index.md") {
      const depth = Math.max(0, currentParts.length - 1); // Subtract 1 to account for the base directory
      return depth === 0 ? "index.html" : "../".repeat(depth) + "index.html";
    }

    let commonPrefixLength = 0;
    while (
      commonPrefixLength < currentParts.length &&
      commonPrefixLength < targetParts.length &&
      currentParts[commonPrefixLength] === targetParts[commonPrefixLength]
    ) {
      commonPrefixLength++;
    }

    const backSteps = currentParts.length - commonPrefixLength;
    const forwardSteps = targetParts.slice(commonPrefixLength);

    let relativePath = "../".repeat(backSteps) + forwardSteps.join("/");

    // Replace .md with .html for the final file
    relativePath = relativePath.replace(/\.md$/, ".html");

    console.log("Current path:", currentPath);
    console.log("Target path:", targetPath);
    console.log("Relative path:", relativePath);

    return relativePath;
  }

  private async createNotFoundPage(files: TFile[]): Promise<string> {
    // Create a dummy file object to represent the 404 page
    const dummyFile = {
      path: "404.md",
      name: "404.md",
      basename: "404",
      extension: "md",
    } as TFile;

    let sidebarContent = this.createSidebar(files, dummyFile);

    const notFoundContent = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Page Not Found</title>
          <style>${this.getStyles()}</style>
      </head>
      <body>
          <div class="app-container">
              <aside class="sidebar">
                  <div class="sidebar-header">
                      <div class="logo">
                          <!-- SVG element goes here -->
                      </div>
                      <h1 class="site-title">404 - Not Found</h1>
                  </div>
                  <div class="sidebar-search">
                      <input type="text" placeholder="Search pages...">
                  </div>
                  <nav class="sidebar-nav">
                      ${sidebarContent}
                  </nav>
              </aside>
              <main class="content">
                  <article class="markdown-content">
                      <h1 class="doc-title">Page Not Found</h1>
                      <p>The requested page could not be found. Please check the URL or use the sidebar to navigate to an existing page.</p>
                  </article>
              </main>
          </div>
          <script>${this.getJavaScript()}</script>
      </body>
      </html>
    `;

    return notFoundContent;
  }

  private adjust404SidebarLinks(sidebarContent: string): string {
    const parser = new DOMParser();
    const doc = parser.parseFromString(sidebarContent, "text/html");

    doc.querySelectorAll("a").forEach((link) => {
      let href = link.getAttribute("href");
      if (href) {
        // Use the same logic as for index.html
        href = this.getCorrectRelativePath(
          "404.md",
          href.replace(/\.html$/, ".md"),
        );
        link.setAttribute("href", href);
      }
    });

    return doc.body.innerHTML;
  }
}
