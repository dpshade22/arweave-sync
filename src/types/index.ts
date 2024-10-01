export interface ArweaveSyncSettings {
  encryptionPassword: string;
  lastConfigUploadTxId: string;
}

export const DEFAULT_SETTINGS: ArweaveSyncSettings = {
  encryptionPassword: "",
  lastConfigUploadTxId: "",
};

export interface FileUploadInfo {
  encrypted: boolean;
  timestamp: number;
  folderPath: string;
  fileHash: string;
  filePath: string;
  fileName: string;
  txId: string;
}

export interface UploadConfig {
  [filePath: string]: FileUploadInfo;
}
