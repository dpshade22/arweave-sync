import { Notice, Events } from "obsidian";
import { JWKInterface } from "arweave/node/lib/wallet";
import Arweave from "arweave";
import { UploadConfig } from "../types";

export class WalletManager extends Events {
  private address: string | null = null;
  private jwk: JWKInterface | null = null;
  private arweave: Arweave;
  private uploadConfig: UploadConfig | null = null;
  private walletJson: string | null = null;

  constructor() {
    super();
    this.arweave = Arweave.init({});
  }

  async initializeWallet(jwkJson: string): Promise<void> {
    try {
      const jwk = JSON.parse(jwkJson) as JWKInterface;
      this.jwk = jwk;
      this.walletJson = jwkJson;
      this.address = await this.arweave.wallets.jwkToAddress(jwk);
      console.log("Wallet initialized:", this.address);
      this.trigger("wallet-initialized");
    } catch (error) {
      console.error("Failed to initialize wallet:", error);
      throw error;
    }
  }

  async connect(jwkFile: File): Promise<string> {
    try {
      await this._connectWithJWK(jwkFile);
      if (this.address) {
        this._cacheWalletInfo();
        console.log("Wallet connected successfully:", this.address);
        this.trigger("wallet-connected", this.getWalletJson());
        return this.address;
      }
      throw new Error("Failed to obtain wallet address");
    } catch (error) {
      console.error("Wallet connection failed:", error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    try {
      this._clearCache();
      this._resetState();
      console.log("Wallet disconnected successfully");
    } catch (error) {
      console.error("Error disconnecting wallet:", error);
      throw error;
    }
  }

  getAddress(): string | null {
    return this.address;
  }

  getJWK(): JWKInterface | null {
    return this.jwk;
  }

  getUploadConfig(): UploadConfig | null {
    return this.uploadConfig;
  }

  getWalletJson(): string | null {
    return this.walletJson;
  }

  isConnected(): boolean {
    return this.address !== null && this.jwk !== null;
  }

  private async _connectWithJWK(jwkFile: File): Promise<void> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const fileContent = e.target?.result as string;
          this.walletJson = fileContent;
          const jwk = JSON.parse(fileContent) as JWKInterface;
          this.jwk = jwk;
          this.address = await this.arweave.wallets.jwkToAddress(jwk);
          console.log("JWK wallet connected:", this.address);
          new Notice("JWK wallet connected successfully");
          resolve();
        } catch (error) {
          console.error("Failed to connect with JWK:", error);
          new Notice("Failed to connect with JWK. Please try again.");
          reject(error);
        }
      };
      reader.onerror = (error) => reject(error);
      reader.readAsText(jwkFile);
    });
  }

  private _cacheWalletInfo(): void {
    if (this.address) {
      localStorage.setItem("cachedWalletAddress", this.address);
    }
    if (this.walletJson) {
      localStorage.setItem("cachedJWK", this.walletJson);
    }
  }

  private _clearCache(): void {
    localStorage.removeItem("cachedWalletAddress");
    localStorage.removeItem("cachedJWK");
  }

  private _resetState(): void {
    this.address = null;
    this.jwk = null;
    this.uploadConfig = null;
    this.walletJson = null;
  }
}

export let walletManager: WalletManager;

export function initializeWalletManager(): WalletManager {
  walletManager = new WalletManager();
  return walletManager;
}
