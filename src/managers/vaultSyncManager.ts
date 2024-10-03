import Arweave from "arweave";
import { Vault, TFile, Notice } from "obsidian";
import { JWKInterface } from "arweave/node/lib/wallet";
import { UploadConfig, FileUploadInfo } from "../types";
import { encrypt, decrypt } from "../utils/encryption";
import CryptoJS from "crypto-js";
import ArweaveSync from "../main";
import { arGql } from "ar-gql";
import { walletManager } from "./walletManager";

export class VaultSyncManager {
  private vault: Vault;
  private arweave: Arweave;
  private argql: ReturnType<typeof arGql>;

  constructor(
    private plugin: ArweaveSync,
    private encryptionPassword: string,
    private remoteUploadConfig: UploadConfig,
    private localUploadConfig: UploadConfig,
  ) {
    this.vault = plugin.app.vault;
    this.encryptionPassword = encryptionPassword;
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
    return this.wallet !== null;
  }

  async syncFile(file: TFile): Promise<void> {
    const { syncState, localNewerVersion, fileHash } =
      await this.checkFileSync(file);

    if (syncState === "synced") {
      console.log(`File ${file.path} is already synced.`);
      return;
    }

    if (localNewerVersion) {
      await this.exportFileToArweave(file, fileHash);
    } else {
      await this.importFileFromArweave(file);
    }
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

  private async importFileFromArweave(filePath: string): Promise<void> {
    const remoteFileInfo = this.remoteUploadConfig[filePath];
    if (!remoteFileInfo) {
      throw new Error(`No remote file info found for ${filePath}`);
    }

    const encryptedContent = await this.fetchEncryptedContent(
      remoteFileInfo.txId,
    );
    const decryptedContent = decrypt(encryptedContent, this.encryptionPassword);

    // Ensure the entire directory structure exists
    // const dirPath = filePath.substring(0, filePath.lastIndexOf("/"));
    // if (dirPath) {
    //   await this.createNestedFolders(dirPath);
    // }

    // Create the file if it doesn't exist, or modify it if it does
    let file = this.vault.getAbstractFileByPath(filePath);
    if (!file) {
      file = await this.vault.create(filePath, decryptedContent);
    } else if (file instanceof TFile) {
      await this.vault.modify(file, decryptedContent);
    } else {
      throw new Error(`${filePath} is not a file`);
    }

    // Update localUploadConfig with the remote file info
    this.localUploadConfig[filePath] = { ...remoteFileInfo };

    // Update the plugin's local config
    this.plugin.updateLocalConfig(filePath, remoteFileInfo);

    console.log(`File ${filePath} imported from Arweave.`);
  }

  // private async createNestedFolders(path: string): Promise<void> {
  //   const folders = path.split("/").filter(Boolean);
  //   let currentPath = "";

  //   for (const folder of folders) {
  //     currentPath += folder + "/";
  //     if (!(await this.vault.adapter.exists(currentPath))) {
  //       await this.vault.createFolder(currentPath);
  //     }
  //   }
  // }

  private async exportFileToArweave(
    file: TFile,
    fileHash: string,
  ): Promise<void> {
    if (!walletManager.isConnected()) {
      throw new Error(
        "Wallet not connected. Please connect a wallet before uploading.",
      );
    }

    const wallet = walletManager.getJWK();
    if (!wallet) {
      throw new Error("Unable to retrieve wallet. Please try reconnecting.");
    }

    const content = await this.vault.read(file);
    const encryptedContent = encrypt(content, this.encryptionPassword);

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

    this.localUploadConfig[file.path] = newFileInfo;
    this.remoteUploadConfig[file.path] = newFileInfo;

    this.plugin.updateLocalConfig(file.path, newFileInfo);
    this.plugin.updateRemoteConfig(file.path, newFileInfo);

    console.log(
      `File ${file.path} exported to Arweave. Transaction ID: ${transaction.id}`,
    );
  }

  async exportFilesToArweave(filePaths: string[]): Promise<void> {
    for (const filePath of filePaths) {
      const file = this.vault.getAbstractFileByPath(filePath);
      if (file instanceof TFile) {
        const { syncState, fileHash } = await this.checkFileSync(file);
        if (syncState !== "synced") {
          await this.exportFileToArweave(file, fileHash);
        }
      }
    }
  }

  async checkFileSync(file: TFile): Promise<{
    syncState: "new-file" | "updated-file" | "synced";
    localNewerVersion: boolean;
    fileHash: string;
  }> {
    const currentFileHash = await this.getFileHash(file);
    const remoteFileInfo = this.remoteUploadConfig[file.path];

    let syncState: "new-file" | "updated-file" | "synced";
    let localNewerVersion = false;

    if (!remoteFileInfo) {
      syncState = "new-file";
      localNewerVersion = true;
    } else if (currentFileHash !== remoteFileInfo.fileHash) {
      syncState = "updated-file";
      localNewerVersion = file.stat.mtime > remoteFileInfo.timestamp;
    } else {
      syncState = "synced";
    }

    return { syncState, localNewerVersion, fileHash: currentFileHash };
  }

  public async getFileHash(file: TFile): Promise<string> {
    const content = await this.plugin.app.vault.read(file);
    return CryptoJS.SHA256(content).toString();
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
        ); // Exponential backoff
      }
    }
    throw new Error("Unexpected error in fetchEncryptedContent");
  }

  async fetchPreviousVersion(
    filePath: string,
    n: number,
  ): Promise<{ content: string; timestamp: number } | null> {
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
      let currentTxId = this.getCurrentTransactionId(filePath);

      if (!currentTxId) {
        console.error(`No transaction ID found for file: ${filePath}`);
        return null;
      }

      for (let i = 0; i < n; i++) {
        if (!currentTxId) {
          return null; // Not enough versions available
        }

        const variables = { id: currentTxId };
        const results = await this.argql.run(query, variables);
        const transaction = results.data.transaction;

        if (!transaction) {
          return null; // Transaction not found
        }

        // Find the "Previous-Version" tag
        const previousVersionTag = transaction.tags.find(
          (tag) => tag.name === "Previous-Version",
        );
        currentTxId = previousVersionTag ? previousVersionTag.value : null;

        // If we've reached the desired version, fetch and return the data
        if (i === n - 1) {
          const data = await this.plugin
            .getArweave()
            .transactions.getData(transaction.id, {
              decode: true,
              string: true,
            });
          const content =
            typeof data === "string" ? data : new TextDecoder().decode(data);
          return {
            content: decrypt(content, this.encryptionPassword),
            timestamp: transaction.block.timestamp,
          };
        }
      }

      return null; // Not enough versions available
    } catch (error) {
      console.error("Error fetching previous version:", error);
      return null;
    }
  }

  private getCurrentTransactionId(filePath: string): string | null {
    const fileInfo = this.localUploadConfig[filePath];
    return fileInfo ? fileInfo.txId : null;
  }
}
