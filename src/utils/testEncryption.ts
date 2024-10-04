import { encrypt, decrypt } from "./encryption";
import { TFile, Notice } from "obsidian";
import ArweaveSync from "../main";
import { Buffer } from "buffer";

export async function testEncryptionWithSpecificFile(
  plugin: ArweaveSync,
  filePath: string,
) {
  const password = "testPassword123";

  try {
    const file = plugin.app.vault.getAbstractFileByPath(filePath);

    if (!file || !(file instanceof TFile)) {
      new Notice(`File not found: ${filePath}`);
      return;
    }

    const isBinary = plugin.vaultSyncManager.isBinaryFile(file);
    const fileContent = isBinary
      ? await plugin.app.vault.readBinary(file)
      : await plugin.app.vault.read(file);

    console.log(`Testing encryption for file: ${file.path}`);
    console.log("Original file size:", fileContent.length, "bytes");
    console.log("Is Binary:", isBinary);

    const encrypted = encrypt(fileContent, password, isBinary);
    console.log("Encrypted data:", encrypted.substring(0, 50) + "...");

    const decrypted = decrypt(encrypted, password);

    if (Buffer.isBuffer(decrypted)) {
      console.log("Decrypted file size:", decrypted.length, "bytes");
      console.log("Match:", Buffer.from(fileContent).equals(decrypted));
    } else {
      console.log("Decrypted file size:", decrypted.length, "characters");
      console.log("Match:", fileContent === decrypted);
    }

    // Optionally, save the decrypted file to verify
    const decryptedFilePath = `${file.parent?.path ?? ""}/decrypted${file.name}`;
    if (Buffer.isBuffer(decrypted)) {
      await plugin.app.vault.createBinary(decryptedFilePath, decrypted);
    } else {
      await plugin.app.vault.create(decryptedFilePath, decrypted);
    }
    new Notice(`Decrypted file saved as ${decryptedFilePath}`);
  } catch (error) {
    console.error("Error during file encryption test:", error);
    new Notice("Error during file encryption test. Check console for details.");
  }
}
