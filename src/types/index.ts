export interface ArweaveSyncSettings {
  encryptionPassword: string;
  lastConfigUploadTxId: string;
  uploadConfig: UploadConfig;
}

export const DEFAULT_SETTINGS: ArweaveSyncSettings = {
  encryptionPassword: "",
  lastConfigUploadTxId: "",
  uploadConfig: {},
};

export interface FileUploadInfo {
  encrypted: boolean;
  timestamp: number;
  fileHash: string;
  filePath: string;
  txId: string;
}

export interface UploadConfig {
  [filePath: string]: FileUploadInfo;
}
