import { App, Modal, ButtonComponent, TFile } from "obsidian";
import ArweaveSync from "../main";
import { FileUploadInfo, UploadConfig } from "../types";

interface FileNode {
  name: string;
  path: string;
  fileInfo?: FileUploadInfo;
  isFolder: boolean;
  children: FileNode[];
  expanded: boolean;
}

export class VaultSyncModal extends Modal {
  private plugin: ArweaveSync;
  private localFiles: FileNode[];
  private remoteFiles: FileNode[];
  private filesToExport: FileNode[];
  private filesToImport: FileNode[];
  private localContainer: HTMLElement;
  private remoteContainer: HTMLElement;
  private importContainer: HTMLElement;
  private isExportView: boolean = true;
  private tabContainer: HTMLElement;
  private contentContainer: HTMLElement;
  private hasChangesToImport: boolean = false;
  private hasChangesToExport: boolean = false;

  constructor(app: App, plugin: ArweaveSync) {
    super(app);
    this.plugin = plugin;
    this.localFiles = [];
    this.remoteFiles = [];
    this.filesToExport = [];
    this.filesToImport = [];
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("vault-sync-modal");

    this.tabContainer = contentEl.createDiv({ cls: "tab-container" });
    this.contentContainer = contentEl.createDiv({ cls: "content-container" });

    await this.initializeFiles();
    this.createTabs();
    await this.renderContent();
  }

  private async initializeFiles() {
    const modifiedOrNewFiles = await this.getModifiedOrNewFiles();
    this.localFiles = this.buildFileTree(modifiedOrNewFiles);
    this.remoteFiles = await this.getNewOrModifiedRemoteFiles();
    this.filesToImport = [];

    this.hasChangesToExport = this.localFiles.length > 0;
    this.hasChangesToImport = this.remoteFiles.length > 0;
  }

  private async getNewOrModifiedRemoteFiles(): Promise<FileNode[]> {
    const remoteConfig = this.plugin.settings.remoteUploadConfig;
    const newOrModifiedFiles: FileNode[] = [];

    for (const [filePath, remoteFileInfo] of Object.entries(remoteConfig)) {
      const file = this.app.vault.getAbstractFileByPath(filePath);
      if (file instanceof TFile) {
        const localHash = await this.plugin.getFileHash(file);
        if (localHash !== remoteFileInfo.fileHash) {
          newOrModifiedFiles.push(
            this.createFileNode(filePath, remoteFileInfo),
          );
        }
      } else {
        // File doesn't exist locally, so it's new
        newOrModifiedFiles.push(this.createFileNode(filePath, remoteFileInfo));
      }
    }

    return this.buildFileTree(newOrModifiedFiles);
  }

  private createTabs() {
    const exportTab = this.tabContainer.createDiv({ cls: "tab" });
    exportTab.textContent = "Export to Arweave";
    if (this.hasChangesToExport) {
      exportTab.addEventListener("click", () => this.switchView(true));
    } else {
      exportTab.addClass("disabled");
      exportTab.setAttribute("title", "No changes to export");
    }

    const importTab = this.tabContainer.createDiv({ cls: "tab" });
    importTab.textContent = "Import from Arweave";
    if (this.hasChangesToImport) {
      importTab.addEventListener("click", () => this.switchView(false));
    } else {
      importTab.addClass("disabled");
      importTab.setAttribute("title", "No changes to import");
    }

    this.updateTabStyles();
  }

  private async switchView(isExportView: boolean) {
    this.isExportView = isExportView;
    this.updateTabStyles();
    await this.renderContent();
  }

  private updateTabStyles() {
    const tabs = this.tabContainer.querySelectorAll(".tab");
    tabs.forEach((tab, index) => {
      if (
        (index === 0 && this.isExportView) ||
        (index === 1 && !this.isExportView)
      ) {
        tab.addClass("active");
      } else {
        tab.removeClass("active");
      }
    });
  }

