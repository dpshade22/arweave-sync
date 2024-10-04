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
    // Get the file from the vault
    const file = plugin.app.vault.getAbstractFileByPath(filePath);

    if (!file || !(file instanceof TFile)) {
      new Notice(`File not found: ${filePath}`);
      return;
    }

    // Read the file as an ArrayBuffer
    const fileArrayBuffer = await plugin.app.vault.readBinary(file);
    const fileBuffer = Buffer.from(fileArrayBuffer);

    console.log(`Testing encryption for file: ${file.path}`);
    console.log("Original file size:", fileBuffer.length, "bytes");

    // Encrypt the file
    const encrypted = encrypt(fileBuffer, password);
    console.log("Encrypted data:", encrypted.substring(0, 50) + "...");

    // Decrypt the file
    const decrypted = decrypt(encrypted, password);

    if (Buffer.isBuffer(decrypted)) {
      console.log("Decrypted file size:", decrypted.length, "bytes");
      console.log("Match:", fileBuffer.equals(decrypted));

      // Optionally, save the decrypted file to verify
      const decryptedFilePath = `${file.parent.path}/decrypted_${file.name}`;
      await plugin.app.vault.createBinary(decryptedFilePath, decrypted);
      new Notice(`Decrypted file saved as ${decryptedFilePath}`);
    } else {
      console.log(decrypted);
      console.log("Decryption did not return a Buffer as expected");
    }
  } catch (error) {
    console.error("Error during file encryption test:", error);
    new Notice("Error during file encryption test. Check console for details.");
  }
}
