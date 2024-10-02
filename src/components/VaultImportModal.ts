import { App, Modal, ButtonComponent, TFile } from "obsidian";
import ArweaveSync from "../main";
import { FileUploadInfo, UploadConfig } from "../types";
import { VaultExportModal } from "./VaultExportModal";

interface FileNode {
  name: string;
  path: string;
  fileInfo?: FileUploadInfo;
  isFolder: boolean;
  children: FileNode[];
  expanded: boolean;
}

export class VaultImportModal extends Modal {
  private plugin: ArweaveSync;
  private remoteFiles: FileNode[];
  private filesToImport: FileNode[];
  private remoteContainer: HTMLElement;
  private importContainer: HTMLElement;
  private isImportView: boolean = true;
  private tabContainer: HTMLElement;
  private contentContainer: HTMLElement;
  private hasChangesToImport: boolean = false;
  private hasChangesToExport: boolean = false;

  constructor(app: App, plugin: ArweaveSync, remoteUploadConfig: UploadConfig) {
    super(app);
    this.plugin = plugin;
    this.remoteFiles = this.buildFileTree(remoteUploadConfig);
    this.filesToImport = [];
    this.initializeFilesToImport(remoteUploadConfig);
  }

  private async initializeFilesToImport(remoteUploadConfig: UploadConfig) {
    this.filesToImport = await this.getFilesToImport(remoteUploadConfig);
    this.hasChangesToImport = this.filesToImport.length > 0;
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
    const parts = filePath.split("/");
    return {
      name: parts[parts.length - 1],
      path: filePath,
      fileInfo: fileInfo,
      isFolder: false,
      children: [],
      expanded: false,
    };
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("vault-import-modal");

    this.tabContainer = contentEl.createDiv({ cls: "tab-container" });
    this.contentContainer = contentEl.createDiv({ cls: "content-container" });

    await this.checkForChangesToExport();
    this.createTabs();
    await this.renderContent();
  }

  private async checkForChangesToExport() {
    this.hasChangesToExport = await this.plugin.hasChangesToExport();
  }

  private createTabs() {
    const importTab = this.tabContainer.createDiv({ cls: "tab" });
    importTab.textContent = "Import from Arweave";
    if (this.hasChangesToImport) {
      importTab.addEventListener("click", () => this.switchView(true));
    } else {
      importTab.addClass("disabled");
      importTab.setAttribute("title", "No changes to import");
    }

    const exportTab = this.tabContainer.createDiv({ cls: "tab" });
    exportTab.textContent = "Export to Arweave";
    if (this.hasChangesToExport) {
      exportTab.addEventListener("click", () => this.switchView(false));
    } else {
      exportTab.addClass("disabled");
      exportTab.setAttribute("title", "No changes to export");
    }

    this.updateTabStyles();
  }

  private async switchView(isImportView: boolean) {
    if (
      (isImportView && !this.hasChangesToImport) ||
      (!isImportView && !this.hasChangesToExport)
    ) {
      return;
    }
    this.isImportView = isImportView;
    this.updateTabStyles();
    await this.renderContent();
  }

  private updateTabStyles() {
    const tabs = this.tabContainer.querySelectorAll(".tab");
    tabs.forEach((tab, index) => {
      if (
        (index === 0 && this.isImportView) ||
        (index === 1 && !this.isImportView)
      ) {
        tab.addClass("active");
      } else {
        tab.removeClass("active");
      }
    });
  }

  public async renderContent() {
    this.contentContainer.empty();

    if (this.isImportView) {
      await this.renderImportView();
    } else {
      await this.renderExportView();
    }
  }

  private async renderImportView() {
    const container = this.contentContainer.createDiv({
      cls: "file-transfer-container",
    });
    this.remoteContainer = container.createDiv({ cls: "remote-files" });
    this.importContainer = container.createDiv({ cls: "import-files" });
    this.renderFileTree(this.remoteFiles, this.remoteContainer, true);
    this.renderFileTree(this.filesToImport, this.importContainer, false);

    if (this.filesToImport.length === 0) {
      this.importContainer.createEl("p", {
        text: "No files need to be imported.",
        cls: "no-files-message",
      });
    }

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

  private async renderExportView() {
    const exportModal = new VaultExportModal(this.app, this.plugin);
    await exportModal.onOpen();
    this.contentContainer.appendChild(exportModal.contentEl.cloneNode(true));
  }

  private buildFileTree(uploadConfig: UploadConfig): FileNode[] {
    const root: FileNode[] = [];
    const pathMap: Record<string, FileNode> = {};

    Object.entries(uploadConfig).forEach(([path, fileInfo]) => {
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
      if (leafNode) {
        leafNode.fileInfo = fileInfo;
      }
    });

    return root;
  }

  private renderFileTree(
    files: FileNode[],
    containerEl: HTMLElement,
    isRemote: boolean,
  ) {
    containerEl.empty();
    const headerEl = containerEl.createEl("h3", {
      text: isRemote ? "Remote Files" : "Files to Import",
    });
    containerEl.appendChild(headerEl);
    const treeEl = containerEl.createEl("ul", { cls: "file-tree" });
    this.renderFileNodes(files, treeEl, isRemote, 0);
  }

  private renderFileNodes(
    nodes: FileNode[],
    parentEl: HTMLElement,
    isRemote: boolean,
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
          this.toggleFolderContents(itemEl, node, isRemote, depth);
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
          this.toggleFileSelection(node, isRemote),
        );
      }

      if (node.isFolder && node.expanded) {
        this.renderFolderContents(itemEl, node, isRemote, depth);
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
    isRemote: boolean,
    depth: number,
  ) {
    const existingContents = itemEl.querySelector(".folder-contents");
    if (existingContents) {
      existingContents.remove();
    }
    if (node.expanded) {
      this.renderFolderContents(itemEl, node, isRemote, depth);
    }
  }

  private renderFolderContents(
    itemEl: HTMLElement,
    node: FileNode,
    isRemote: boolean,
    depth: number,
  ) {
    const childrenEl = itemEl.createEl("ul", { cls: "folder-contents" });
    this.renderFileNodes(node.children, childrenEl, isRemote, depth + 1);
  }

  private displayFileName(fileName: string): string {
    return fileName.endsWith(".md") ? fileName.slice(0, -3) : fileName;
  }

  private toggleFileSelection(file: FileNode, isRemote: boolean) {
    if (isRemote) {
      this.moveFileToImport(file);
    } else {
      this.removeFileFromImport(file);
    }
    this.renderFileTree(this.remoteFiles, this.remoteContainer, true);
    this.renderFileTree(this.filesToImport, this.importContainer, false);
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
}