  private async renderContent() {
    this.contentContainer.empty();

    if (this.isExportView) {
      await this.renderExportView();
    } else {
      await this.renderImportView();
    }
  }

  private async renderExportView() {
    const container = this.contentContainer.createDiv({
      cls: "file-transfer-container",
    });
    this.localContainer = container.createDiv({ cls: "local-files" });
    this.remoteContainer = container.createDiv({ cls: "export-files" });
    this.renderFileTree(this.localFiles, this.localContainer, true);
    this.renderFileTree(this.filesToExport, this.remoteContainer, false);

    const buttonContainer = this.contentContainer.createDiv({
      cls: "button-container",
    });
    new ButtonComponent(buttonContainer)
      .setButtonText("Cancel")
      .onClick(() => this.close());
    new ButtonComponent(buttonContainer)
      .setButtonText("Export to Arweave")
      .setCta()
      .onClick(() => this.exportToArweave());
  }

  private async renderImportView() {
    const container = this.contentContainer.createDiv({
      cls: "file-transfer-container",
    });
    this.remoteContainer = container.createDiv({ cls: "remote-files" });
    this.importContainer = container.createDiv({ cls: "import-files" });

    this.renderFileTree(this.remoteFiles, this.remoteContainer, true);
    this.renderFileTree(this.filesToImport, this.importContainer, false);

    const buttonContainer = this.contentContainer.createDiv({
      cls: "button-container",
    });
    new ButtonComponent(buttonContainer)
      .setButtonText("Cancel")
      .onClick(() => this.close());
    new ButtonComponent(buttonContainer)
      .setButtonText("Import Selected Files")
      .setCta()
      .onClick(() => this.importFiles());
  }

  private buildFileTree(
    files: TFile[] | UploadConfig | FileNode[],
  ): FileNode[] {
    const root: FileNode[] = [];
    const pathMap: Record<string, FileNode> = {};

    const processFile = (path: string, fileInfo?: FileUploadInfo) => {
      const parts = path.split("/");
      let currentPath = "";

      parts.forEach((part, index) => {
        currentPath += (index > 0 ? "/" : "") + part;
        if (!pathMap[currentPath]) {
          const newNode: FileNode = {
            name: part,
            path: currentPath,
            isFolder: index < parts.length - 1,
            children: [],
            expanded: false,
          };
          pathMap[currentPath] = newNode;

          if (index === 0) {
            root.push(newNode);
          } else {
            const parentPath = parts.slice(0, index).join("/");
            if (pathMap[parentPath]) {
              pathMap[parentPath].children.push(newNode);
            }
          }
        }
      });

      // Add file info to the leaf node
      const leafNode = pathMap[path];
      if (leafNode && fileInfo) {
        leafNode.fileInfo = fileInfo;
      }
    };

    if (Array.isArray(files)) {
      files.forEach((file) => {
        if (file instanceof TFile) {
          processFile(file.path, {
            txId: this.plugin.settings.localUploadConfig[file.path]?.txId || "",
            timestamp: file.stat.mtime,
            fileHash: "",
            encrypted: false,
            filePath: file.path,
          });
        } else {
          processFile(file.path, file.fileInfo);
        }
      });
    } else {
      Object.entries(files).forEach(([path, fileInfo]) => {
        processFile(path, fileInfo);
      });
    }

    return root;
  }

  private renderFileTree(
    files: FileNode[],
    containerEl: HTMLElement,
    isSource: boolean,
  ) {
    containerEl.empty();
    const headerEl = containerEl.createEl("h3", {
      text: isSource
        ? this.isExportView
          ? "Local Vault"
          : "Remote Files"
        : this.isExportView
          ? "Files to Export"
          : "Files to Import",
    });
    containerEl.appendChild(headerEl);
    const treeEl = containerEl.createEl("ul", { cls: "file-tree" });
    this.renderFileNodes(files, treeEl, isSource, 0);
  }

