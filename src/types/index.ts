import { Buffer } from "buffer";

export interface UploadConfig {
  [filePath: string]: FileUploadInfo;
}

export interface FileVersion {
  txId: string;
  content: string | Buffer;
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
  // encryptionPassword: string;
  lastConfigUploadTxId: string;
  localUploadConfig: UploadConfig;
  remoteUploadConfig: UploadConfig;
  customProcessId: string;
  autoImportUnsyncedChanges: boolean;
  autoExportOnIdle: boolean;
  autoExportOnClose: boolean;
  idleTimeForAutoExport: number;
  monthlyArweaveSpendLimit: number;
  monthlyFilesSynced: number;
  lifetimeFilesSynced: number;
  currentMonthSpend: number;
  monthlyResetDate: number;
}

export const DEFAULT_SETTINGS: ArweaveSyncSettings = {
  // encryptionPassword: "",
  lastConfigUploadTxId: "",
  customProcessId: "",
  localUploadConfig: {},
  remoteUploadConfig: {},
  autoImportUnsyncedChanges: false,
  autoExportOnIdle: false,
  autoExportOnClose: false,
  idleTimeForAutoExport: 5,
  monthlyArweaveSpendLimit: 0.2,
  monthlyFilesSynced: 0,
  lifetimeFilesSynced: 0,
  currentMonthSpend: 0,
  monthlyResetDate: Date.now(),
};
