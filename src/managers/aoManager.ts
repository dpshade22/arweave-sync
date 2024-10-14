import { JWKInterface } from "arweave/node/lib/wallet";
import { UploadConfig, FileUploadInfo } from "../types";
import { dryrun, message, result, spawn } from "@permaweb/aoconnect";
import { encrypt, decrypt } from "../utils/encryption";
import * as WarpArBundles from "warp-arbundles";
import { arGql } from "ar-gql";
import ArweaveSync from "../main";
import CryptoJS from "crypto-js";
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
      raw: dataItem.getRaw(),
    }));
  };

  return signer;
}

export class AOManager {
  private signer: any;
  private processId: string | null = null;
  private initialized: boolean = false;
  private argql: ReturnType<typeof arGql>;
  private plugin: ArweaveSync;

  constructor(plugin: ArweaveSync) {
    this.plugin = plugin;
    this.argql = arGql();
  }

  async initialize(wallet: JWKInterface | null) {
    if (wallet) {
      this.signer = createDataItemSigner(wallet);
      this.initialized = true;
      await this.ensureProcessExists();
      await this.updateHandlers();
    } else {
      this.signer = null;
      this.initialized = false;
      this.processId = null;
    }
  }

  private async ensureProcessExists() {
    const customProcessId = this.plugin.settings.customProcessId;
    if (customProcessId) {
      this.processId = customProcessId;
      console.log(`Using custom process ID: ${this.processId}`);
    } else {
      const existingProcess = await this.getExistingProcess();
      if (existingProcess) {
        this.processId = existingProcess;
      } else {
        this.processId = await this.spawnNewProcess();
      }
    }
    console.log(`Using process ID: ${this.processId}`);
  }

  private async getExistingProcess(): Promise<string | null> {
    try {
      const query = `
        query($owner: String!) {
          transactions(
            owners: [$owner],
            tags: [
              { name: "App-Name", values: ["ArweaveSync"] },
              { name: "Type", values: ["Process"] }
            ],
            sort: HEIGHT_ASC
          ) {
            edges {
              node {
                id
              }
            }
          }
        }
      `;

      const variables = {
        owner: await this.plugin.getWalletAddress(),
      };
      const result = await this.argql.run(query, variables);
      const edges = result.data?.transactions?.edges;
      if (edges && edges.length > 0) {
        return edges[0].node.id;
      }
    } catch (error) {
      console.error("Error querying for existing process:", error);
    }
    return null;
  }