  private renderFileNodes(
    nodes: FileNode[],
    parentEl: HTMLElement,
    isSource: boolean,
    depth: number,
  ) {
    nodes.sort((a, b) => {
      if (a.isFolder && !b.isFolder) return -1;
      if (!a.isFolder && b.isFolder) return 1;
      return a.name.localeCompare(b.name);
    });

    nodes.forEach((node) => {
      const itemEl = parentEl.createEl("li", {
        cls: `tree-item ${node.isFolder ? "folder-item" : "file-item"}`,
      });
      const contentEl = itemEl.createEl("div", { cls: "tree-item-content" });
      contentEl.style.paddingLeft = `${depth * 20}px`;

      if (node.isFolder) {
        const toggleEl = contentEl.createEl("span", { cls: "folder-toggle" });
        const chevronSvg = this.createChevronSvg();
        toggleEl.appendChild(chevronSvg);
        this.updateChevronRotation(chevronSvg, node.expanded);

        contentEl.createEl("span", { text: node.name, cls: "folder-name" });

        const toggleFolder = (e: Event) => {
          e.stopPropagation();
          node.expanded = !node.expanded;
          this.updateChevronRotation(chevronSvg, node.expanded);
          this.toggleFolderContents(itemEl, node, isSource, depth);
        };

        contentEl.addEventListener("click", toggleFolder);
      } else {
        contentEl.createEl("span", {
          text: this.displayFileName(node.name),
          cls: "file-name",
        });
      }

      if (node.fileInfo) {
        contentEl.setAttribute(
          "title",
          `Last modified: ${new Date(node.fileInfo.timestamp).toLocaleString()}`,
        );
      }

      if (!node.isFolder) {
        contentEl.addEventListener("click", () =>
          this.toggleFileSelection(node, isSource),
        );
      }

      if (node.isFolder && node.expanded) {
        this.renderFolderContents(itemEl, node, isSource, depth);
      }
    });
  }

  private createChevronSvg(): SVGElement {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "18");
    svg.setAttribute("height", "18");
    svg.classList.add("chevron");

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute(
      "d",
      "M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z",
    );
    path.setAttribute("fill", "currentColor");

