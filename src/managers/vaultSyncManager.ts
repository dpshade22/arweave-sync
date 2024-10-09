import Arweave from "arweave";
import {
  Vault,
  TFile,
  Notice,
  TFolder,
  MarkdownView,
  normalizePath,
} from "obsidian";
import { UploadConfig, FileUploadInfo, FileVersion } from "../types";
import { encrypt, decrypt } from "../utils/encryption";
import CryptoJS from "crypto-js";
import ArweaveSync from "../main";
import { arGql, GQLUrls } from "ar-gql";
import { walletManager } from "./walletManager";
import { Buffer } from "buffer";
import { dirname, basename, join } from "../utils/path";

export class VaultSyncManager {
  private vault: Vault;
  private arweave: Arweave;
  private argql: ReturnType<typeof arGql>;
  private encryptionPassword: string | null = null;

  constructor(
    private plugin: ArweaveSync,
    private remoteUploadConfig: UploadConfig,
    private localUploadConfig: UploadConfig,
  ) {
    this.vault = plugin.app.vault;
    this.remoteUploadConfig = remoteUploadConfig;
    this.localUploadConfig = localUploadConfig;
    this.arweave = Arweave.init({
      host: "arweave.net",
      port: 443,
      protocol: "https",
    });
    this.argql = arGql();
  }

  isWalletSet(): boolean {
    return walletManager.isConnected();
  }

  encrypt(data: string | Buffer, isBinary: boolean = false): string {
    this.ensureEncryptionPassword();
    return encrypt(data, this.encryptionPassword!, isBinary);
  }

  decrypt(encryptedData: string): string | Buffer {
    this.ensureEncryptionPassword();
    return decrypt(encryptedData, this.encryptionPassword!);
  }

  setEncryptionPassword(password: string) {
    this.encryptionPassword = password;
  }

  isEncryptionPasswordSet(): boolean {
    return this.encryptionPassword !== null;
  }

  private ensureEncryptionPassword(): void {
    if (!this.isEncryptionPasswordSet()) {
      throw new Error(
        "Encryption password is not set. Please connect a wallet first.",
      );
    }
  }

  async syncFile(file: TFile): Promise<void> {
    await this.updateRemoteConfig();

    const { syncState, fileHash } = await this.checkFileSync(file);

    if (syncState === "synced") {
      console.log(`File ${file.path} is already synced.`);
      return;
    }

    switch (syncState) {
      case "new-local":
      case "local-newer":
        console.log(`Exporting local changes for ${file.path}`);
        let newFileInfo = await this.exportFileToArweave(file, fileHash);
        let updatedRemoteConfig = {
          ...this.plugin.settings.remoteUploadConfig,
          [newFileInfo.filePath]: newFileInfo,
        };
        await this.plugin.aoManager.updateUploadConfig(updatedRemoteConfig);
        break;
      case "new-remote":
      case "remote-newer":
        console.log(`Importing remote changes for ${file.path}`);
        await this.importFileFromArweave(file.path);
        const remoteFileInfo = this.remoteUploadConfig[file.path];
        if (remoteFileInfo) {
          this.localUploadConfig[file.path] = {
            ...remoteFileInfo,
          };
        }
        break;
      default:
        console.warn(`Unexpected sync state for ${file.path}: ${syncState}`);
        return;
    }

    await this.plugin.saveSettings();

    console.log(`File ${file.path} synced successfully.`);
  }

  isWalletConnected(): boolean {
    return walletManager.isConnected();
  }

  async importFilesFromArweave(filePaths: string[]): Promise<string[]> {
    const importedFiles: string[] = [];

    for (const filePath of filePaths) {
      try {
        await this.importFileFromArweave(filePath);
        importedFiles.push(filePath);
        console.log(`Successfully imported: ${filePath}`);
      } catch (error) {
        console.error(`Failed to import file: ${filePath}`, error);
        new Notice(`Failed to import ${filePath}. Error: ${error.message}`);
      }
    }

    return importedFiles;
  }

