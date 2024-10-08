export interface UploadConfig {
  [filePath: string]: FileUploadInfo;
}

export interface FileVersion {
  txId: string;
  content: string;
  timestamp: number;
  previousVersionTxId: string | null;
}

export interface FileUploadInfo {
  txId: string;
  timestamp: number;
  fileHash: string;
  encrypted: boolean;
  filePath: string;
  oldFilePath?: string | null;
  previousVersionTxId: string | null;
  versionNumber: number;
}

export interface ArweaveSyncSettings {
  encryptionPassword: string;
  lastConfigUploadTxId: string;
  localUploadConfig: UploadConfig;
  remoteUploadConfig: UploadConfig;
  customProcessId: string;
  autoImportUnsyncedChanges: boolean;
}

export const DEFAULT_SETTINGS: ArweaveSyncSettings = {
  encryptionPassword: "",
  lastConfigUploadTxId: "",
  customProcessId: "",
  localUploadConfig: {},
  remoteUploadConfig: {},
  autoImportUnsyncedChanges: false,
};
