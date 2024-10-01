import { Vault, TFile, Notice } from "obsidian";
import * as crypto from "crypto";
import { FileUploadInfo, UploadConfig } from "../types";
import { decrypt } from "../utils/encryption";
import Arweave from "arweave";
import { getFolderPath } from "../utils/helpers";

export class VaultRecreationManager {
  private vault: Vault;
  private encryptionPassword: string;
  private arweave: Arweave;
  private remoteUploadConfig: UploadConfig;

  constructor(
    vault: Vault,
    encryptionPassword: string,
    remoteUploadConfig: UploadConfig,
  ) {
    this.vault = vault;
    this.encryptionPassword = encryptionPassword;
    this.arweave = Arweave.init({
      host: "arweave.net",
      port: 443,
      protocol: "https",
    });
    this.remoteUploadConfig = remoteUploadConfig;
  }

  async recreateVault() {
    console.log("Starting vault recreation");
    const errors: { filePath: string; error: string }[] = [];

    for (const [filePath, fileInfo] of Object.entries(
      this.remoteUploadConfig,
    )) {
      try {
        await this.recreateFile(filePath, fileInfo);
      } catch (error) {
        console.error(`Error recreating file ${filePath}:`, error);
        errors.push({ filePath, error: error.message });
      }
    }

    console.log("Vault recreation completed");
    if (errors.length > 0) {
      console.error("Errors occurred during vault recreation:", errors);
      throw new Error(
        `Failed to recreate ${errors.length} files. Check console for details.`,
      );
    }
  }

  private async recreateFile(filePath: string, fileInfo: FileUploadInfo) {
    try {
      console.log(`Processing file: ${filePath}`);

      if (!fileInfo.txId) {
        console.log(`Skipping file ${filePath} due to missing txId`);
        return;
      }

      const existingFile = this.vault.getAbstractFileByPath(filePath);
      if (existingFile instanceof TFile) {
        const currentFileContent = await this.vault.read(existingFile);
        const currentFileHash = await this.getFileHash(currentFileContent);

        if (currentFileHash === fileInfo.fileHash) {
          console.log(`File ${filePath} is up to date, skipping`);
          return;
        }
      }

      console.log(
        `Fetching content for file: ${filePath} with txId: ${fileInfo.txId}`,
      );
      const encryptedContent = await this.fetchEncryptedContent(fileInfo.txId);

      if (!encryptedContent) {
        console.error(`Failed to fetch content for file: ${filePath}`);
        return;
      }

      console.log(`Decrypting content for file: ${filePath}`);
      let decryptedContent: string;
      try {
        decryptedContent = decrypt(encryptedContent, this.encryptionPassword);
      } catch (decryptError) {
        console.error(`Decryption error for file ${filePath}:`, decryptError);
        throw new Error(
          `Failed to decrypt file ${filePath}. The file might be corrupted or the encryption password might be incorrect.`,
        );
      }

      // Create or update the file in the vault
      const folderPath = getFolderPath(filePath);
      if (folderPath) {
        await this.vault.adapter.mkdir(folderPath);
      }

      if (existingFile instanceof TFile) {
        await this.vault.modify(existingFile, decryptedContent);
        console.log(`Updated existing file: ${filePath}`);
      } else {
        await this.vault.create(filePath, decryptedContent);
        console.log(`Created new file: ${filePath}`);
      }
    } catch (error) {
      console.error(`Error recreating file ${filePath}:`, error);
      throw error;
    }
  }

  private async fetchEncryptedContent(
    txId: string,
    maxRetries = 3,
  ): Promise<string | null> {
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
          console.error(
            `All attempts to fetch content for txId ${txId} failed.`,
          );
          return null;
        }
        await new Promise((resolve) =>
          setTimeout(resolve, 1000 * (attempt + 1)),
        ); // Exponential backoff
      }
    }
    return null;
  }

  private async getFileHash(content: string): Promise<string> {
    return crypto.createHash("sha256").update(content).digest("hex");
  }
}
