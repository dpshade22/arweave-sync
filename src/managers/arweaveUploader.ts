import Arweave from "arweave";
import { JWKInterface } from "arweave/node/lib/wallet";

export class ArweaveUploader {
  private arweave: Arweave;
  private wallet: JWKInterface | null = null;

  constructor() {
    this.arweave = Arweave.init({
      host: "arweave.net",
      port: 443,
      protocol: "https",
    });
  }

  async setWallet(jwk: JWKInterface | null) {
    this.wallet = jwk;
  }

  async uploadFile(
    filePath: string,
    content: string,
    fileHash: string,
  ): Promise<string> {
    if (!this.wallet) {
      throw new Error("Wallet not set. Please set a wallet before uploading.");
    }

    try {
      // Create a transaction
      const transaction = await this.arweave.createTransaction(
        {
          data: content,
        },
        this.wallet,
      );

      // Add tags to the transaction
      transaction.addTag("Content-Type", "text/markdown");
      transaction.addTag("App-Name", "ArweaveSync");
      // transaction.addTag("File-Path", filePath);
      transaction.addTag("File-Hash", fileHash);

      // Sign the transaction
      await this.arweave.transactions.sign(transaction, this.wallet);

      // Submit the transaction
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

  async getUploadCost(contentLength: number): Promise<string> {
    try {
      const price = await this.arweave.transactions.getPrice(contentLength);
      return this.arweave.ar.winstonToAr(price);
    } catch (error) {
      console.error("Error getting upload cost:", error);
      throw error;
    }
  }

  async getTransactionStatus(txId: string): Promise<string> {
    try {
      const status = await this.arweave.transactions.getStatus(txId);
      return status.status === 200 ? "Confirmed" : "Pending";
    } catch (error) {
      console.error("Error getting transaction status:", error);
      throw error;
    }
  }
}
