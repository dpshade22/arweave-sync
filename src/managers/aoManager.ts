import { JWKInterface } from "arweave/node/lib/wallet";
import { UploadConfig, FileUploadInfo } from "../types";
import { dryrun, message, result, spawn } from "@permaweb/aoconnect";
import * as WarpArBundles from "warp-arbundles";
import { arGql } from "ar-gql";
import ArweaveSync from "../main";
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
        owner: this.plugin.getWalletAddress(),
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
      data: JSON.stringify(data),
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

  async renameUploadConfig(oldPath: string, newPath: string): Promise<void> {
    await this.sendMessage("RenameUploadConfig", { oldPath, newPath });
  }

  async updateUploadConfig(uploadConfig: UploadConfig): Promise<void> {
    try {
      const uploadConfigArray = Object.entries(uploadConfig).map(
        ([key, value]) => ({ key, value }),
      );
      console.log(
        "Sending upload config to AO:",
        JSON.stringify(uploadConfigArray, null, 2),
      );
      const result = await this.sendMessage("UpdateUploadConfig", {
        uploadConfig: uploadConfigArray,
      });
      console.log("Raw AO response for UpdateUploadConfig:", result);

      // Check if the result is already an object
      const parsedResult =
        typeof result === "object" ? result : JSON.parse(result);
      console.log("Parsed AO response for UpdateUploadConfig:", parsedResult);

      // Check if the update was successful based on the response structure
      if (parsedResult.uploadConfig) {
        console.log("AO upload config updated successfully");
        return;
      } else {
        console.warn("Unexpected AO response format:", parsedResult);
      }
    } catch (error) {
      console.error("Error during AO upload config update:", error);
    }
  }

  async getUploadConfig(): Promise<UploadConfig | null> {
    const result = await this.dryRun("GetUploadConfig");
    if (result) {
      const parsedResult = JSON.parse(result) as Array<{
        key: string;
        value: FileUploadInfo;
      }>;
      console.log("Parsed AO response for GetUploadConfig:", parsedResult);
      return parsedResult.reduce((acc: UploadConfig, { key, value }) => {
        acc[key] = value;
        return acc;
      }, {});
    }
    return null;
  }

  async deleteUploadConfig(filePath: string): Promise<void> {
    await this.sendMessage("DeleteUploadConfig", { Key: filePath });
  }

  async getState(): Promise<any> {
    const result = await this.sendMessage("GetState");
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
-- ArweaveSync AO Process
local json = require("json")

-- Initialize state
State = State or {}
State.uploadConfig = State.uploadConfig or {}


-- CRUD Handlers for upload config
Handlers.add(
    "CreateUploadConfig",
    Handlers.utils.hasMatchingTag("Action", "CreateUploadConfig"),
    function(msg)
        local data = json.decode(msg.Data)
        if data and type(data) == "table" then
            for key, value in pairs(data) do
                if value.txId and value.txId ~= "" then
                    State.uploadConfig[key] = value
                    print("Added/Updated upload config for: " .. key)
                end
            end
            ao.send({
                Target = msg.From,
                Action = "CreateUploadConfigResponse",
                Data = json.encode({ success = true, message = "Upload config created/updated" })
            })
        else
            print("Error: Invalid data format in CreateUploadConfig")
            ao.send({
                Target = msg.From,
                Action = "CreateUploadConfigResponse",
                Data = json.encode({ success = false, message = "Error: Invalid data format" })
            })
        end
    end
)

Handlers.add(
    "RenameUploadConfig",
    Handlers.utils.hasMatchingTag("Action", "RenameUploadConfig"),
    function(msg)
        local data = json.decode(msg.Data)
        if data and type(data) == "table" and data.oldPath and data.newPath then
            if State.uploadConfig[data.oldPath] then
                State.uploadConfig[data.newPath] = State.uploadConfig[data.oldPath]
                State.uploadConfig[data.newPath].filePath = data.newPath
                State.uploadConfig[data.oldPath] = nil
                print("Renamed upload config from " .. data.oldPath .. " to " .. data.newPath)

                ao.send({
                    Target = msg.From,
                    Action = "RenameUploadConfigResponse",
                    Data = json.encode({ success = true, message = "Upload config renamed" })
                })
            else
                print("Error: Old path not found in upload config - " .. data.oldPath)
                ao.send({
                    Target = msg.From,
                    Action = "RenameUploadConfigResponse",
                    Data = json.encode({ success = false, message = "Error: Old path not found in upload config" })
                })
            end
        else
            print("Error: Invalid data format in RenameUploadConfig")
            ao.send({
                Target = msg.From,
                Action = "RenameUploadConfigResponse",
                Data = json.encode({ success = false, message = "Error: Invalid data format" })
            })
        end
    end
)

Handlers.add(
    "GetUploadConfig",
    Handlers.utils.hasMatchingTag("Action", "GetUploadConfig"),
    function(msg)
        local key = msg.Tags.Key
        if key then
            local value = State.uploadConfig[key]
            if value then
                print("Retrieved upload config for: " .. key)
                ao.send({
                    Target = msg.From,
                    Action = "GetUploadConfigResponse",
                    Data = json.encode(value)
                })
            else
                print("Error: Upload config not found for key - " .. key)
                ao.send({
                    Target = msg.From,
                    Action = "GetUploadConfigResponse",
                    Data = json.encode({ success = false, message = "Error: Upload config not found" })
                })
            end
        else
            print("Sending full upload config")
            local result = {}
            for key, value in pairs(State.uploadConfig) do
                table.insert(result, { key = key, value = value })
            end
            ao.send({
                Target = msg.From,
                Action = "GetUploadConfigResponse",
                Data = json.encode(result)
            })
        end
    end
)

Handlers.add(
    "UpdateUploadConfig",
    Handlers.utils.hasMatchingTag("Action", "UpdateUploadConfig"),
    function(msg)
        local data = json.decode(msg.Data)
        if data and type(data) == "table" and data.uploadConfig then
            for _, item in ipairs(data.uploadConfig) do
                local key = item.key
                local value = item.value
                if value.txId and value.txId ~= "" then
                    State.uploadConfig[key] = value
                    print("Updated upload config for: " .. key)
                else
                    State.uploadConfig[key] = nil
                    print("Removed upload config for: " .. key)
                end
            end
            ao.send({
                Target = msg.From,
                Action = "UpdateUploadConfigResponse",
                Data = json.encode({ success = true, message = "Upload config updated" })
            })
        else
            print("Error: Invalid data format in UpdateUploadConfig")
            ao.send({
                Target = msg.From,
                Action = "UpdateUploadConfigResponse",
                Data = json.encode({ success = false, message = "Error: Invalid data format" })
            })
        end
    end
)

Handlers.add(
    "DeleteUploadConfig",
    Handlers.utils.hasMatchingTag("Action", "DeleteUploadConfig"),
    function(msg)
        local data = json.decode(msg.Data)
        local key = data.Key
        if key then
            if State.uploadConfig[key] then
                State.uploadConfig[key] = nil
                print("Deleted upload config for: " .. key)
                ao.send({
                    Target = msg.From,
                    Action = "DeleteUploadConfigResponse",
                    Data = json.encode({ success = true, message = "Upload config deleted" })
                })
            else
                print("Warning: Upload config not found for deletion - " .. key)
                ao.send({
                    Target = msg.From,
                    Action = "DeleteUploadConfigResponse",
                    Data = json.encode({
                        success = true,
                        message =
                        "Warning: Upload config not found, but operation completed"
                    })
                })
            end
        else
            print("Error: Missing key in DeleteUploadConfig")
            ao.send({
                Target = msg.From,
                Action = "DeleteUploadConfigResponse",
                Data = json.encode({ success = false, message = "Error: Missing key" })
            })
        end
    end
)

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
