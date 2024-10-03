import {
  ItemView,
  WorkspaceLeaf,
  TFile,
  TFolder,
  TAbstractFile,
} from "obsidian";
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

export const SYNC_SIDEBAR_VIEW = "arweave-sync-view";

export class SyncSidebar extends ItemView {
  private plugin: ArweaveSync;
  private currentTab: "local" | "remote" = "local";
  private localFiles: FileNode[] = [];
  private remoteFiles: FileNode[] = [];
  private filesToExport: FileNode[] = [];
  private filesToImport: FileNode[] = [];
  private contentContainer: HTMLElement;

  constructor(leaf: WorkspaceLeaf, plugin: ArweaveSync) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return SYNC_SIDEBAR_VIEW;
  }

  getDisplayText(): string {
    return "Arweave Sync";
  }

  getIcon(): string {
    return "sync";
  }

  async onOpen() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("arweave-sync-sidebar");
    this.renderTabs();
    this.contentContainer = containerEl.createEl("div", {
      cls: "content-container",
    });
    await this.initializeFiles();
    await this.renderContent();
  }

  private renderTabs() {
    const tabContainer = this.containerEl.createEl("div", {
      cls: "tab-container",
    });

    const localTab = tabContainer.createEl("div", {
      cls: `tab ${this.currentTab === "local" ? "active" : ""}`,
      text: "Local Files",
    });
    localTab.addEventListener("click", () => this.switchTab("local"));

    const remoteTab = tabContainer.createEl("div", {
      cls: `tab ${this.currentTab === "remote" ? "active" : ""}`,
      text: "Remote Files",
    });
    remoteTab.addEventListener("click", () => this.switchTab("remote"));
  }

  private async switchTab(tab: "local" | "remote") {
    this.currentTab = tab;
    await this.renderContent();
  }

  private async initializeFiles() {
    const modifiedOrNewFiles = await this.getModifiedOrNewFiles();
    this.localFiles = this.buildFileTree(modifiedOrNewFiles);
    this.remoteFiles = await this.getNewOrModifiedRemoteFiles();
    this.filesToImport = [];
    this.filesToExport = [];
  }

  private async renderContent() {
    this.contentContainer.empty();

    const fileColumns = this.contentContainer.createEl("div", {
      cls: "file-columns",
    });

    if (this.currentTab === "local") {
      this.renderFileColumn(
        fileColumns,
        this.localFiles,
        "Unsynced Local Files",
        true,
      );
      this.renderFileColumn(
        fileColumns,
        this.filesToExport,
        "Files to Export",
        false,
      );
    } else {
      this.renderFileColumn(
        fileColumns,
        this.remoteFiles,
        "Remote Files",
        true,
      );
      this.renderFileColumn(
        fileColumns,
        this.filesToImport,
        "Files to Import",
        false,
      );
    }

    const submitButton = this.contentContainer.createEl("button", {
      text: `Submit ${this.currentTab === "local" ? "Export" : "Import"}`,
      cls: "mod-cta submit-changes",
    });
    submitButton.addEventListener("click", () => this.submitChanges());
  }

  private renderFileColumn(
    parentEl: HTMLElement,
    files: FileNode[],
    title: string,
    isSource: boolean,
  ) {
    const columnEl = parentEl.createEl("div", { cls: "file-column" });
    columnEl.createEl("h3", { text: title });
    const treeContainer = columnEl.createEl("div", {
      cls: "file-tree-container",
    });
    const treeEl = treeContainer.createEl("div", { cls: "file-tree" });
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

    const spacerEl = parentEl.createEl("div");
    spacerEl.style.width = `${200 - depth * 17}px`;
    spacerEl.style.height = "0.1px";
    spacerEl.style.marginBottom = "0px";

    nodes.forEach((node) => {
      const itemEl = parentEl.createEl("div", {
        cls: `tree-item ${node.isFolder ? "nav-folder" : "nav-file"}`,
      });

      const contentEl = itemEl.createEl("div", {
        cls: `tree-item-self is-clickable ${
          node.isFolder ? "nav-folder-title" : "nav-file-title"
        } ${node.isFolder ? "mod-collapsible" : ""}`,
        attr: { "data-path": node.path },
      });

      contentEl.setAttribute("draggable", "true");

      contentEl.style.setProperty(
        "margin-inline-start",
        `${depth * 17 - 17}px !important`,
      );
      contentEl.style.setProperty(
        "padding-inline-start",
        `${24 + depth * 17}px !important`,
      );

      if (node.isFolder) {
        this.renderFolderNode(node, contentEl, itemEl, isSource, depth);
      } else {
        this.renderFileNode(node, contentEl, isSource);
      }
    });
  }

  private renderFolderNode(
    node: FileNode,
    contentEl: HTMLElement,
    itemEl: HTMLElement,
    isSource: boolean,
    depth: number,
  ) {
    const toggleEl = contentEl.createEl("div", {
      cls: "tree-item-icon collapse-icon nav-folder-collapse-indicator",
    });
    const chevronSvg = this.createChevronSvg();
    toggleEl.appendChild(chevronSvg);

    const nameEl = contentEl.createEl("div", {
      cls: "tree-item-inner nav-folder-title-content",
      text: node.name,
    });

    const childrenEl = itemEl.createEl("div", {
      cls: "tree-item-children nav-folder-children",
    });

    const toggleFolder = (e: MouseEvent) => {
      e.stopPropagation();
      node.expanded = !node.expanded;
      this.updateChevronRotation(chevronSvg, node.expanded);
      childrenEl.style.display = node.expanded ? "block" : "none";
      if (node.expanded && !childrenEl.hasChildNodes()) {
        this.renderFileNodes(node.children, childrenEl, isSource, depth + 1);
      }
    };

    contentEl.addEventListener("click", toggleFolder);

    if (node.expanded) {
      this.updateChevronRotation(chevronSvg, true);
      this.renderFileNodes(node.children, childrenEl, isSource, depth + 1);
    } else {
      childrenEl.style.display = "none";
    }
  }

  private async renderFileNode(
    node: FileNode,
    contentEl: HTMLElement,
    isSource: boolean,
  ) {
    const nameEl = contentEl.createEl("div", {
      cls: "tree-item-inner nav-file-title-content",
      text: this.displayFileName(node.name),
    });

    if (node.fileInfo) {
      contentEl.setAttribute(
        "title",
        `Last modified: ${new Date(node.fileInfo.timestamp).toLocaleString()}
  Version: ${node.fileInfo.versionNumber}`,
      );

      const syncState = await this.plugin.getFileSyncState(
        this.plugin.app.vault.getAbstractFileByPath(node.path) as TFile,
      );
      contentEl.addClass(syncState);
    }

    contentEl.addEventListener("click", () =>
      this.toggleFileSelection(node, isSource),
    );
  }

  private createChevronSvg(): SVGElement {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    svg.setAttribute("width", "24");
    svg.setAttribute("height", "24");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.classList.add("svg-icon", "right-triangle");

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M3 8L12 17L21 8");
    svg.appendChild(path);

    return svg;
  }

  private updateChevronRotation(chevronSvg: SVGElement, expanded: boolean) {
    chevronSvg.style.transform = expanded ? "" : "rotate(-90deg)";
  }

  private toggleFolderContents(
    itemEl: HTMLElement,
    node: FileNode,
    isSource: boolean,
    depth: number,
  ) {
    const existingContents = itemEl.querySelector(".nav-folder-children");
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
    const childrenEl = itemEl.createEl("div", { cls: "nav-folder-children" });
    this.renderFileNodes(node.children, childrenEl, isSource, depth + 1);
  }

  private displayFileName(fileName: string): string {
    return fileName.endsWith(".md") ? fileName.slice(0, -3) : fileName;
  }

  private toggleFileSelection(file: FileNode, isSource: boolean) {
    if (this.currentTab === "local") {
      if (isSource) {
        this.moveFileToExport(file);
      } else {
        this.removeFileFromExport(file);
      }
    } else {
      if (isSource) {
        this.moveFileToImport(file);
      } else {
        this.removeFileFromImport(file);
      }
    }
    this.renderContent();
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

  private async submitChanges() {
    if (this.currentTab === "local") {
      await this.submitExport();
    } else {
      await this.submitImport();
    }
  }

  private async submitExport() {
    const filesToExport = this.flattenFileTree(this.filesToExport);
    await this.plugin.exportFilesToArweave(filesToExport);
    await this.initializeFiles();
    await this.renderContent();
  }

  private async submitImport() {
    const filesToImport = this.flattenFileTree(this.filesToImport);
    await this.plugin.importFilesFromArweave(filesToImport);
    await this.initializeFiles();
    await this.renderContent();
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
      const syncState = await this.plugin.getFileSyncState(file);
      if (syncState === "new-file" || syncState === "updated-file") {
        modifiedOrNewFiles.push(file);
      }
    }

    return modifiedOrNewFiles;
  }

  private async getNewOrModifiedRemoteFiles(): Promise<FileNode[]> {
    const remoteConfig = this.plugin.settings.remoteUploadConfig;
    const newOrModifiedFiles: FileNode[] = [];

    for (const [filePath, remoteFileInfo] of Object.entries(remoteConfig)) {
      const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
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

  private buildFileTree(files: TFile[] | FileNode[]): FileNode[] {
    const root: FileNode[] = [];
    const pathMap: Record<string, FileNode> = {};

    const processFile = (file: TFile | FileNode) => {
      const path = file instanceof TFile ? file.path : file.path;
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
            pathMap[parentPath].children.push(newNode);
          }
        }
      });

      // Add file info to the leaf node
      if (file instanceof TFile) {
        const localConfig = this.plugin.settings.localUploadConfig[file.path];
        pathMap[path].fileInfo = {
          txId: localConfig?.txId || "",
          timestamp: file.stat.mtime,
          fileHash: "",
          encrypted: false,
          filePath: file.path,
          previousVersionTxId: localConfig?.previousVersionTxId || null,
          versionNumber: localConfig?.versionNumber || 1,
        };
      } else if (file.fileInfo) {
        pathMap[path].fileInfo = file.fileInfo;
      }
    };

    files.forEach(processFile);
    return root;
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

  private getSyncStatus(node: FileNode): string {
    if (this.currentTab === "local") {
      if (!node.fileInfo) return "not-synced";
      return node.fileInfo.timestamp > Date.now() - 3600000
        ? "modified"
        : "synced";
    } else {
      return "remote";
    }
  }

  async refresh() {
    await this.initializeFiles();
    this.renderContent();
  }

  async onClose() {
    // Clean up event listeners if any
  }
}
