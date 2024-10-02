import { App, Modal, ButtonComponent, TFile } from "obsidian";
import ArweaveSync from "../main";
import { FileUploadInfo, UploadConfig } from "../types";
import { VaultImportModal } from "./VaultImportModal";

interface FileNode {
  name: string;
  path: string;
  fileInfo?: FileUploadInfo;
  isFolder: boolean;
  children: FileNode[];
  expanded: boolean;
}

export class VaultExportModal extends Modal {
  private plugin: ArweaveSync;
  private localFiles: FileNode[];
  private filesToExport: FileNode[];
  private localContainer: HTMLElement;
  private exportContainer: HTMLElement;
  private isExportView: boolean = true;
  private tabContainer: HTMLElement;
  private contentContainer: HTMLElement;

  constructor(app: App, plugin: ArweaveSync) {
    super(app);
    this.plugin = plugin;
    this.localFiles = [];
    this.filesToExport = [];
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("vault-export-modal");

    this.tabContainer = contentEl.createDiv({ cls: "tab-container" });
    this.contentContainer = contentEl.createDiv({ cls: "content-container" });

    this.createTabs();
    await this.renderContent();
  }

  private createTabs() {
    const exportTab = this.tabContainer.createDiv({ cls: "tab" });
    exportTab.textContent = "Export to Arweave";
    exportTab.addEventListener("click", () => this.switchView(true));

    const importTab = this.tabContainer.createDiv({ cls: "tab" });
    importTab.textContent = "Import to Obsidian";
    importTab.addEventListener("click", () => this.switchView(false));

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
      await this.renderImportVaultView();
    }
  }

  private async renderExportView() {
    const loadingEl = this.contentContainer.createEl("div", {
      text: "Loading files...",
    });

    const modifiedOrNewFiles = await this.getModifiedOrNewFiles();
    this.localFiles = this.buildFileTree(modifiedOrNewFiles);

    loadingEl.remove();

    const container = this.contentContainer.createDiv({
      cls: "file-transfer-container",
    });
    this.localContainer = container.createDiv({ cls: "local-files" });
    this.exportContainer = container.createDiv({ cls: "export-files" });
    this.renderFileTree(this.localFiles, this.localContainer, true);
    this.renderFileTree(this.filesToExport, this.exportContainer, false);
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

  private async renderImportVaultView() {
    const importModal = new VaultImportModal(
      this.app,
      this.plugin,
      this.plugin.settings.remoteUploadConfig,
    );
    await importModal.onOpen();
  }

  private buildFileTree(files: TFile[]): FileNode[] {
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
      const leafNode = pathMap[file.path];
      if (leafNode) {
        leafNode.fileInfo = {
          txId: this.plugin.settings.localUploadConfig[file.path]?.txId || "",
          timestamp: file.stat.mtime,
          fileHash: "", // You may want to compute this
          encrypted: false,
          filePath: file.path,
        };
      }
    });

    return root;
  }

  private renderFileTree(
    files: FileNode[],
    containerEl: HTMLElement,
    isLocal: boolean,
  ) {
    containerEl.empty();
    const headerEl = containerEl.createEl("h3", {
      text: isLocal ? "Local Vault" : "Files to Export",
    });
    containerEl.appendChild(headerEl);
    const treeEl = containerEl.createEl("ul", { cls: "file-tree" });
    this.renderFileNodes(files, treeEl, isLocal, 0);
  }

  private renderFileNodes(
    nodes: FileNode[],
    parentEl: HTMLElement,
    isLocal: boolean,
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
          this.toggleFolderContents(itemEl, node, isLocal, depth);
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
          this.toggleFileSelection(node, isLocal),
        );
      }

      if (node.isFolder && node.expanded) {
        this.renderFolderContents(itemEl, node, isLocal, depth);
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
    isLocal: boolean,
    depth: number,
  ) {
    const existingContents = itemEl.querySelector(".folder-contents");
    if (existingContents) {
      existingContents.remove();
    }
    if (node.expanded) {
      this.renderFolderContents(itemEl, node, isLocal, depth);
    }
  }

  private renderFolderContents(
    itemEl: HTMLElement,
    node: FileNode,
    isLocal: boolean,
    depth: number,
  ) {
    const childrenEl = itemEl.createEl("ul", { cls: "folder-contents" });
    this.renderFileNodes(node.children, childrenEl, isLocal, depth + 1);
  }

  private displayFileName(fileName: string): string {
    return fileName.endsWith(".md") ? fileName.slice(0, -3) : fileName;
  }

  private toggleFileSelection(file: FileNode, isLocal: boolean) {
    if (isLocal) {
      this.moveFileToExport(file);
    } else {
      this.removeFileFromExport(file);
    }
    this.renderFileTree(this.localFiles, this.localContainer, true);
    this.renderFileTree(this.filesToExport, this.exportContainer, false);
  }

  private moveFileToExport(file: FileNode) {
    this.removeFileFromTree(this.localFiles, file.path);
    this.addFileToTree(this.filesToExport, file);
  }

  private removeFileFromExport(file: FileNode) {
    this.removeFileFromTree(this.filesToExport, file.path);
    this.addFileToTree(this.localFiles, file);
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
}
