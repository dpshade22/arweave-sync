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
    this.currentTab = tab;
    this.updateTabStyles();
    await this.renderContent();
  }

  private updateTabStyles() {
    const tabs = this.containerEl.querySelectorAll(".tab");
    tabs.forEach((tab) => {
      if (tab.textContent?.toLowerCase().startsWith(this.currentTab)) {
        tab.addClass("active");
      } else {
        tab.removeClass("active");
      }
    });
  }

  private async initializeFiles() {
    this.files.export = this.buildFileTree(await this.getModifiedOrNewFiles());
    this.files.import = await this.getNewOrModifiedRemoteFiles();
    this.filesToSync = { export: [], import: [] };
  }

  private async renderContent() {
    this.contentContainer.empty();
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
    nodes.sort((a, b) =>
      a.isFolder === b.isFolder
        ? a.name.localeCompare(b.name)
        : a.isFolder
          ? -1
          : 1,
    );

    const spacerEl = parentEl.createEl("div");
    spacerEl.style.width = `${200 - depth * 17}px`;
    spacerEl.style.height = "0.1px";
    spacerEl.style.marginBottom = "0px";

    nodes.forEach((node) => {
      const itemEl = parentEl.createEl("div", {
        cls: `tree-item ${node.isFolder ? "nav-folder" : "nav-file"}`,
      });
      const contentEl = itemEl.createEl("div", {
        cls: `tree-item-self is-clickable ${node.isFolder ? "nav-folder-title mod-collapsible" : "nav-file-title"}`,
        attr: { "data-path": node.path, draggable: "true" },
      });

      contentEl.style.setProperty(
        "margin-inline-start",
        `${depth * 17 - 17}px !important`,
      );
      contentEl.style.setProperty(
        "padding-inline-start",
        `${24 + depth * 17}px !important`,
      );

      node.isFolder
        ? this.renderFolderNode(node, contentEl, itemEl, isSource, depth)
        : this.renderFileNode(node, contentEl, isSource);
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

    // Set initial rotation based on expanded state
    this.updateChevronRotation(chevronSvg, node.expanded);

    contentEl.createEl("div", {
      cls: "tree-item-inner nav-folder-title-content",
      text: node.name,
    });

    const childrenEl = itemEl.createEl("div", {
      cls: "tree-item-children nav-folder-children",
    });

    if (!node.expanded) {
      childrenEl.style.display = "none";
    }

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
    contentEl.createEl("div", {
      cls: "tree-item-inner nav-file-title-content",
      text: this.displayFileName(node.name),
    });

    if (node.fileInfo) {
      contentEl.setAttribute(
        "title",
        `Last modified: ${new Date(node.fileInfo.timestamp).toLocaleString()}\nVersion: ${node.fileInfo.versionNumber}`,
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

  private displayFileName(fileName: string): string {
    return fileName.endsWith(".md") ? fileName.slice(0, -3) : fileName;
  }

  private toggleFileSelection(file: FileNode, isSource: boolean) {
    const sourceArray = this.files[this.currentTab];
    const targetArray = this.filesToSync[this.currentTab];

    if (isSource) {
      this.removeFileFromTree(sourceArray, file.path);
      this.addFileToTree(targetArray, file);
    } else {
      this.removeFileFromTree(targetArray, file.path);
      this.addFileToTree(sourceArray, file);
    }
    this.renderContent();
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

  async refresh() {
    await this.initializeFiles();
    this.renderContent();
  }

  async onClose() {
    // Clean up event listeners if any
  }
}