    svg.appendChild(path);
    return svg;
  }

  private updateChevronRotation(chevronSvg: SVGElement, expanded: boolean) {
    chevronSvg.style.transform = expanded ? "rotate(90deg)" : "rotate(0deg)";
  }

  private toggleFolderContents(
    itemEl: HTMLElement,
    node: FileNode,
    isSource: boolean,
    depth: number,
  ) {
    const existingContents = itemEl.querySelector(".folder-contents");
    if (existingContents) {
      existingContents.remove();
    }
    if (node.expanded) {
      this.renderFolderContents(itemEl, node, isSource, depth);
    }
  }

  private renderFolderContents(
    itemEl: HTMLElement,
    node: FileNode,
    isSource: boolean,
    depth: number,
  ) {
    const childrenEl = itemEl.createEl("ul", { cls: "folder-contents" });
    this.renderFileNodes(node.children, childrenEl, isSource, depth + 1);
  }

  private displayFileName(fileName: string): string {
    return fileName.endsWith(".md") ? fileName.slice(0, -3) : fileName;
  }

  private toggleFileSelection(file: FileNode, isSource: boolean) {
    if (this.isExportView) {
      if (isSource) {
        this.moveFileToExport(file);
      } else {
        this.removeFileFromExport(file);
      }
      this.renderFileTree(this.localFiles, this.localContainer, true);
      this.renderFileTree(this.filesToExport, this.remoteContainer, false);
    } else {
      if (isSource) {
        this.moveFileToImport(file);
      } else {
        this.removeFileFromImport(file);
      }
      this.renderFileTree(this.remoteFiles, this.remoteContainer, true);
      this.renderFileTree(this.filesToImport, this.importContainer, false);
    }
  }

  private moveFileToExport(file: FileNode) {
    this.removeFileFromTree(this.localFiles, file.path);
    this.addFileToTree(this.filesToExport, file);
  }

  private removeFileFromExport(file: FileNode) {
    this.removeFileFromTree(this.filesToExport, file.path);
    this.addFileToTree(this.localFiles, file);
  }

  private moveFileToImport(file: FileNode) {
    this.removeFileFromTree(this.remoteFiles, file.path);
    this.addFileToTree(this.filesToImport, file);
  }

  private removeFileFromImport(file: FileNode) {
    this.removeFileFromTree(this.filesToImport, file.path);
    this.addFileToTree(this.remoteFiles, file);
  }

  private removeFileFromTree(tree: FileNode[], path: string): boolean {
    for (let i = 0; i < tree.length; i++) {
      if (tree[i].path === path) {
        tree.splice(i, 1);
        return true;
      }
      if (tree[i].isFolder && this.removeFileFromTree(tree[i].children, path)) {
        if (tree[i].children.length === 0) {
          tree.splice(i, 1);
        }
        return true;
      }
    }
    return false;
  }

  private addFileToTree(tree: FileNode[], file: FileNode) {
    const parts = file.path.split("/");
    let currentLevel = tree;

    parts.forEach((part, index) => {
      const isLastPart = index === parts.length - 1;
      let node = currentLevel.find((n) => n.name === part);

      if (!node) {
        node = {
          name: part,
          path: parts.slice(0, index + 1).join("/"),
          isFolder: !isLastPart,
          children: [],
          expanded: true,
          fileInfo: isLastPart ? file.fileInfo : undefined,
        };
        currentLevel.push(node);
      }

      if (!isLastPart) {
        currentLevel = node.children;
      }
    });
  }
  private async exportToArweave() {
    const filesToExport = this.flattenFileTree(this.filesToExport);
    this.close();
    await this.plugin.exportFilesToArweave(filesToExport);
  }

  private async importFiles() {
    const filesToImport = this.flattenFileTree(this.filesToImport);
    this.close();
    await this.plugin.importFilesFromArweave(filesToImport);
  }

  private flattenFileTree(nodes: FileNode[]): string[] {
    let files: string[] = [];
    for (const node of nodes) {
      if (node.isFolder) {
        files = files.concat(this.flattenFileTree(node.children));
      } else {
        files.push(node.path);
      }
    }
    return files;
  }

  private async getModifiedOrNewFiles(): Promise<TFile[]> {
    const modifiedOrNewFiles: TFile[] = [];
    const files = this.plugin.app.vault.getFiles();

    for (const file of files) {
      const currentHash = await this.plugin.getFileHash(file);
      const remoteConfig = this.plugin.settings.remoteUploadConfig[file.path];

      if (!remoteConfig || remoteConfig.fileHash !== currentHash) {
        modifiedOrNewFiles.push(file);
      }
    }

    return modifiedOrNewFiles;
  }

  private async getFilesToImport(
    remoteUploadConfig: UploadConfig,
  ): Promise<FileNode[]> {
    const filesToImport: FileNode[] = [];

    for (const [filePath, remoteFileInfo] of Object.entries(
      remoteUploadConfig,
    )) {
      const localFile = this.app.vault.getAbstractFileByPath(filePath);
      if (localFile instanceof TFile) {
        const localHash = await this.plugin.getFileHash(localFile);
        if (localHash !== remoteFileInfo.fileHash) {
          filesToImport.push(this.createFileNode(filePath, remoteFileInfo));
        }
      } else {
        // File doesn't exist locally, so it needs to be imported
        filesToImport.push(this.createFileNode(filePath, remoteFileInfo));
      }
    }

    return filesToImport;
  }

  private createFileNode(filePath: string, fileInfo: FileUploadInfo): FileNode {
    return {
      name: filePath.split("/").pop() || "",
      path: filePath,
      fileInfo: fileInfo,
      isFolder: false,
      children: [],
      expanded: false,
    };
  }
}
