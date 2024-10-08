import CryptoJS from "crypto-js";
import { Buffer } from "buffer";

export function derivePasswordFromJWK(jwk: any): string {
  const jwkField = jwk.n || JSON.stringify(jwk);
  return CryptoJS.SHA256(jwkField).toString();
}

export function encrypt(
  data: string | Buffer,
  password: string,
  isBinary: boolean = false,
): string {
  let dataToEncrypt: string;

  if (isBinary) {
    // If it's binary data, convert to base64 string
    dataToEncrypt = Buffer.isBuffer(data)
      ? data.toString("base64")
      : Buffer.from(data as string, "binary").toString("base64");
  } else {
    // If it's not binary, treat as UTF-8 string
    dataToEncrypt = Buffer.isBuffer(data)
      ? data.toString("utf8")
      : (data as string);
  }

  const encrypted = CryptoJS.AES.encrypt(dataToEncrypt, password).toString();
  return isBinary ? `binary:${encrypted}` : `text:${encrypted}`;
}

export function decrypt(
  encryptedData: string,
  password: string,
): string | Buffer {
  const [type, data] = encryptedData.split(":", 2);
  const isBinary = type === "binary";

  try {
    const bytes = CryptoJS.AES.decrypt(data, password);
    const decryptedText = bytes.toString(CryptoJS.enc.Utf8);

    if (isBinary) {
      // If it was binary data, return as Buffer
      return Buffer.from(decryptedText, "base64");
    } else {
      // If it was text data, return as string
      return decryptedText;
    }
  } catch (error) {
    console.error("Decryption error:", error);
    throw new Error(
      "Failed to decrypt data. Please check your encryption password.",
    );
  }
}
