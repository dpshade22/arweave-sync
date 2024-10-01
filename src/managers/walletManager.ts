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
    this.loadCachedWallet();
  }

  private async loadCachedWallet() {
    const cachedAddress = localStorage.getItem("cachedWalletAddress");
    const cachedJWK = localStorage.getItem("cachedJWK");

    if (cachedAddress && cachedJWK) {
      try {
        await this.initializeWallet(cachedJWK);
        console.log("Loaded cached wallet:", this.address);
        this.trigger("wallet-connected", this.getWalletJson());
      } catch (error) {
        console.error("Failed to load cached wallet:", error);
        this.clearCache();
      }
    }
  }

  async initializeWallet(jwkJson: string): Promise<void> {
    try {
      const jwk = JSON.parse(jwkJson) as JWKInterface;
      this.jwk = jwk;
      this.walletJson = jwkJson;
      this.address = await this.arweave.wallets.jwkToAddress(jwk);
      console.log("Wallet initialized:", this.address);
      this.cacheWalletInfo();
    } catch (error) {
      console.error("Failed to initialize wallet:", error);
      throw error;
    }
  }

  async connect(jwkFile: File): Promise<string> {
    try {
      const jwkJson = await this._readJWKFile(jwkFile);
      await this.initializeWallet(jwkJson);
      if (this.address) {
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
      this.clearCache();
      this._resetState();
      console.log("Wallet disconnected successfully");
      this.trigger("wallet-disconnected");
    } catch (error) {
      console.error("Error disconnecting wallet:", error);
      throw error;
    }
  }

  isWalletLoaded(): boolean {
    return this.address !== null && this.jwk !== null;
  }

  getAddress(): string | null {
    return this.address;
  }

  getUploadConfig(): UploadConfig | null {
    return this.uploadConfig;
  }

  getJWK(): JWKInterface | null {
    return this.jwk;
  }

  getWalletJson(): string | null {
    return this.walletJson;
  }

  isConnected(): boolean {
    return this.address !== null && this.jwk !== null;
  }

  private async _readJWKFile(jwkFile: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        resolve(e.target?.result as string);
      };
      reader.onerror = (error) => reject(error);
      reader.readAsText(jwkFile);
    });
  }

  private cacheWalletInfo(): void {
    if (this.address) {
      localStorage.setItem("cachedWalletAddress", this.address);
    }
    if (this.walletJson) {
      localStorage.setItem("cachedJWK", this.walletJson);
    }
  }

  private clearCache(): void {
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
