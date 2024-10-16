import {
  ItemView,
  WorkspaceLeaf,
  TFile,
  Notice,
  Menu,
  request,
} from "obsidian";
import ArweaveSync from "../main";
import { ConfirmationModal } from "./ConfirmationModal";
import { RemoteFilePreviewModal } from "./RemoteFilePreviewModal";
import { FileUploadInfo, UploadConfig } from "../types";
import { LogManager } from "../utils/logManager";

interface FileNode {
  name: string;
  path: string;
  fileInfo?: FileUploadInfo;
  isFolder: boolean;
  children: FileNode[];
  expanded: boolean;
  syncState?: "new-file" | "updated-file" | "synced" | string;
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
  private totalExportSize: number = 0;
  private totalPrice: string = "0";
  private exportFiles: Set<string> = new Set();
  private currentBalance: string = "0";
  private newBalance: string = "0";
  private logManager: LogManager;

  constructor(leaf: WorkspaceLeaf, plugin: ArweaveSync) {
    super(leaf);
    this.plugin = plugin;
    this.logManager = new LogManager(this.plugin, "SyncSidebar");
    this.totalExportSize = 0;
    this.totalPrice = "0";
    this.exportFiles = new Set();
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

  isVisible(): boolean {
    return this.containerEl.isShown();
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

  private async renderContent() {
    const folderState = this.saveFolderState();
    this.contentContainer.empty();

    // Create a wrapper for the scrollable content
    const scrollableContent = this.contentContainer.createEl("div", {
      cls: "scrollable-content",
    });

    this.updateNoFilesMessageVisibility();

    if (!this.isEmptyContent()) {
      this.renderRootFolders(scrollableContent);
    }

    // Render submit button outside the scrollable content
    this.renderSubmitButton();

    this.applyFolderState(folderState);
  }

  private renderRootFolders(container: HTMLElement) {
    const filesToExportFolder: FileNode = {
      name: `Files to ${this.currentTab}`,
      path: `Files to ${this.currentTab}`,
      isFolder: true,
      children: this.filesToSync[this.currentTab],
      expanded: true,
    };

    const unsyncedFilesFolder: FileNode = {
      name: "Unsynced files",
      path: "Unsynced files",
      isFolder: true,
      children: this.files[this.currentTab],
      expanded: true,
    };

    const unsyncedFilesEl = container.createEl("div", { cls: "root-folder" });
    const filesToExportEl = container.createEl("div", { cls: "root-folder" });

    this.renderRootFolderNode(
      filesToExportFolder,
      filesToExportEl,
      filesToExportEl,
      false,
    );
    this.renderRootFolderNode(
      unsyncedFilesFolder,
      unsyncedFilesEl,
      unsyncedFilesEl,
      true,
    );
  }

  private renderRootFolderNode(
    node: FileNode,
    contentEl: HTMLElement,
    itemEl: HTMLElement,
    isSource: boolean,
  ) {
    const folderHeader = contentEl.createEl("div", {
      cls: "folder-header nav-folder-title is-clickable",
    });

    const toggleEl = folderHeader.createEl("div", {
      cls: "tree-item-icon collapse-icon nav-folder-collapse-indicator",
    });
    const chevronSvg = this.createChevronSvg();
    toggleEl.appendChild(chevronSvg);

    folderHeader.createEl("div", {
      text: node.name,
      cls: "tree-item-inner nav-folder-title-content",
    });

    const childrenEl = itemEl.createEl("div", { cls: "nav-folder-children" });

    childrenEl.style.display = node.expanded ? "block" : "none";

    const toggleFolder = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      node.expanded = !node.expanded;
      this.updateChevronRotation(chevronSvg, node.expanded);
      childrenEl.style.display = node.expanded ? "block" : "none";
      if (node.expanded && childrenEl.childElementCount === 0) {
        this.renderFileNodes(node.children, childrenEl, isSource, 1);
      }
    };

    let pressTimer: number;
    let longPressTriggered = false;
    let startX: number;
    let startY: number;

    const startPress = (e: MouseEvent | TouchEvent) => {
      startX = e instanceof MouseEvent ? e.clientX : e.touches[0].clientX;
      startY = e instanceof MouseEvent ? e.clientY : e.touches[0].clientY;
      pressTimer = window.setTimeout(() => {
        longPressTriggered = true;
        this.toggleAllFiles(node.children, isSource);
        if (navigator.vibrate) {
          navigator.vibrate(50);
        }
      }, 500);
    };

    const endPress = (e: MouseEvent | TouchEvent) => {
      clearTimeout(pressTimer);
      const endX =
        e instanceof MouseEvent ? e.clientX : e.changedTouches[0].clientX;
      const endY =
        e instanceof MouseEvent ? e.clientY : e.changedTouches[0].clientY;
      const distance = Math.sqrt(
        Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2),
      );

      if (!longPressTriggered && distance < 5) {
        toggleFolder(e);
      }
      longPressTriggered = false;
    };

    const cancelPress = () => {
      clearTimeout(pressTimer);
      longPressTriggered = false;
    };

    folderHeader.addEventListener("mousedown", startPress);
    folderHeader.addEventListener("touchstart", startPress, { passive: true });
    folderHeader.addEventListener("mouseup", endPress);
    folderHeader.addEventListener("touchend", endPress);
    folderHeader.addEventListener("mouseleave", cancelPress);
    folderHeader.addEventListener("touchcancel", cancelPress);

    if (node.expanded) {
      this.renderFileNodes(node.children, childrenEl, isSource, 1);
    }
  }

