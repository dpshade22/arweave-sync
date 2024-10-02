import { App, Modal, ButtonComponent, moment } from "obsidian";
import ArweaveSync from "../main";
import { UploadConfig, FileUploadInfo } from "../types";

interface FileNode {
  name: string;
  path: string;
  fileInfo?: FileUploadInfo;
  isFolder: boolean;
  children: FileNode[];
  expanded: boolean;
}

export class VaultRecreationModal extends Modal {
  private plugin: ArweaveSync;
  private remoteUploadConfig: UploadConfig;
  private incomingFiles: FileNode[];
  private acceptedFiles: FileNode[];
  private incomingContainer: HTMLElement;
  private acceptedContainer: HTMLElement;

  constructor(app: App, plugin: ArweaveSync, remoteUploadConfig: UploadConfig) {
    super(app);
    this.plugin = plugin;
    this.remoteUploadConfig = remoteUploadConfig;
    this.incomingFiles = this.buildFileTree(remoteUploadConfig);
    this.acceptedFiles = [];
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("vault-recreation-modal");
    contentEl.createEl("h2", { text: "Vault Recreation Summary" });
    const container = contentEl.createDiv({ cls: "file-transfer-container" });
    this.incomingContainer = container.createDiv({ cls: "incoming-files" });
    this.acceptedContainer = container.createDiv({ cls: "accepted-files" });
    this.renderFileTree(this.incomingFiles, this.incomingContainer, true);
    this.renderFileTree(this.acceptedFiles, this.acceptedContainer, false);
    const buttonContainer = contentEl.createDiv({ cls: "button-container" });
    new ButtonComponent(buttonContainer)
      .setButtonText("Cancel")
      .onClick(() => this.close());
    new ButtonComponent(buttonContainer)
      .setButtonText("Recreate Vault")
      .setCta()
      .onClick(() => this.recreateVault());
  }

  private buildFileTree(uploadConfig: UploadConfig): FileNode[] {
    const root: FileNode[] = [];

    for (const [path, fileInfo] of Object.entries(uploadConfig)) {
      const parts = path.split("/");
      let currentLevel = root;

      parts.forEach((part, index) => {
        const isLastPart = index === parts.length - 1;
        let node = currentLevel.find((n) => n.name === part);

        if (!node) {
          node = {
            name: part,
            path: parts.slice(0, index + 1).join("/"),
            isFolder: !isLastPart,
            children: [],
            expanded: false,
            fileInfo: isLastPart ? fileInfo : undefined,
          };
          currentLevel.push(node);
        }

        if (!isLastPart) {
          currentLevel = node.children;
        }
      });
    }

    return root;
  }

  private renderFileTree(
    files: FileNode[],
    containerEl: HTMLElement,
    isIncoming: boolean,
  ) {
    containerEl.empty();
    const headerEl = containerEl.createEl("h3", {
      text: isIncoming ? "Remote  Vault" : "Files to Import",
    });
    containerEl.appendChild(headerEl);
    const treeEl = containerEl.createEl("ul", { cls: "file-tree" });
    this.renderFileNodes(files, treeEl, isIncoming, 0);
  }

  private renderFileNodes(
    nodes: FileNode[],
    parentEl: HTMLElement,
    isIncoming: boolean,
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
        toggleEl.innerHTML = node.expanded
          ? '<span class="chevron" style="transform: rotate(-90deg);">❯</span>'
          : '<span class="chevron" style="transform: rotate(0deg);">❯</span>';

        contentEl.createEl("span", { text: node.name, cls: "folder-name" });

        const toggleFolder = (e: Event) => {
          e.stopPropagation();
          node.expanded = !node.expanded;
          this.renderFileTree(
            this.incomingFiles,
            this.incomingContainer,
            isIncoming,
          );
        };

        // Make the entire folder item clickable
        contentEl.addEventListener("click", toggleFolder);

        if (node.expanded) {
          const childrenEl = itemEl.createEl("ul", { cls: "folder-contents" });
          this.renderFileNodes(
            node.children,
            childrenEl,
            isIncoming,
            depth + 1,
          );
        }
      } else {
        contentEl.createEl("span", {
          text: this.displayFileName(node.name),
          cls: "file-name",
        });

        if (node.fileInfo) {
          contentEl.setAttribute(
            "title",
            `Last modified: ${moment(node.fileInfo.timestamp).format("YYYY-MM-DD HH:mm:ss")}`,
          );
        }

        contentEl.addEventListener("click", () =>
          this.moveFile(node, isIncoming),
        );
      }
    });
  }

  private displayFileName(fileName: string): string {
    return fileName.endsWith(".md") ? fileName.slice(0, -3) : fileName;
  }

  private moveFile(file: FileNode, isIncoming: boolean) {
    if (isIncoming) {
      this.removeFileFromTree(this.incomingFiles, file.path);
      this.addFileToTree(this.acceptedFiles, file);
    } else {
      this.removeFileFromTree(this.acceptedFiles, file.path);
      this.addFileToTree(this.incomingFiles, file);
    }
    this.renderFileTree(this.incomingFiles, this.incomingContainer, true);
    this.renderFileTree(this.acceptedFiles, this.acceptedContainer, false);
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

  private async recreateVault() {
    this.close();
    const filesToImport = this.flattenFileTree(this.acceptedFiles);
    await this.plugin.recreateVaultWithSelectedFiles(filesToImport);
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
