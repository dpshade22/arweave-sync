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

export enum SyncState {
  NewLocal = "new-local",
  NewRemote = "new-remote",
  LocalNewer = "local-newer",
  RemoteNewer = "remote-newer",
  Synced = "synced",
  DecryptFailed = "decrypt-failed",
}

export interface ArweaveSyncSettings {
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
  fullAutoSync: boolean;
  syncInterval: number;
  syncOnStartup: boolean;
  syncOnFileChange: boolean;
  syncDirection: "bidirectional" | "uploadOnly" | "downloadOnly";
  filesToSync: "all" | "selected";
  selectedFoldersToSync: string[];
  excludedFolders: string[];
  syncFileTypes: string[];
  debugMode: boolean;
}

export const DEFAULT_SETTINGS: ArweaveSyncSettings = {
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
  fullAutoSync: false,
  syncInterval: 30,
  syncOnStartup: false,
  syncOnFileChange: false,
  syncDirection: "bidirectional",
  filesToSync: "all",
  selectedFoldersToSync: [],
  excludedFolders: [],
  syncFileTypes: [".md", ".txt", ".png", ".jpg", ".jpeg", ".pdf"],
  debugMode: false,
};