  private async spawnNewProcess(): Promise<string> {
    try {
      const processId = await spawn({
        module: "ffvkmPM1jW71hFlBpVbaIapBa_Wl6UIwfdTkDNqsKNw",
        scheduler: "_GQ33BkPtZrqxA84vM8Zk-N2aO0toNNu_C-l-rawrBA",
        signer: this.signer,
        tags: [
          { name: "App-Name", value: "ArweaveSync" },
          { name: "Type", value: "Process" },
        ],
        data: "Spawning ArweaveSync process...",
      });

      console.log("New process spawned with ID:", processId);
      return processId;
    } catch (error) {
      console.error("Error spawning new process:", error);
      throw error;
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  private async sendMessage(action: string, data: any = {}) {
    if (!this.signer || !this.processId) {
      throw new Error("AOManager not initialized");
    }

    const messageId = await message({
      process: this.processId,
      tags: [{ name: "Action", value: action }],
      signer: this.signer,
      data: data,
    });

    const messageResult = await result({
      process: this.processId,
      message: messageId,
    });

    if (messageResult.Error) throw new Error(messageResult.Error);
    return messageResult.Messages?.[0]?.Data;
  }

  private async dryRun(action: string, data: any = {}) {
    if (!this.signer || !this.processId) {
      throw new Error("AOManager not initialized");
    }

    const result = await dryrun({
      process: this.processId,
      tags: [{ name: "Action", value: action }],
      signer: this.signer,
      data: JSON.stringify(data),
    });

    if (result.Error) throw new Error(result.Error);
    return result.Messages?.[0]?.Data;
  }

  private encryptUploadConfig(uploadConfig: UploadConfig): string {
    const jsonString = JSON.stringify(uploadConfig);
    return this.plugin.vaultSyncManager.encrypt(jsonString, false);
  }

  private decryptUploadConfig(encryptedData: string): UploadConfig {
    const decryptedData = this.plugin.vaultSyncManager.decrypt(encryptedData);
    if (typeof decryptedData !== "string") {
      throw new Error("Decrypted data is not a string");
    }
    return JSON.parse(decryptedData);
  }

  async updateUploadConfig(uploadConfig: UploadConfig): Promise<void> {
    if (!this.plugin.vaultSyncManager.isEncryptionPasswordSet()) {
      throw new Error(
        "Encryption password is not set. Please connect a wallet first.",
      );
    }
    const encryptedConfig = this.encryptUploadConfig(uploadConfig);
    await this.sendMessage("UpdateEncryptedUploadConfig", encryptedConfig);
    await this.plugin.vaultSyncManager.updateRemoteConfig();
    this.plugin.updateSyncUI();
  }

  async getUploadConfig(): Promise<UploadConfig | null> {
    if (!this.plugin.vaultSyncManager.isEncryptionPasswordSet()) {
      throw new Error(
        "Encryption password is not set. Please connect a wallet first.",
      );
    }
    try {
      const encryptedConfig = await this.dryRun("GetEncryptedUploadConfig");
      if (encryptedConfig) {
        return this.decryptUploadConfig(encryptedConfig);
      }
    } catch (error) {
      console.error("Error fetching remote upload config:", error);
    }
    return null;
  }

  async getState(): Promise<any> {
    const result = await this.dryRun("GetState");
    return result ? JSON.parse(result) : null;
  }

  async updateHandlers() {
    if (!this.processId || !this.signer) {
      throw new Error("Process ID or signer not set");
    }

    try {
      console.log("Updating handlers...");
      const handlersCode = AO_PROCESS_CODE;

      const evalMessageId = await message({
        process: this.processId,
        tags: [{ name: "Action", value: "Eval" }],
        data: handlersCode,
        signer: this.signer,
      });

      const { Error } = await result({
        process: this.processId,
        message: evalMessageId,
      });

      if (Error) {
        console.error("Error updating handlers:", Error);
      } else {
        console.log("Handlers updated successfully");
      }
    } catch (error) {
      console.error("Error updating handlers:", error);
      throw error;
    }
  }
}

const AO_PROCESS_CODE = `
  local json = require("json")

  -- Initialize state
  State = State or {}
  State.encryptedUploadConfig = State.encryptedUploadConfig or ""
  State.encryptedRenameTracker = State.encryptedRenameTracker or ""

  -- Handler for updating the encrypted upload config
  Handlers.add(
      "UpdateEncryptedUploadConfig",
      Handlers.utils.hasMatchingTag("Action", "UpdateEncryptedUploadConfig"),
      function(msg)
          local encryptedData = msg.Data
          if encryptedData and encryptedData ~= "" then
              State.encryptedUploadConfig = encryptedData
              print("Updated encrypted upload config")
              ao.send({
                  Target = msg.From,
                  Action = "UpdateEncryptedUploadConfigResponse",
                  Data = json.encode({ success = true, message = "Encrypted upload config updated" })
              })
          else
              print("Error: Invalid encrypted data")
              ao.send({
                  Target = msg.From,
                  Action = "UpdateEncryptedUploadConfigResponse",
                  Data = json.encode({ success = false, message = "Error: Invalid encrypted data" })
              })
          end
      end
  )

  -- Handler for updating the encrypted rename tracker
  Handlers.add(
      "UpdateEncryptedRenameTracker",
      Handlers.utils.hasMatchingTag("Action", "UpdateEncryptedRenameTracker"),
      function(msg)
          local encryptedData = msg.Data
          if encryptedData and encryptedData ~= "" then
              State.encryptedRenameTracker = encryptedData
              print("Updated encrypted rename tracker")
              ao.send({
                  Target = msg.From,
                  Action = "UpdateEncryptedRenameTrackerResponse",
                  Data = json.encode({ success = true, message = "Encrypted rename tracker updated" })
              })
          else
              print("Error: Invalid encrypted rename tracker data")
              ao.send({
                  Target = msg.From,
                  Action = "UpdateEncryptedRenameTrackerResponse",
                  Data = json.encode({ success = false, message = "Error: Invalid encrypted data" })
              })
          end
      end
  )

  -- Handler for retrieving the encrypted upload config
  Handlers.add(
      "GetEncryptedUploadConfig",
      Handlers.utils.hasMatchingTag("Action", "GetEncryptedUploadConfig"),
      function(msg)
          print("Sending encrypted upload config")
          ao.send({
              Target = msg.From,
              Action = "GetEncryptedUploadConfigResponse",
              Data = State.encryptedUploadConfig
          })
      end
  )

  -- Handler for retrieving the encrypted rename tracker
  Handlers.add(
      "GetEncryptedRenameTracker",
      Handlers.utils.hasMatchingTag("Action", "GetEncryptedRenameTracker"),
      function(msg)
          print("Sending encrypted rename tracker")
          ao.send({
              Target = msg.From,
              Action = "GetEncryptedRenameTrackerResponse",
              Data = State.encryptedRenameTracker
          })
      end
  )

  -- Handler for getting the full state (for debugging purposes)
  Handlers.add(
      "GetState",
      Handlers.utils.hasMatchingTag("Action", "GetState"),
      function(msg)
          print("Sending full state")
          ao.send({
              Target = msg.From,
              Action = "GetStateResponse",
              Data = json.encode(State)
          })
      end
  )
`;