  private toggleAllFiles(files: FileNode[], isSource: boolean) {
    const allSelected = files.every((file) =>
      this.isFileSelected(file, isSource),
    );

    const processNode = (node: FileNode) => {
      if (node.isFolder) {
        // If it's a folder, process its children
        node.children = node.children.filter((child) => {
          if (child.isFolder) {
            processNode(child);
            // Keep the folder if it has children after processing
            return child.children.length > 0;
          } else {
            // For files, toggle selection
            if (allSelected) {
              this.removeFileFromSelection(child, isSource);
            } else {
              this.addFileToSelection(child, isSource);
            }
            // Always keep files
            return true;
          }
        });
      } else {
        // For files at the root level, toggle selection
        if (allSelected) {
          this.removeFileFromSelection(node, isSource);
        } else {
          this.addFileToSelection(node, isSource);
        }
      }
    };

    files.forEach(processNode);

    this.renderContent();
  }

  private isFileSelected(file: FileNode, isSource: boolean): boolean {
    const targetTree = isSource ? this.filesToSync : this.files;
    return (
      this.findNodeByPath(targetTree[this.currentTab], file.path) !== undefined
    );
  }

  private addFileToSelection(file: FileNode, isSource: boolean) {
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
  }

  private removeFileFromSelection(file: FileNode, isSource: boolean) {
    const sourceTree = isSource ? this.filesToSync : this.files;
    const targetTree = isSource ? this.files : this.filesToSync;

    sourceTree[this.currentTab] = this.removeFileFromTree(
      sourceTree[this.currentTab],
      file.path,
    );
    targetTree[this.currentTab] = this.addFileToTree(
      targetTree[this.currentTab],
      file,
    );
  }

  private renderTabs() {
    const tabContainer = this.containerEl.createEl("div", {
      cls: "tab-container",
    });

    const tabs = ["export", "import"] as const;
    tabs.forEach((tab) => {
      const tabEl = tabContainer.createEl("div", {
        cls: `tab ${this.currentTab === tab ? "active" : ""}`,
        text: `${tab.charAt(0).toUpperCase() + tab.slice(1)} Files`,
      });
      tabEl.addEventListener("click", () => this.switchTab(tab));
    });
  }

  public async switchTab(tab: "export" | "import") {
    if (this.currentTab !== tab) {
      if (this.currentTab === "export") {
        this.totalExportSize = 0;
        this.totalPrice = "0";
        this.exportFiles.clear();
      }

      this.currentTab = tab;
      this.updateTabStyles();
      this.updateNoFilesMessageVisibility();
      await this.renderContent();
      this.refresh();
    }
  }

