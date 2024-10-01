export interface UploadConfig {
  [filePath: string]: FileUploadInfo;
}

export interface FileUploadInfo {
  txId: string;
  timestamp: number;
  fileHash: string;
  encrypted: boolean;
  filePath: string;
}

export interface ArweaveSyncSettings {
  encryptionPassword: string;
  lastConfigUploadTxId: string;
  localUploadConfig: UploadConfig;
  remoteUploadConfig: UploadConfig;
}

export const DEFAULT_SETTINGS: ArweaveSyncSettings = {
  encryptionPassword: "",
  lastConfigUploadTxId: "",
  localUploadConfig: {},
  remoteUploadConfig: {},
};
