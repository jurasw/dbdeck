import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

export interface Encryption {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export class DesktopStorage {
  private data: Record<string, unknown>;
  constructor(
    private file: string,
    private encryption: Encryption,
  ) {
    this.data = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  }
  private write(): void {
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    writeFileSync(`${this.file}.tmp`, JSON.stringify(this.data), {
      mode: 0o600,
    });
    renameSync(`${this.file}.tmp`, this.file);
  }
  globalState = {
    get: <T>(key: string, fallback?: T): T =>
      structuredClone((this.data[key] ?? fallback) as T),
    update: async (key: string, value: unknown): Promise<void> => {
      this.data[key] = value;
      this.write();
    },
  };
  secrets = {
    get: async (key: string): Promise<string | undefined> => {
      const value = this.data[`secret:${key}`];
      if (typeof value !== "string") return undefined;
      return this.encryption.decryptString(Buffer.from(value, "base64"));
    },
    store: async (key: string, value: string): Promise<void> => {
      if (!this.encryption.isEncryptionAvailable())
        throw new Error(
          "macOS Keychain is unavailable. Turn off Remember password to use session memory.",
        );
      this.data[`secret:${key}`] = this.encryption
        .encryptString(value)
        .toString("base64");
      this.write();
    },
    delete: async (key: string): Promise<void> => {
      delete this.data[`secret:${key}`];
      this.write();
    },
  };
}
