import crypto from "node:crypto";

const ALGO = "aes-256-gcm";

function keyBytes(): Buffer {
  const k = process.env.ENCRYPTION_KEY;
  if (!k) throw new Error("ENCRYPTION_KEY 未设置");
  if (!/^[0-9a-fA-F]{64}$/.test(k)) {
    throw new Error("ENCRYPTION_KEY 必须是 64 位十六进制字符 (32 字节)");
  }
  return Buffer.from(k, "hex");
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, keyBytes(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(".");
}

export function decrypt(packed: string): string {
  const [ivB64, tagB64, encB64] = packed.split(".");
  if (!ivB64 || !tagB64 || !encB64) throw new Error("密文格式错误");
  const decipher = crypto.createDecipheriv(
    ALGO,
    keyBytes(),
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(encB64, "base64")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}