  async importFileFromArweave(filePath: string): Promise<void> {
    this.ensureEncryptionPassword();

    try {
      const normalizedPath = normalizePath(filePath);
      const remoteFileInfo = this.remoteUploadConfig[filePath];
      if (!remoteFileInfo) {
        throw new Error(`No remote file info found for ${filePath}`);
      }

      // Check for remote rename
      await this.remoteRename(normalizedPath, remoteFileInfo);

      const encryptedContent = await this.fetchEncryptedContent(
        remoteFileInfo.txId,
      );

      let decryptedContent: string | ArrayBuffer;
      try {
        decryptedContent = this.decrypt(encryptedContent);
      } catch (decryptError) {
        console.error(`Failed to decrypt ${filePath}:`, decryptError);
        await this.handleDecryptionFailure(filePath);
        return;
      }

      const existingFile =
        this.plugin.app.vault.getAbstractFileByPath(normalizedPath);

      if (existingFile instanceof TFile) {
        // File exists, update it
        await this.updateExistingFile(existingFile, decryptedContent);
        console.log(`Updated existing file: ${normalizedPath}`);
      } else if (existingFile instanceof TFolder) {
        // A folder exists with the same name, create file with a unique name
        const uniquePath = this.generateUniqueFilePath(normalizedPath);
        await this.createNewFile(uniquePath, decryptedContent);
        console.log(`Created new file with modified path: ${uniquePath}`);
      } else {
        // File doesn't exist, create it
        if (normalizedPath.includes("/")) {
          await this.ensureDirectoryExists(normalizedPath);
        }
        await this.createNewFile(normalizedPath, decryptedContent);
        console.log(`Created new file: ${normalizedPath}`);
      }

      this.plugin.updateLocalConfig(filePath, {
        ...remoteFileInfo,
        filePath: normalizedPath,
      });
      await this.plugin.saveSettings();

      console.log(`Imported file: ${normalizedPath}`);
    } catch (error) {
      console.error(`Failed to import file: ${filePath}`, error);
      throw error;
    }
  }

  private async createNewFile(
    path: string,
    content: string | ArrayBuffer,
  ): Promise<void> {
    if (content instanceof ArrayBuffer) {
      await this.plugin.app.vault.createBinary(path, content);
    } else {
      await this.plugin.app.vault.create(path, content);
    }
  }

  private async updateExistingFile(
    file: TFile,
    content: string | ArrayBuffer,
  ): Promise<void> {
    const activeLeaf = this.plugin.app.workspace.activeLeaf;
    if (
      activeLeaf?.view instanceof MarkdownView &&
      activeLeaf.view.file === file
    ) {
      // If the file is currently open and active, use the Editor interface
      const editor = activeLeaf.view.editor;
      if (typeof content === "string") {
        editor.setValue(content);
      } else {
        // Handle binary content
        new Notice(`Binary file ${file.name} has been updated.`);
        await this.plugin.app.vault.modifyBinary(file, content);
      }
    } else {
      // If the file is not active, use Vault.process for text files and modifyBinary for binary files
      if (typeof content === "string") {
        await this.plugin.app.vault.process(file, () => content);
      } else {
        await this.plugin.app.vault.modifyBinary(file, content);
      }
    }
  }

  private generateUniqueFilePath(originalPath: string): string {
    let newPath = originalPath;
    let counter = 1;
    while (this.plugin.app.vault.getAbstractFileByPath(newPath)) {
      const dir = dirname(originalPath);
      const name = basename(originalPath).replace(/\.[^/.]+$/, ""); // Remove extension
      const ext = basename(originalPath).split(".").pop() || "";
      newPath = normalizePath(
        `${dir}/${name}_${counter}${ext ? "." + ext : ""}`,
      );
      counter++;
    }
    return newPath;
  }

  public async forcePushFile(file: TFile): Promise<void> {
    try {
      const fileHash = await this.getFileHash(file);
      const newFileInfo = await this.exportFileToArweave(file, fileHash);

      // Update both local and remote configs
      this.localUploadConfig[file.path] = newFileInfo;
      const currentRemoteConfig =
        (await this.plugin.aoManager.getUploadConfig()) || {};

      currentRemoteConfig[file.path] = newFileInfo;

      // Update the remote config on AO
      await this.plugin.aoManager.updateUploadConfig(currentRemoteConfig);
      console.log(`Force pushed file: ${file.path}`);
    } catch (error) {
      console.error(`Failed to force push file: ${file.path}`, error);
      throw error;
    }
  }

