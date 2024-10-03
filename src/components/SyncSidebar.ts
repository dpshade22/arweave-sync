import { ItemView, WorkspaceLeaf, TFile, TAbstractFile } from "obsidian";
import ArweaveSync from "../main";
import { FileUploadInfo } from "../types";

interface FileNode {
  name: string;
  path: string;
  fileInfo?: FileUploadInfo;
  isFolder: boolean;
  children: FileNode[];
  expanded: boolean;
  syncState?: "new-file" | "updated-file" | "synced";
  localNewerVersion?: boolean;
}

export const SYNC_SIDEBAR_VIEW = "arweave-sync-view";

export class SyncSidebar extends ItemView {
  private plugin: ArweaveSync;
  private currentTab: "export" | "import" = "export";
  private files: Record<"export" | "import", FileNode[]> = {
    export: [],
    import: [],
  };
  private filesToSync: Record<"export" | "import", FileNode[]> = {
    export: [],
    import: [],
  };
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
    return "wallet";
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
    ["export", "import"].forEach((tab) => {
      const tabEl = tabContainer.createEl("div", {
        cls: `tab ${this.currentTab === tab ? "active" : ""}`,
        text: `${tab.charAt(0).toUpperCase() + tab.slice(1)} Files`,
      });
      tabEl.addEventListener("click", () =>
        this.switchTab(tab as "export" | "import"),
      );
    });
  }

  private async switchTab(tab: "export" | "import") {
    if (this.currentTab !== tab) {
      this.currentTab = tab;
      this.updateTabStyles();
      await this.renderContent();
    }
  }

  private updateTabStyles() {
    this.containerEl.querySelectorAll(".tab").forEach((tab) => {
      tab.classList.toggle(
        "active",
        tab.textContent?.toLowerCase().startsWith(this.currentTab),
      );
    });
  }

  private async initializeFiles() {
    this.files.export = this.buildFileTree(await this.getModifiedOrNewFiles());
    this.files.import = await this.getNewOrModifiedRemoteFiles();
    this.filesToSync = { export: [], import: [] };
  }

  private async renderContent() {
    const folderState = this.saveFolderState();
    this.contentContainer.empty();

    if (this.isEmptyContent()) {
      this.showNoFilesMessage();
      return;
    }

    this.renderFileColumns();
    this.renderSubmitButton();
    this.applyFolderState(folderState);
  }

  private isEmptyContent(): boolean {
    return (
      this.files[this.currentTab].length === 0 &&
      this.filesToSync[this.currentTab].length === 0
    );
  }

  private renderFileColumns() {
    const fileColumns = this.contentContainer.createEl("div", {
      cls: "file-columns",
    });
    this.renderFileColumn(
      fileColumns,
      this.files[this.currentTab],
      `Unsynced Files`,
      true,
    );
    this.renderFileColumn(
      fileColumns,
      this.filesToSync[this.currentTab],
      `Files to ${this.currentTab === "export" ? "Export" : "Import"}`,
      false,
    );
  }

  private renderSubmitButton() {
    const submitButton = this.contentContainer.createEl("button", {
      text: `Submit ${this.currentTab === "export" ? "Export" : "Import"}`,
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
    nodes
      .filter((node) => !node.isFolder || node.children.length > 0)
      .sort((a, b) => {
        if (a.isFolder === b.isFolder) return a.name.localeCompare(b.name);
        return a.isFolder ? -1 : 1;
      })
      .forEach((node) => {
        const itemEl = parentEl.createEl("div", {
          cls: `tree-item ${node.isFolder ? "nav-folder" : "nav-file"}`,
        });
        const contentEl = itemEl.createEl("div", {
          cls: `tree-item-self is-clickable ${node.isFolder ? "nav-folder-title mod-collapsible" : "nav-file-title"}`,
          attr: { "data-path": node.path, draggable: "true" },
        });

        this.setNodeStyles(contentEl, depth);

        node.isFolder
          ? this.renderFolderNode(node, contentEl, itemEl, isSource, depth)
          : this.renderFileNode(node, contentEl, isSource);
      });
  }

  private setNodeStyles(contentEl: HTMLElement, depth: number) {
    contentEl.style.setProperty(
      "margin-inline-start",
      `${depth * 17 - 17}px !important`,
    );
    contentEl.style.setProperty(
      "padding-inline-start",
      `${24 + depth * 17}px !important`,
    );
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

    this.updateChevronRotation(chevronSvg, node.expanded);

    contentEl.createEl("div", {
      cls: "tree-item-inner nav-folder-title-content",
      text: node.name,
    });

    const childrenEl = itemEl.createEl("div", {
      cls: "tree-item-children nav-folder-children",
    });

    childrenEl.style.display = node.expanded ? "block" : "none";

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
      this.renderFileNodes(node.children, childrenEl, isSource, depth + 1);
    }
  }

  private async renderFileNode(
    node: FileNode,
    contentEl: HTMLElement,
    isSource: boolean,
  ) {
    const fileTitleEl = contentEl.createEl("div", {
      cls: "tree-item-inner nav-file-title-content",
      text: this.displayFileName(node.name),
    });

    if (node.fileInfo) {
      this.setFileNodeAttributes(contentEl, node);
    }

    contentEl.addEventListener("click", () =>
      this.toggleFileSelection(node, isSource),
    );

    if (node.localNewerVersion) {
      contentEl.addClass("has-local-newer-version");
      const indicatorContainer = contentEl.createEl("div", {
        cls: "tree-item nav-file local-newer-version-container",
      });
      indicatorContainer.createEl("div", {
        cls: "tree-item-self local-newer-version",
        text: "Newer local version",
      });
    }
  }

  private async setFileNodeAttributes(contentEl: HTMLElement, node: FileNode) {
    if (node.fileInfo) {
      contentEl.setAttribute(
        "title",
        `Last modified: ${new Date(node.fileInfo.timestamp).toLocaleString()}\nVersion: ${node.fileInfo.versionNumber}`,
      );
    }

    if (node.path) {
      const file = this.plugin.app.vault.getAbstractFileByPath(
        node.path,
      ) as TFile;
      if (file instanceof TFile) {
        const syncState = await this.plugin.getFileSyncState(file);
        contentEl.addClass(syncState);
      }
    }
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

  private displayFileName(fileName: string): string {
    return fileName.endsWith(".md") ? fileName.slice(0, -3) : fileName;
  }

  private toggleFileSelection(file: FileNode, isSource: boolean) {
    const sourceTree = isSource ? this.files : this.filesToSync;
    const targetTree = isSource ? this.filesToSync : this.files;

    sourceTree[this.currentTab] = this.removeFileFromTree(
      sourceTree[this.currentTab],
      file.path,
    );
    targetTree[this.currentTab] = this.addFileToTree(
      targetTree[this.currentTab],
      file,
    );

    this.files[this.currentTab] = this.removeEmptyFolders(
      this.files[this.currentTab],
    );
    this.filesToSync[this.currentTab] = this.removeEmptyFolders(
      this.filesToSync[this.currentTab],
    );
    this.renderContent();
  }

  private removeFileFromTree(tree: FileNode[], path: string): FileNode[] {
    return tree.filter((node) => {
      if (node.path === path) {
        return false;
      }
      if (node.isFolder) {
        node.children = this.removeFileFromTree(node.children, path);
        return node.children.length > 0 || path.startsWith(node.path + "/");
      }
      return true;
    });
  }

  private addFileToTree(tree: FileNode[], file: FileNode): FileNode[] {
    const parts = file.path.split("/");
    let currentLevel = tree;
    let currentPath = "";

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      currentPath += (i > 0 ? "/" : "") + part;
      const isLastPart = i === parts.length - 1;

      let existingNode = currentLevel.find((node) => node.path === currentPath);

      if (!existingNode) {
        const newNode: FileNode = {
          name: part,
          path: currentPath,
          isFolder: !isLastPart,
          children: [],
          expanded: true,
          fileInfo: isLastPart ? file.fileInfo : undefined,
        };
        currentLevel.push(newNode);
        existingNode = newNode;
      }

      if (!isLastPart) {
        if (!existingNode.isFolder) {
          existingNode.isFolder = true;
          existingNode.children = [];
        }
        currentLevel = existingNode.children;
      }
    }

    return tree;
  }

  private async submitChanges() {
    const filesToSync = this.flattenFileTree(this.filesToSync[this.currentTab]);
    if (this.currentTab === "export") {
      await this.plugin.exportFilesToArweave(filesToSync);
    } else {
      await this.plugin.importFilesFromArweave(filesToSync);
    }
    await this.initializeFiles();
    await this.renderContent();
  }

  private flattenFileTree(nodes: FileNode[]): string[] {
    return nodes.reduce((files, node) => {
      return node.isFolder
        ? files.concat(this.flattenFileTree(node.children))
        : files.concat(node.path);
    }, [] as string[]);
  }

  private async getModifiedOrNewFiles(): Promise<TFile[]> {
    const files = this.plugin.app.vault.getFiles();
    return (
      await Promise.all(
        files.map(async (file) => {
          const syncState = await this.plugin.getFileSyncState(file);
          return syncState === "new-file" || syncState === "updated-file"
            ? file
            : null;
        }),
      )
    ).filter((file): file is TFile => file !== null);
  }

  private async getNewOrModifiedRemoteFiles(): Promise<FileNode[]> {
    const remoteConfig = this.plugin.settings.remoteUploadConfig;
    const localConfig = this.plugin.settings.localUploadConfig;
    const newOrModifiedFiles: FileNode[] = [];

    for (const [filePath, remoteFileInfo] of Object.entries(remoteConfig)) {
      const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
      const localFileInfo = localConfig[filePath];

      if (file instanceof TFile) {
        const localHash = await this.plugin.getFileHash(file);
        if (localHash !== remoteFileInfo.fileHash) {
          const fileNode = this.createFileNode(filePath, remoteFileInfo);
          fileNode.localNewerVersion =
            localFileInfo && localFileInfo.timestamp > remoteFileInfo.timestamp;
          if (!fileNode.localNewerVersion) {
            newOrModifiedFiles.push(fileNode);
          }
        }
      } else if (!localFileInfo) {
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

  async updateFileStatus(file: TFile) {
    console.log("Updating file status:", file.path);
    const folderState = this.saveFolderState();

    try {
      const syncState = await this.plugin.getFileSyncState(file);

      if (syncState === "synced") {
        this.removeFileFromSidebar(file.path);
      } else {
        const fileNode = this.findFileNode(
          this.files[this.currentTab],
          file.path,
        );
        if (fileNode) {
          fileNode.syncState = syncState;
          this.updateFileNodeInDOM(fileNode);
        } else {
          await this.initializeFiles();
          await this.renderContent();
        }
      }
    } catch (error) {
      console.error("Error getting file sync state:", error);
      this.removeFileFromSidebar(file.path);
    }

    this.applyFolderState(folderState);
  }

  private removeFileFromSidebar(filePath: string) {
    const folderState = this.saveFolderState();

    this.files.export = this.removeFileFromTree(this.files.export, filePath);
    this.files.import = this.removeFileFromTree(this.files.import, filePath);

    this.filesToSync.export = this.removeFileFromTree(
      this.filesToSync.export,
      filePath,
    );
    this.filesToSync.import = this.removeFileFromTree(
      this.filesToSync.import,
      filePath,
    );

    this.files.export = this.removeEmptyFolders(this.files.export);
    this.files.import = this.removeEmptyFolders(this.files.import);
    this.filesToSync.export = this.removeEmptyFolders(this.filesToSync.export);
    this.filesToSync.import = this.removeEmptyFolders(this.filesToSync.import);

    this.renderContent();

    this.applyFolderState(folderState);

    if (this.isEmptyContent()) {
      this.showNoFilesMessage();
    }
  }

  private removeEmptyFolders(tree: FileNode[]): FileNode[] {
    return tree.filter((node) => {
      if (node.isFolder) {
        node.children = this.removeEmptyFolders(node.children);
        return node.children.length > 0;
      }
      return true;
    });
  }

  private showNoFilesMessage() {
    this.contentContainer.createEl("div", {
      cls: "no-files-message",
      text: "No files to sync",
    });
  }

  private findFileNode(nodes: FileNode[], path: string): FileNode | null {
    for (const node of nodes) {
      if (node.path === path) {
        return node;
      }
      if (node.isFolder) {
        const found = this.findFileNode(node.children, path);
        if (found) return found;
      }
    }
    return null;
  }

  private updateFileNodeInDOM(fileNode: FileNode) {
    const fileEl = this.containerEl.querySelector(
      `[data-path="${fileNode.path}"]`,
    );
    if (fileEl) {
      fileEl.classList.remove("new-file", "updated-file", "synced");
      if (fileNode.syncState) {
        fileEl.classList.add(fileNode.syncState);
      }
    }
  }

  private saveFolderState(): Record<string, boolean> {
    const folderState: Record<string, boolean> = {};
    this.containerEl.querySelectorAll(".folder-item").forEach((folderEl) => {
      const path = folderEl.getAttribute("data-path");
      const isExpanded = folderEl.classList.contains("expanded");
      if (path) {
        folderState[path] = isExpanded;
      }
    });
    return folderState;
  }

  private applyFolderState(folderState: Record<string, boolean>) {
    Object.entries(folderState).forEach(([path, isExpanded]) => {
      const folderEl = this.containerEl.querySelector(
        `.folder-item[data-path="${path}"]`,
      );
      if (folderEl) {
        const toggleEl = folderEl.querySelector(".folder-toggle");
        const childrenEl = folderEl.querySelector(".folder-contents");
        if (isExpanded) {
          folderEl.classList.add("expanded");
          if (toggleEl instanceof HTMLElement) {
            toggleEl.style.transform = "rotate(90deg)";
          }
          if (childrenEl instanceof HTMLElement) {
            childrenEl.style.display = "block";
          }
        } else {
          folderEl.classList.remove("expanded");
          if (toggleEl instanceof HTMLElement) {
            toggleEl.style.transform = "rotate(0deg)";
          }
          if (childrenEl instanceof HTMLElement) {
            childrenEl.style.display = "none";
          }
        }
      }
    });
  }

  async refresh() {
    await this.initializeFiles();
    this.renderContent();
  }

  async onClose() {
    // Clean up event listeners if any
  }
}
