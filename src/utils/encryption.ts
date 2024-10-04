import CryptoJS from "crypto-js";
import { Buffer } from "buffer";

function isTextData(data: string | Buffer): boolean {
  if (typeof data === "string") {
    return true;
  }

  // Check if the Buffer contains only valid UTF-8 characters
  try {
    return Buffer.from(data.toString(), "utf8").equals(data);
  } catch {
    return false;
  }
}

export function encrypt(data: string | Buffer, password: string): string {
  let dataToEncrypt: string;
  let isBuffer = false;

  if (Buffer.isBuffer(data)) {
    if (isTextData(data)) {
      dataToEncrypt = data.toString("utf8");
    } else {
      dataToEncrypt = data.toString("base64");
      isBuffer = true;
    }
  } else {
    dataToEncrypt = data;
  }

  const encrypted = CryptoJS.AES.encrypt(dataToEncrypt, password).toString();
  return isBuffer ? `buffer:${encrypted}` : `string:${encrypted}`;
}

export function decrypt(
  encryptedData: string,
  password: string,
): string | Buffer {
  const [type, data] = encryptedData.split(":", 2);

  try {
    const bytes = CryptoJS.AES.decrypt(data, password);
    const decryptedText = bytes.toString(CryptoJS.enc.Utf8);

    if (type === "buffer") {
      return Buffer.from(decryptedText, "base64");
    } else {
      return decryptedText;
    }
  } catch (error) {
    console.error("Decryption error:", error);
    throw new Error(
      "Failed to decrypt data. Please check your encryption password.",
    );
  }
}