  public async forcePullFile(file: TFile): Promise<void> {
    try {
      const remoteFileInfo = this.remoteUploadConfig[file.path];
      if (!remoteFileInfo) {
        throw new Error(`No remote file info found for ${file.path}`);
      }

      const encryptedContent = await this.fetchEncryptedContent(
        remoteFileInfo.txId,
      );
      let decryptedContent: string | Buffer;

      try {
        decryptedContent = this.decrypt(encryptedContent);
      } catch (decryptError) {
        console.error(`Failed to decrypt ${file.path}:`, decryptError);
        throw new Error(
          `Failed to decrypt ${file.path}. Please check your encryption password.`,
        );
      }

      if (await this.plugin.app.vault.adapter.exists(file.path)) {
        // File exists, update it
        if (Buffer.isBuffer(decryptedContent)) {
          await this.plugin.app.vault.modifyBinary(
            file,
            decryptedContent.buffer,
          );
        } else if (typeof decryptedContent === "string") {
          await this.plugin.app.vault.modify(file, decryptedContent);
        } else {
          throw new Error(`Unexpected decrypted content type for ${file.path}`);
        }
      } else {
        // File doesn't exist, create it
        if (Buffer.isBuffer(decryptedContent)) {
          await this.plugin.app.vault.createBinary(
            file.path,
            decryptedContent.buffer,
          );
        } else if (typeof decryptedContent === "string") {
          await this.plugin.app.vault.create(file.path, decryptedContent);
        }
      }

      this.plugin.updateLocalConfig(file.path, remoteFileInfo);
      await this.plugin.saveSettings();

      console.log(`Force pulled file: ${file.path}`);
    } catch (error) {
      console.error(`Failed to force pull file: ${file.path}`, error);
      throw error;
    }
  }

  private async handleDecryptionFailure(filePath: string): Promise<void> {
    console.log(
      `Removing ${filePath} from remote upload config due to decryption failure`,
    );

    let updatedRemoteConfig = this.remoteUploadConfig;
    delete updatedRemoteConfig[filePath];

    await this.plugin.aoManager.updateUploadConfig(updatedRemoteConfig);

    new Notice(
      `Failed to decrypt ${filePath}. It has been removed from the sync list.`,
    );
  }

  public async deleteRemoteFile(filePath: string): Promise<void> {
    console.log(`Removing ${filePath} from remote upload config`);

    let updatedRemoteConfig = this.remoteUploadConfig;
    delete updatedRemoteConfig[filePath];

    await this.plugin.aoManager.updateUploadConfig(updatedRemoteConfig);

    new Notice(`Deleting ${filePath}. It has been removed from the sync list.`);
  }

  private async ensureDirectoryExists(filePath: string): Promise<void> {
    const dir = dirname(filePath);
    if (dir && dir !== ".") {
      const folders = dir.split("/").filter(Boolean);
      let currentPath = "";

      for (const folder of folders) {
        currentPath += (currentPath ? "/" : "") + folder;
        const folderFile =
          this.plugin.app.vault.getAbstractFileByPath(currentPath);

        if (!folderFile) {
          try {
            await this.plugin.app.vault.createFolder(currentPath);
          } catch (error) {
            if (error.message !== "Folder already exists.") {
              throw error;
            }
            // If the folder already exists, we can continue to the next subfolder
          }
        } else if (!(folderFile instanceof TFolder)) {
          throw new Error(`${currentPath} exists but is not a folder`);
        }
      }
    }
  }

  private async exportFileToArweave(
    file: TFile,
    fileHash: string,
  ): Promise<FileUploadInfo> {
    if (!walletManager.isConnected()) {
      throw new Error(
        "Wallet not connected. Please connect a wallet before uploading.",
      );
    }

    const wallet = walletManager.getJWK();
    if (!wallet) {
      throw new Error("Unable to retrieve wallet. Please try reconnecting.");
    }

    this.ensureEncryptionPassword();
    const isBinary = this.isBinaryFile(file);
    const content = isBinary
      ? await this.vault.readBinary(file)
      : await this.vault.read(file);
    const encryptedContent = this.encrypt(
      content instanceof ArrayBuffer ? Buffer.from(content) : content,
      isBinary,
    );

    const currentFileInfo = this.localUploadConfig[file.path];
    const previousVersionTxId = currentFileInfo ? currentFileInfo.txId : null;
    const versionNumber = currentFileInfo
      ? currentFileInfo.versionNumber + 1
      : 1;

    const transaction = await this.arweave.createTransaction(
      { data: encryptedContent },
      wallet,
    );

    transaction.addTag("Content-Type", "text/markdown");
    transaction.addTag("App-Name", "ArweaveSync");
    transaction.addTag("File-Hash", fileHash);
    transaction.addTag("Previous-Version", previousVersionTxId || "");
    transaction.addTag("Version-Number", versionNumber.toString());

    await this.arweave.transactions.sign(transaction, wallet);
    const response = await this.arweave.transactions.post(transaction);

    if (response.status !== 200) {
      throw new Error(
        `Upload failed with status ${response.status}: ${response.statusText}`,
      );
    }

    const newFileInfo: FileUploadInfo = {
      txId: transaction.id,
      timestamp: Date.now(),
      fileHash,
      encrypted: true,
      filePath: file.path,
      previousVersionTxId,
      versionNumber,
    };

    this.plugin.updateLocalConfig(file.path, newFileInfo);

    console.log(
      `File ${file.path} exported to Arweave. Transaction ID: ${transaction.id}`,
    );

    return newFileInfo;
  }

