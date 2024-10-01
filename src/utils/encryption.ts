import CryptoJS from "crypto-js";

export function encrypt(data: string, password: string): string {
  return CryptoJS.AES.encrypt(data, password).toString();
}

export function decrypt(encryptedData: string, password: string): string {
  try {
    const bytes = CryptoJS.AES.decrypt(encryptedData, password);
    const decryptedText = bytes.toString(CryptoJS.enc.Utf8);
    if (!decryptedText) {
      throw new Error("Decryption resulted in empty string");
    }
    return decryptedText;
  } catch (error) {
    console.error("Decryption error:", error);
    throw new Error(
      "Failed to decrypt data. Please check your encryption password.",
    );
  }
}
