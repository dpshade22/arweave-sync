import { JWKInterface } from "arweave/node/lib/wallet";
import Arweave from "arweave";
import { UploadConfig } from "../types";
import { message, result } from "@permaweb/aoconnect";
import * as WarpArBundles from "warp-arbundles";
const { createData, ArweaveSigner } = WarpArBundles;

export function createDataItemSigner(wallet: JWKInterface) {
  const signer = async ({
    data,
    tags,
    target,
    anchor,
  }: {
    data: Uint8Array;
    tags?: { name: string; value: string }[];
    target?: string;
    anchor?: string;
  }) => {
    const signer = new ArweaveSigner(wallet);
    const dataItem = createData(data, signer, { tags, target, anchor });
    return dataItem.sign(signer).then(async () => ({
      id: await dataItem.id,
      raw: await dataItem.getRaw(),
    }));
  };

  return signer;
}

export class AOManager {
  private arweave: Arweave;
  private signer: any;
  private processId: string | null = null;

  constructor() {
    this.arweave = Arweave.init({
      host: "arweave.net",
      port: 443,
      protocol: "https",
    });
  }

  async initialize(wallet: JWKInterface | null) {
    if (wallet) {
      this.signer = createDataItemSigner(wallet);
    } else {
      this.signer = null;
    }
    this.processId = "j7Z5SYFHJo8dNi47p53eDuTj1fqY-mKO0-xbzuWQ0hE"; // Replace with your actual process ID
  }

  private async sendMessage(action: string, data: any = {}) {
    if (!this.signer || !this.processId) {
      throw new Error("AOManager not initialized");
    }

    const messageId = await message({
      process: this.processId,
      tags: [{ name: "Action", value: action }],
      signer: this.signer,
      data: JSON.stringify(data),
    });

    const messageResult = await result({
      process: this.processId,
      message: messageId,
    });

    if (messageResult.Error) throw new Error(messageResult.Error);
    return messageResult.Messages?.[0]?.Data;
  }

  async updateUploadConfig(uploadConfig: UploadConfig): Promise<void> {
    await this.sendMessage("CreateUploadConfig", uploadConfig);
  }

  async getUploadConfig(): Promise<UploadConfig | null> {
    const result = await this.sendMessage("ReadUploadConfig");
    return result ? JSON.parse(result) : null;
  }

  async deleteUploadConfig(key: string): Promise<void> {
    await this.sendMessage("DeleteUploadConfig", { Key: key });
  }

  async getState(): Promise<any> {
    const result = await this.sendMessage("GetState");
    return result ? JSON.parse(result) : null;
  }
}

export const aoManager = new AOManager();