  async exportFilesToArweave(filePaths: string[]): Promise<void> {
    const updatedFiles: FileUploadInfo[] = [];

    const currentRemoteConfig =
      (await this.plugin.aoManager.getUploadConfig()) || {};

    for (const filePath of filePaths) {
      const file = this.vault.getAbstractFileByPath(filePath);
      if (file instanceof TFile) {
        const { syncState, fileHash } = await this.checkFileSync(file);
        if (syncState !== "synced") {
          const newFileInfo = await this.exportFileToArweave(file, fileHash);
          updatedFiles.push(newFileInfo);
          this.localUploadConfig[file.path] = newFileInfo;
          currentRemoteConfig[file.path] = newFileInfo;
        }
      }
    }

    if (updatedFiles.length > 0) {
      await this.plugin.aoManager.updateUploadConfig(currentRemoteConfig);
    }

    await this.plugin.saveSettings();
  }

  public async updateRemoteConfig(): Promise<void> {
    const remoteConfig = await this.plugin.aoManager.getUploadConfig();
    console.log(remoteConfig);
    this.remoteUploadConfig = remoteConfig || {};
    this.plugin.settings.remoteUploadConfig = remoteConfig || {};
    await this.plugin.saveSettings();
  }

  public async isFileNeedingSync(file: TFile): Promise<boolean> {
    const { syncState } = await this.checkFileSync(file);
    return syncState !== "synced";
  }

  async checkFileSync(file: TFile): Promise<{
    syncState:
      | "new-local"
      | "new-remote"
      | "local-newer"
      | "remote-newer"
      | "synced"
      | "decrypt-failed";
    fileHash: string;
  }> {
    const currentFileHash = await this.getFileHash(file);
    const remoteFileInfo = this.remoteUploadConfig[file.path];
    const localFileInfo = this.localUploadConfig[file.path];

    let syncState:
      | "new-local"
      | "new-remote"
      | "local-newer"
      | "remote-newer"
      | "synced"
      | "decrypt-failed";

    if (!remoteFileInfo && localFileInfo) {
      syncState = "new-local";
    } else if (!localFileInfo && remoteFileInfo) {
      try {
        const encryptedContent = await this.fetchEncryptedContent(
          remoteFileInfo.txId,
        );
        this.decrypt(encryptedContent);
        syncState = "new-remote";
      } catch (decryptError) {
        console.error(`Failed to decrypt ${file.path}:`, decryptError);
        await this.handleDecryptionFailure(file.path);
        syncState = "decrypt-failed";
      }
    } else if (currentFileHash !== remoteFileInfo?.fileHash) {
      if (remoteFileInfo && remoteFileInfo.timestamp > file.stat.mtime) {
        syncState = "remote-newer";
      } else {
        syncState = "local-newer";
      }
    } else {
      syncState = "synced";
    }

    return { syncState, fileHash: currentFileHash };
  }

  public async getFileHash(file: TFile): Promise<string> {
    const isBinary = this.isBinaryFile(file);
    const content = isBinary
      ? await this.plugin.app.vault.readBinary(file)
      : await this.plugin.app.vault.read(file);

    if (isBinary) {
      return CryptoJS.SHA256(
        CryptoJS.lib.WordArray.create(content as ArrayBuffer),
      ).toString();
    } else {
      return CryptoJS.SHA256(content as string).toString();
    }
  }

