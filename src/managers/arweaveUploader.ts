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
}
