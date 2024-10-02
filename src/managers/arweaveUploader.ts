import Arweave from "arweave";
import { JWKInterface } from "arweave/node/lib/wallet";
import { UploadConfig } from "../types";
import { arGql } from "ar-gql";

interface PreviousVersionInfo {
  content: string;
  timestamp: number;
}

export class ArweaveUploader {
  private arweave: Arweave;
  private wallet: JWKInterface | null = null;
  private argql: ReturnType<typeof arGql>;

  constructor() {
    this.arweave = Arweave.init({
      host: "arweave.net",
      port: 443,
      protocol: "https",
    });
    this.argql = arGql();
  }

  async setWallet(jwk: JWKInterface | null) {
    this.wallet = jwk;
  }

  async uploadFile(
    filePath: string,
    content: string,
    fileHash: string,
    previousVersionTxId: string | null,
    versionNumber: number,
  ): Promise<string> {
    if (!this.wallet) {
      throw new Error("Wallet not set. Please set a wallet before uploading.");
    }

    try {
      const transaction = await this.arweave.createTransaction(
        {
          data: content,
        },
        this.wallet,
      );

      transaction.addTag("Content-Type", "text/markdown");
      transaction.addTag("App-Name", "ArweaveSync");
      transaction.addTag("File-Hash", fileHash);
      transaction.addTag("Previous-Version", previousVersionTxId || "");
      transaction.addTag("Version-Number", versionNumber.toString());

      await this.arweave.transactions.sign(transaction, this.wallet);
      const response = await this.arweave.transactions.post(transaction);

      if (response.status === 200) {
        console.log(
          `File uploaded successfully. Transaction ID: ${transaction.id}`,
        );
        return transaction.id;
      } else {
        throw new Error(
          `Upload failed with status ${response.status}: ${response.statusText}`,
        );
      }
    } catch (error) {
      console.error("Error uploading file to Arweave:", error);
      throw error;
    }
  }

  async fetchPreviousVersion(
    filePath: string,
    n: number,
    localUploadConfig: UploadConfig,
  ): Promise<PreviousVersionInfo | null> {
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
           owner {
             address
           }
           recipient
           fee {
             ar
           }
           quantity {
             ar
           }
         }
       }
     `;

    try {
      let currentTxId = this.getCurrentTransactionId(
        filePath,
        localUploadConfig,
      );

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
          const data = await this.arweave.transactions.getData(transaction.id, {
            decode: true,
            string: true,
          });
          const content =
            typeof data === "string" ? data : new TextDecoder().decode(data);
          return {
            content,
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

  private getCurrentTransactionId(
    filePath: string,
    localUploadConfig: UploadConfig,
  ): string | null {
    const fileInfo = localUploadConfig[filePath];
    return fileInfo ? fileInfo.txId : null;
  }
}
