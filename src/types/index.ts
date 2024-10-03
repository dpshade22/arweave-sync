export interface UploadConfig {
  [filePath: string]: FileUploadInfo;
}

export interface FileUploadInfo {
  txId: string;
  timestamp: number;
  fileHash: string;
  encrypted: boolean;
  filePath: string;
  previousVersionTxId: string | null;
  versionNumber: number;
}

export interface ArweaveSyncSettings {
  encryptionPassword: string;
  lastConfigUploadTxId: string;
  localUploadConfig: UploadConfig;
  remoteUploadConfig: UploadConfig;
  customProcessId: string;
}

export const DEFAULT_SETTINGS: ArweaveSyncSettings = {
  encryptionPassword: "",
  lastConfigUploadTxId: "",
  customProcessId: "",
  localUploadConfig: {},
  remoteUploadConfig: {},
};