  private updateTabStyles() {
    this.containerEl.querySelectorAll(".tab").forEach((tabEl) => {
      if (tabEl instanceof HTMLElement) {
        const isActive = tabEl.textContent
          ?.toLowerCase()
          .startsWith(this.currentTab);
        tabEl.classList.toggle("active", isActive);
      }
    });
  }

  private async initializeFiles() {
    this.files.export = await this.getLocalFilesForExport();
    this.files.import = await this.getRemoteFilesForImport();
    this.filesToSync = { export: [], import: [] };
  }

  private isEmptyContent(): boolean {
    return (
      this.files[this.currentTab].length === 0 &&
      this.filesToSync[this.currentTab].length === 0
    );
  }

  handleFileRename(file: TFile, oldPath: string) {
    // Remove the old file from the tree
    this.files[this.currentTab] = this.removeFileFromTree(
      this.files[this.currentTab],
      oldPath,
    );
    this.filesToSync[this.currentTab] = this.removeFileFromTree(
      this.filesToSync[this.currentTab],
      oldPath,
    );

    // Add the new file to the tree
    // const newFileNode = this.createFileNode(file.path, {
    //   txId: "",
    //   timestamp: file.stat.mtime,
    //   fileHash: "",
    //   encrypted: false,
    //   filePath: file.path,
    //   previousVersionTxId: null,
    //   versionNumber: 1,
    // });
    // this.files[this.currentTab] = this.addFileToTree(
    //   this.files[this.currentTab],
    //   newFileNode,
    // );

    // Re-render the content
    this.renderContent();
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
    const submitContainer = this.contentContainer.createEl("div", {
      cls: "submit-changes-container",
    });

    const submitButton = submitContainer.createEl("button", {
      text: `${this.currentTab === "export" ? "Export" : "Import"}`,
      cls: "mod-cta submit-changes",
      attr: {
        "data-state": "ready",
      },
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
      .filter((node) => {
        // Filter out synced files in the export tab
        if (this.currentTab === "export" && node.syncState === "synced") {
          return false;
        }
        return !node.isFolder || node.children.length > 0;
      })
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
          attr: { "data-path": node.path },
        });

        if (node.isFolder) {
          this.renderFolderNode(node, contentEl, itemEl, isSource, depth);
        } else {
          this.renderFileNode(node, contentEl, isSource);
        }
      });
  }

  private setNodeStyles(contentEl: HTMLElement, depth: number) {
    contentEl.style.setProperty(
      "margin-inline-start",
      `${depth * 13 - 13}px !important`,
    );
    contentEl.style.setProperty(
      "padding-inline-start",
      `${24 + depth * 13}px !important`,
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

    const toggleFolder = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      node.expanded = !node.expanded;
      this.updateChevronRotation(chevronSvg, node.expanded);
      childrenEl.style.display = node.expanded ? "block" : "none";
      if (node.expanded && childrenEl.childElementCount === 0) {
        this.renderFileNodes(node.children, childrenEl, isSource, depth + 1);
      }
    };

    let pressTimer: number;
    let longPressTriggered = false;
    let startX: number;
    let startY: number;

    const startPress = (e: MouseEvent | TouchEvent) => {
      startX = e instanceof MouseEvent ? e.clientX : e.touches[0].clientX;
      startY = e instanceof MouseEvent ? e.clientY : e.touches[0].clientY;
      pressTimer = window.setTimeout(() => {
        longPressTriggered = true;
        this.toggleEntireFolder(node, isSource);
        if (navigator.vibrate) {
          navigator.vibrate(50);
        }
      }, 500); // 500ms for long press
    };

    const endPress = (e: MouseEvent | TouchEvent) => {
      const endX =
        e instanceof MouseEvent ? e.clientX : e.changedTouches[0].clientX;
      const endY =
        e instanceof MouseEvent ? e.clientY : e.changedTouches[0].clientY;
      const distance = Math.sqrt(
        Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2),
      );

      clearTimeout(pressTimer);
      if (!longPressTriggered && distance < 5) {
        // 5px threshold for movement
        toggleFolder(e);
      }
      longPressTriggered = false;
    };

    const cancelPress = () => {
      clearTimeout(pressTimer);
      longPressTriggered = false;
    };

    contentEl.addEventListener("mousedown", startPress);
    contentEl.addEventListener("touchstart", startPress, { passive: true });

    contentEl.addEventListener("mouseup", endPress);
    contentEl.addEventListener("touchend", endPress);

    contentEl.addEventListener("mouseleave", cancelPress);
    contentEl.addEventListener("touchcancel", cancelPress);

    if (node.expanded) {
      this.renderFileNodes(node.children, childrenEl, isSource, depth + 1);
    }
  }

  private createArrowSvg(direction: "up" | "down"): SVGElement {
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
    svg.classList.add("svg-icon", "toggle-arrow", direction);

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute(
      "d",
      direction === "down" ? "M7 10l5 5 5-5" : "M7 15l5-5 5 5",
    );
    svg.appendChild(path);

    return svg;
  }

  private getFolderIconSvg(): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-folder"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;
  }

  private toggleEntireFolder(folder: FileNode, isSource: boolean) {
    const allFiles = this.getAllFilesInFolder(folder);
    allFiles.forEach((file) => this.toggleFileSelection(file, isSource));
    this.renderContent(); // Re-render to update the UI
  }

  private getAllFilesInFolder(folder: FileNode): FileNode[] {
    let files: FileNode[] = [];
    folder.children.forEach((child) => {
      if (child.isFolder) {
        files = files.concat(this.getAllFilesInFolder(child));
      } else {
        files.push(child);
      }
    });
    return files;
  }

  private async renderFileNode(
    node: FileNode,
    contentEl: HTMLElement,
    isSource: boolean,
  ) {
    contentEl.empty();

    // Add base classes
    contentEl.addClass("tree-item-self", "is-clickable", "nav-file-title");

    // Add sync state class
    if (node.syncState) {
      contentEl.addClass(node.syncState);
    }

    const innerEl = contentEl.createEl("div", {
      cls: "tree-item-inner nav-file-title-content",
      text: this.displayFileName(node.name),
    });

    if (node.fileInfo) {
      this.setFileNodeAttributes(contentEl, node);
    }

    contentEl.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.createContextMenu(node, e);
    });

    contentEl.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggleFileSelection(node, isSource);
    });
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
        const syncState =
          await this.plugin.vaultSyncManager.checkFileSync(file);
        contentEl.addClass(syncState.syncState);
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

  private updateNoFilesMessageVisibility() {
    const isEmpty = this.isEmptyContent();
    let messageContainer = this.contentContainer.querySelector(
      ".no-files-message-container",
    ) as HTMLElement | null;

    if (!messageContainer) {
      messageContainer = this.contentContainer.createEl("div", {
        cls: "no-files-message-container",
      });

      // Add the icon
      const iconEl = messageContainer.createEl("div", {
        cls: "no-files-icon",
        attr: { "aria-hidden": "true" },
      });
      iconEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-edit"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"></path></svg>`;

      // Add the main message
      messageContainer.createEl("div", {
        cls: "no-files-text",
        text: `No notes to ${this.currentTab === "export" ? "export" : "import"}`,
      });

      // Add the subtext
      messageContainer.createEl("div", {
        cls: "no-files-subtext",
        text: "Your notes will appear here when they're ready to sync.",
      });
    }

    if (messageContainer instanceof HTMLElement) {
      messageContainer.style.display = isEmpty ? "flex" : "none";
    }
  }

  private expandParentFolders(filePath: string, tree: FileNode[]) {
    const parts = filePath.split("/");
    let currentPath = "";
    for (let i = 0; i < parts.length - 1; i++) {
      currentPath += (i > 0 ? "/" : "") + parts[i];
      const folder = this.findNodeByPath(tree, currentPath);
      if (folder && folder.isFolder) {
        folder.expanded = true;
      }
    }
  }

  private findNodeByPath(
    nodes: FileNode[],
    path: string,
  ): FileNode | undefined {
    for (const node of nodes) {
      if (node.path === path) {
        return node;
      }
      if (node.isFolder && path.startsWith(node.path + "/")) {
        const found = this.findNodeByPath(node.children, path);
        if (found) return found;
      }
    }
    return undefined;
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

    // Expand parent folders in the target tree
    this.expandParentFolders(file.path, targetTree[this.currentTab]);

    this.files[this.currentTab] = this.removeEmptyFolders(
      this.files[this.currentTab],
    );
    this.filesToSync[this.currentTab] = this.removeEmptyFolders(
      this.filesToSync[this.currentTab],
    );

    // Immediately re-render the content to show the file movement
    this.updateNoFilesMessageVisibility();
    this.renderContent();

    // Asynchronously update the file size and price
    if (this.currentTab === "export") {
      const isAddingToExport = isSource;

      this.updateFileSizeAndPrice(file, isAddingToExport).then(() => {
        // Update the price display after the calculation is complete
        this.updatePriceDisplay();
      });
    }
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
    if (!file.path) {
      return tree;
    }

    const parts = file.path.split("/");
    let currentLevel: FileNode[] = tree;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part) continue; // Skip empty parts

      let existingNode = currentLevel.find((node) => node.name === part);

      if (i === parts.length - 1) {
        // This is the file name
        if (existingNode) {
          // Update existing node
          Object.assign(existingNode, file);
        } else {
          // Add new file node
          currentLevel.push(file);
        }
      } else {
        if (!existingNode) {
          // Create new folder node
          existingNode = {
            name: part,
            path: parts.slice(0, i + 1).join("/"),
            isFolder: true,
            children: [],
            expanded: false,
          };
          currentLevel.push(existingNode);
        }
        currentLevel = existingNode.children;
      }
    }

    return tree;
  }

  async submitChanges() {
    if (!this.plugin.vaultSyncManager.isWalletConnected()) {
      new Notice("Please connect a wallet before syncing.");
      return;
    }

    const submitButton = this.contentContainer.querySelector(
      ".submit-changes",
    ) as HTMLButtonElement;
    if (
      !submitButton ||
      submitButton.getAttribute("data-state") === "submitting"
    ) {
      return;
    }

    try {
      submitButton.setAttribute("data-state", "submitting");
      submitButton.disabled = true;
      submitButton.setText(
        `Submitting ${this.currentTab === "export" ? "Export" : "Import"}`,
      );
      submitButton.createSpan({ cls: "loading-dots" });

      const filesToSync = this.flattenFileTree(
        this.filesToSync[this.currentTab],
      );

      if (filesToSync.length === 0) {
        new Notice("No files selected for sync.");
        return;
      }

      if (this.currentTab === "export") {
        await this.plugin.vaultSyncManager.exportFilesToArweave(filesToSync);
      } else {
        await this.importFiles(filesToSync);
      }

      // After syncing, update the remote config and refresh the file list
      await this.plugin.vaultSyncManager.updateRemoteConfig();
      await this.initializeFiles();
      await this.renderContent();

      new Notice(
        `${this.currentTab === "export" ? "Export" : "Import"} completed successfully.`,
      );
    } catch (error) {
      new Notice(`Error during ${this.currentTab}: ${error.message}`);
    } finally {
      submitButton.setAttribute("data-state", "ready");
      submitButton.disabled = false;
      submitButton.setText(
        `Submit ${this.currentTab === "export" ? "Export" : "Import"}`,
      );
      submitButton.querySelector(".loading-dots")?.remove();
    }
  }

  private async importFiles(filePaths: string[]) {
    const importedFiles =
      await this.plugin.vaultSyncManager.importFilesFromArweave(filePaths);
    this.updateAfterImport(importedFiles);
  }

  private updateAfterImport(importedFiles: string[]) {
    importedFiles.forEach((filePath) => {
      const fileNode = this.removeFileFromTree(
        this.filesToSync.import,
        filePath,
      )[0];
      if (fileNode) {
        this.files.import = this.removeFileFromTree(
          this.files.import,
          filePath,
        );
        this.files.import = this.addFileToTree(this.files.import, fileNode);
      }
    });

    this.files.import = this.removeEmptyFolders(this.files.import);
    this.filesToSync.import = this.removeEmptyFolders(this.filesToSync.import);
  }

  private flattenFileTree(nodes: FileNode[]): string[] {
    return nodes.reduce((files, node) => {
      return node.isFolder
        ? files.concat(this.flattenFileTree(node.children))
        : files.concat(node.path);
    }, [] as string[]);
  }

  private async getLocalFilesForExport(): Promise<FileNode[]> {
    const newOrModifiedFiles: FileNode[] = [];
    const files = this.plugin.app.vault.getFiles();

    for (const file of files) {
      const { syncState, fileHash } =
        await this.plugin.vaultSyncManager.checkFileSync(file);

      if (syncState === "new-local" || syncState === "local-newer") {
        const localFileInfo = this.plugin.settings.localUploadConfig[file.path];
        const fileNode = this.createFileNode(
          file.path,
          {
            txId: localFileInfo?.txId || "",
            timestamp: file.stat.mtime,
            fileHash: fileHash,
            encrypted: false,
            filePath: file.path,
            previousVersionTxId: localFileInfo?.previousVersionTxId || null,
            versionNumber: (localFileInfo?.versionNumber || 0) + 1,
          },
          syncState,
        );

        newOrModifiedFiles.push(fileNode);
      }
    }

    return this.buildFileTree(newOrModifiedFiles);
  }

  async getRemoteFilesForImport(): Promise<FileNode[]> {
    const remoteConfig: UploadConfig = this.plugin.settings.remoteUploadConfig;
    const newOrModifiedFiles: FileNode[] = [];

    for (const [filePath, remoteFileInfo] of Object.entries(remoteConfig)) {
      const file = this.plugin.app.vault.getAbstractFileByPath(filePath);

      let syncState:
        | "new-local"
        | "new-remote"
        | "local-newer"
        | "remote-newer"
        | "synced"
        | "decrypt-failed";

      if (!file) {
        syncState = "new-remote";
      } else if (file instanceof TFile) {
        const result = await this.plugin.vaultSyncManager.checkFileSync(file);
        syncState = result.syncState;
      } else {
        continue;
      }

      if (
        syncState !== "synced" &&
        syncState !== "new-local" &&
        syncState !== "local-newer" &&
        syncState !== "decrypt-failed"
      ) {
        const fileNode = this.createFileNode(
          filePath,
          remoteFileInfo,
          syncState,
        );
        newOrModifiedFiles.push(fileNode);
      }
    }

    const fileTree = this.buildFileTree(newOrModifiedFiles);
    return fileTree;
  }

  private createFileNode(
    filePath: string,
    fileInfo: FileUploadInfo,
    syncState:
      | "new-local"
      | "new-remote"
      | "local-newer"
      | "remote-newer"
      | "synced",
  ): FileNode {
    return {
      name: filePath.split("/").pop() || "",
      path: filePath,
      fileInfo: fileInfo,
      isFolder: false,
      children: [],
      expanded: false,
      syncState: syncState,
    };
  }

  private buildFileTree(files: FileNode[]): FileNode[] {
    const root: FileNode[] = [];
    const pathMap: Record<string, FileNode> = {};

    files.forEach((file) => {
      const parts = file.path.split("/");
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
            syncState: index === parts.length - 1 ? file.syncState : undefined,
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
      if (file.fileInfo) {
        pathMap[file.path].fileInfo = file.fileInfo;
      }
    });

    return root;
  }

  async updateFileStatus(file: TFile) {
    const folderState = this.saveFolderState();

    try {
      const { syncState } =
        await this.plugin.vaultSyncManager.checkFileSync(file);

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

    this.updateNoFilesMessageVisibility();
    this.renderContent();

    this.applyFolderState(folderState);
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

  private showNoFilesMessage(show: boolean) {
    let messageContainer = this.contentContainer.querySelector(
      ".no-files-message-container",
    ) as HTMLElement | null;

    if (!messageContainer) {
      messageContainer = this.contentContainer.createEl("div", {
        cls: "no-files-message-container",
      });

      // Create an icon
      messageContainer.createEl("div", {
        cls: "no-files-icon",
        attr: { "aria-hidden": "true" },
      }).innerHTML =
        `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>`;

      // Create the message text
      messageContainer.createEl("div", {
        cls: "no-files-text",
        text: "No files to sync",
      });

      // Create a subtext
      messageContainer.createEl("div", {
        cls: "no-files-subtext",
        text: "Your files will appear here when they're ready to sync.",
      });
    }

    if (messageContainer instanceof HTMLElement) {
      messageContainer.style.display = show ? "flex" : "none";
    }
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

  private createContextMenu(file: FileNode, event: MouseEvent | TouchEvent) {
    const menu = new Menu();
    const actualFile = this.plugin.app.vault.getAbstractFileByPath(file.path);

    // Add default Obsidian menu items first
    if (actualFile instanceof TFile) {
      this.plugin.app.workspace.trigger(
        "file-menu",
        menu,
        actualFile,
        "file-explorer",
      );
    }

    // Add custom menu items
    menu.addSeparator();

    if (this.currentTab === "import") {
      menu.addItem((item) => {
        item
          .setTitle("Preview Remote File")
          .setIcon("eye")
          .onClick(() => this.previewRemoteFile(file));
      });
      if (actualFile instanceof TFile) {
        menu.addItem((item) => {
          item
            .setTitle("Replace remote file with local")
            .setIcon("upload-cloud")
            .onClick(() => this.replaceRemoteWithLocal(file));
        });
      }
    } else if (this.currentTab === "export" && actualFile instanceof TFile) {
      // Add "Open in new tab" option for export files
      menu.addItem((item) => {
        item
          .setTitle("Open in new tab")
          .setIcon("external-link")
          .onClick(() => {
            this.plugin.app.workspace.openLinkText(actualFile.path, "", true);
          });
      });
    }

    if (actualFile instanceof TFile) {
      menu.addItem((item) => {
        item
          .setTitle("Sync with Arweave")
          .setIcon("refresh-cw")
          .onClick(() => {
            // Implement sync with Arweave functionality
            this.plugin.vaultSyncManager.syncFile(actualFile);
          });
      });
    }

    // Add delete operations at the end
    if (this.currentTab === "import") {
      menu.addItem((item) => {
        item
          .setTitle("Delete file from Arweave")
          .setIcon("trash")
          .onClick(() => this.deleteRemoteFile(file));
      });
    } else if (this.currentTab === "export") {
      if (actualFile instanceof TFile) {
        menu.addItem((item) => {
          item
            .setTitle("Delete")
            .setIcon("trash")
            .onClick(() => {
              this.plugin.app.fileManager.trashFile(actualFile);
            });
        });
      }
    }

    // Show the menu at the determined position
    let x: number, y: number;
    if (event instanceof MouseEvent) {
      x = event.pageX;
      y = event.pageY;
    } else if (event instanceof TouchEvent) {
      if (event.touches.length > 0) {
        x = event.touches[0].clientX;
        y = event.touches[0].clientY;
      } else {
        x = 0;
        y = 0;
      }
    } else {
      x = 0;
      y = 0;
    }

    menu.showAtPosition({ x, y });
  }

  private async replaceRemoteWithLocal(file: FileNode) {
    try {
      const actualFile = this.plugin.app.vault.getAbstractFileByPath(file.path);
      if (actualFile instanceof TFile) {
        await this.plugin.vaultSyncManager.syncFile(actualFile);
        new Notice(
          `Replaced remote version of ${file.name} with local version.`,
        );
        this.refresh();
      } else {
        new Notice(`Error: ${file.name} not found in local vault.`);
      }
    } catch (error) {
      new Notice(`Failed to replace remote file: ${error.message}`);
    }
  }

  private async deleteRemoteFile(file: FileNode) {
    try {
      const confirmed = await this.confirmDeletion(file.name);
      if (confirmed) {
        await this.plugin.vaultSyncManager.deleteRemoteFile(file.path);
        new Notice(`Deleted remote file: ${file.name}`);
        this.refresh();
      }
    } catch (error) {
      new Notice(`Failed to delete remote file: ${error.message}`);
    }
  }

  private async confirmDeletion(fileName: string): Promise<boolean> {
    const modal = new ConfirmationModal(
      this.app,
      "Confirm Deletion",
      `<p>Are you sure you want to delete the remote version of <strong>${fileName}</strong>?</p><p class="warning">This action cannot be undone.</p>`,
      "Delete",
      "Cancel",
      true,
    );
    return await modal.awaitUserConfirmation();
  }

  private previewRemoteFile(file: FileNode) {
    new RemoteFilePreviewModal(this.app, this.plugin, file.path).open();
  }

  async refresh() {
    await this.initializeFiles();
    this.renderContent();
  }

  async onClose() {
    // Clean up event listeners if any
  }

  private async updateFileSizeAndPrice(
    file: FileNode,
    isAddingToExport: boolean,
  ): Promise<void> {
    if (!file.isFolder) {
      const filePath = file.path;
      const abstractFile =
        this.plugin.app.vault.getAbstractFileByPath(filePath);

      if (!(abstractFile instanceof TFile)) {
        this.logManager.error(`File not found: ${filePath}`);
        return;
      }

      const fileSize = abstractFile.stat.size;

      if (isAddingToExport) {
        if (!this.exportFiles.has(filePath)) {
          this.totalExportSize += fileSize;
          this.exportFiles.add(filePath);
        }
      } else {
        if (this.exportFiles.has(filePath)) {
          this.totalExportSize = Math.max(0, this.totalExportSize - fileSize);
          this.exportFiles.delete(filePath);
        }
      }

      await this.updateTotalPrice();
    } else {
    }
  }

  private async updateTotalPrice(): Promise<void> {
    if (this.totalExportSize > 0) {
      try {
        const url = `https://arweave.net/price/${this.totalExportSize}`;
        const response = await request({
          url: url,
          method: "GET",
        });
        const winston = parseInt(response);
        const ar = winston / 1000000000000;
        const precision = 2;
        this.totalPrice = ar.toPrecision(precision);

        // Fetch current balance
        const address = this.plugin.getWalletAddress();
        if (address) {
          const balanceWinston = await this.plugin
            .getArweave()
            .wallets.getBalance(address);
          const balanceAR = parseInt(balanceWinston) / 1000000000000;
          const decimalPlaces = this.totalPrice.split(".")[1]?.length || 0;
          this.currentBalance = balanceAR.toFixed(decimalPlaces);
          this.newBalance = (balanceAR - ar).toFixed(decimalPlaces);
        }
      } catch (error) {
        this.logManager.error(
          "Error fetching Arweave price or balance:",
          error,
        );
        this.totalPrice = "Error";
        this.currentBalance = "Error";
        this.newBalance = "Error";
      }
    } else {
      this.totalPrice = "0";
      this.newBalance = this.currentBalance;
    }
  }

  private updatePriceDisplay(): void {
    const priceInfoBox = this.contentContainer.querySelector(".price-info-box");
    if (priceInfoBox) {
      const currentBalanceEl = priceInfoBox.querySelector(".balance-display");
      const totalPriceEl = priceInfoBox.querySelector(".total-price-display");
      const newBalanceEl = priceInfoBox.querySelector(".new-balance-display");

      if (currentBalanceEl instanceof HTMLElement) {
        currentBalanceEl.setAttribute(
          "data-value",
          `${this.currentBalance} AR`,
        );
      }
      if (totalPriceEl instanceof HTMLElement) {
        totalPriceEl.setAttribute("data-value", `${this.totalPrice} AR`);
      }
      if (newBalanceEl instanceof HTMLElement) {
        newBalanceEl.setAttribute("data-value", `${this.newBalance} AR`);
      }
    }
  }

  public removeFile(filePath: string) {
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

    this.renderContent();
  }
}