  private async fetchEncryptedContent(
    txId: string,
    maxRetries = 3,
  ): Promise<string> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const transaction = await this.arweave.transactions.getData(txId, {
          decode: true,
          string: true,
        });
        return transaction as string;
      } catch (error) {
        console.warn(
          `Attempt ${attempt + 1} failed to fetch content for txId ${txId}:`,
          error,
        );
        if (attempt === maxRetries - 1) {
          throw new Error(
            `Failed to fetch content for txId ${txId} after ${maxRetries} attempts.`,
          );
        }
        await new Promise((resolve) =>
          setTimeout(resolve, 1000 * (attempt + 1)),
        );
      }
    }
    throw new Error("Unexpected error in fetchEncryptedContent");
  }

  async fetchLatestRemoteFileContent(filePath: string): Promise<string> {
    this.ensureEncryptionPassword();

    const fileInfo = this.remoteUploadConfig[filePath];
    if (!fileInfo) {
      throw new Error(`No remote file info found for ${filePath}`);
    }

    const encryptedContent = await this.fetchEncryptedContent(fileInfo.txId);
    const decryptedContent = this.decrypt(encryptedContent);

    if (typeof decryptedContent === "string") {
      return decryptedContent;
    } else {
      return decryptedContent.toString("utf-8");
    }
  }

  async fetchFileVersions(
    limit: number = 10,
    filePath?: string,
    startFromTxId?: string,
  ): Promise<FileVersion[]> {
    const versions: FileVersion[] = [];
    let currentTxId =
      startFromTxId ||
      (filePath ? this.getCurrentTransactionId(filePath) : null);

    const fetchVersion = async (txId: string): Promise<void> => {
      if (versions.length >= limit || !txId) {
        return;
      }

      const query = `
          query($id: ID!) {
            transaction(id: $id) {
              id
              tags {
                name
                value
              }
              block {
                height
                timestamp
              }
            }
          }
        `;

      try {
        const variables = { id: txId };
        const results = await arGql({ endpointUrl: GQLUrls.goldsky }).run(
          query,
          variables,
        );
        const transaction = results.data.transaction;

        if (!transaction) {
          return;
        }

        const data = await this.arweave.transactions.getData(txId, {
          decode: true,
          string: true,
        });

        const content =
          typeof data === "string" ? data : new TextDecoder().decode(data);
        const decryptedContent = this.decrypt(content);

        const fileHash = transaction.tags.find(
          (tag) => tag.name === "File-Hash",
        )?.value;
        const previousVersionTxId =
          transaction.tags.find((tag) => tag.name === "Previous-Version")
            ?.value || null;

        versions.push({
          txId,
          content: decryptedContent,
          timestamp: transaction.block.timestamp,
          fileHash,
          previousVersionTxId,
        });

        await fetchVersion(previousVersionTxId);
      } catch (error) {
        console.error("Error fetching version:", error);
      }
    };

    await fetchVersion(currentTxId);
    return versions;
  }

  private async remoteRename(
    filePath: string,
    remoteFileInfo: FileUploadInfo,
  ): Promise<void> {
    if (remoteFileInfo.oldFilePath) {
      const oldFile = this.plugin.app.vault.getAbstractFileByPath(
        remoteFileInfo.oldFilePath,
      );
      if (oldFile instanceof TFile) {
        try {
          await this.plugin.app.fileManager.renameFile(oldFile, filePath);
          console.log(
            `Renamed file from ${remoteFileInfo.oldFilePath} to ${filePath}`,
          );
        } catch (error) {
          console.error(
            `Failed to rename file from ${remoteFileInfo.oldFilePath} to ${filePath}:`,
            error,
          );
          throw new Error(`Failed to rename file: ${error.message}`);
        }
      }
    }
  }

  private getCurrentTransactionId(filePath: string): string | null {
    const fileInfo = this.localUploadConfig[filePath];
    return fileInfo ? fileInfo.txId : null;
  }

  private isBinaryFile(file: TFile): boolean {
    const binaryExtensions = [
      "png",
      "jpg",
      "jpeg",
      "gif",
      "pdf",
      "mp3",
      "mp4",
      "zip",
    ];
    return binaryExtensions.includes(file.extension.toLowerCase());
  }

  private async fileExistsCaseInsensitive(filePath: string): Promise<boolean> {
    const normalizedPath = normalizePath(filePath.toLowerCase());
    const allFiles = this.plugin.app.vault.getFiles();
    return allFiles.some((file) => file.path.toLowerCase() === normalizedPath);
  }
}
