import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

type EncryptedSecret = {
  ciphertext: string;
  iv: string;
  tag: string;
};

function encryptionKey() {
  const configured = process.env.APP_ENCRYPTION_KEY?.trim();
  if (configured) {
    const candidate = /^[a-f\d]{64}$/i.test(configured)
      ? Buffer.from(configured, "hex")
      : Buffer.from(configured, "base64");
    if (candidate.length !== 32) {
      throw new Error("APP_ENCRYPTION_KEY 必须是 32 字节 Base64 或 64 位十六进制字符串");
    }
    return candidate;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("生产环境必须配置 APP_ENCRYPTION_KEY");
  }

  return createHash("sha256").update("cuancuan-local-development-key").digest();
}

export function encryptSecret(value: string): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptSecret(secret: EncryptedSecret) {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(secret.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(secret.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function maskSecret(value: string) {
  if (!value) return "未配置";
  if (value.length <= 8) return "••••••••";
  return `${value.slice(0, 3)}••••••${value.slice(-4)}`;
}
