import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'node:crypto';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public fingerprint?: string,
  ) {
    super(message);
  }
}

export interface Credentials {
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

export interface Sealed {
  iv: string;
  tag: string;
  ciphertext: string;
}

export interface VaultRecord {
  version: 1;
  salt: string;
  verifier: Sealed;
}

export function seal(key: Buffer, text: string, context: string): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

export function unseal(key: Buffer, value: Sealed, context: string): string {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'base64'));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(value.ciphertext, 'base64')), decipher.final()]).toString(
    'utf8',
  );
}

function derive(passphrase: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(passphrase, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export class Vault {
  private key?: Buffer;
  private busy = false;
  private disposed = false;
  private failures = 0;
  private retryAt = 0;

  constructor(
    private persistence: { readVault(): VaultRecord | undefined; writeVault(value: VaultRecord): void },
  ) {}

  get state() {
    return { configured: !!this.persistence.readVault(), unlocked: !!this.key };
  }

  requireUnlocked(): void {
    if (!this.key) throw new ApiError(423, 'Unlock the vault first.', 'VAULT_LOCKED');
  }

  async unlock(passphrase: string): Promise<void> {
    if (typeof passphrase !== 'string' || passphrase.length < 12 || passphrase.length > 1024) {
      throw new ApiError(400, 'Passphrase must contain between 12 and 1024 characters.');
    }
    if (this.disposed) throw new ApiError(503, 'Manager is shutting down.');
    if (this.busy || Date.now() < this.retryAt)
      throw new ApiError(429, 'Wait before trying to unlock again.', 'UNLOCK_RATE_LIMIT');
    if (this.key) return;
    this.busy = true;
    let key: Buffer | undefined;
    try {
      const record = this.persistence.readVault();
      const salt = record ? Buffer.from(record.salt, 'base64') : randomBytes(32);
      key = await derive(passphrase, salt);
      if (this.disposed) throw new ApiError(503, 'Manager is shutting down.');
      if (record) {
        try {
          if (
            record.version !== 1 ||
            unseal(key, record.verifier, 'hermes-manager:vault:1') !== 'hermes-manager vault verifier'
          )
            throw new Error();
        } catch {
          this.retryAt = Date.now() + Math.min(30_000, 1000 * 2 ** Math.min(this.failures++, 5));
          throw new ApiError(401, 'Incorrect passphrase or damaged vault.', 'VAULT_UNLOCK_FAILED');
        }
      } else {
        this.persistence.writeVault({
          version: 1,
          salt: salt.toString('base64'),
          verifier: seal(key, 'hermes-manager vault verifier', 'hermes-manager:vault:1'),
        });
      }
      this.key = key;
      key = undefined;
      this.failures = 0;
      this.retryAt = 0;
    } finally {
      key?.fill(0);
      this.busy = false;
    }
  }

  lock(): void {
    if (this.busy) throw new ApiError(409, 'Vault unlock is still in progress.');
    this.key?.fill(0);
    this.key = undefined;
  }

  dispose(): void {
    this.disposed = true;
    this.key?.fill(0);
    this.key = undefined;
  }

  encrypt(id: string, credentials: Credentials): Sealed {
    this.requireUnlocked();
    return seal(this.key!, JSON.stringify(credentials), `hermes-manager:agent:${id}`);
  }

  decrypt(id: string, encrypted: Sealed): Credentials {
    this.requireUnlocked();
    try {
      return JSON.parse(unseal(this.key!, encrypted, `hermes-manager:agent:${id}`)) as Credentials;
    } catch {
      throw new ApiError(409, 'Saved credentials could not be decrypted.', 'CREDENTIAL_DAMAGED');
    }
  }

  encryptSshKey(id: string, credentials: Credentials): Sealed {
    this.requireUnlocked();
    return seal(this.key!, JSON.stringify(credentials), `hermes-manager:sshkey:${id}`);
  }

  decryptSshKey(id: string, sealed: Sealed): Credentials {
    this.requireUnlocked();
    try {
      return JSON.parse(unseal(this.key!, sealed, `hermes-manager:sshkey:${id}`)) as Credentials;
    } catch {
      throw new ApiError(409, 'Saved SSH key could not be decrypted.', 'CREDENTIAL_DAMAGED');
    }
  }

  encryptGitHubToken(token: string): Sealed {
    this.requireUnlocked();
    return seal(this.key!, token, 'hermes-manager:github-pat');
  }

  decryptGitHubToken(sealed: Sealed): string {
    this.requireUnlocked();
    try {
      return unseal(this.key!, sealed, 'hermes-manager:github-pat');
    } catch {
      throw new ApiError(409, 'GitHub token could not be decrypted.', 'CREDENTIAL_DAMAGED');
    }
  }

  encryptOpenAIKey(key: string): Sealed {
    this.requireUnlocked();
    return seal(this.key!, key, 'hermes-manager:openai-key');
  }

  decryptOpenAIKey(sealed: Sealed): string {
    this.requireUnlocked();
    try {
      return unseal(this.key!, sealed, 'hermes-manager:openai-key');
    } catch {
      throw new ApiError(409, 'OpenAI key could not be decrypted.', 'CREDENTIAL_DAMAGED');
    }
  }

  encryptHuggingFaceKey(key: string): Sealed {
    this.requireUnlocked();
    return seal(this.key!, key, 'hermes-manager:hf-key');
  }

  decryptHuggingFaceKey(sealed: Sealed): string {
    this.requireUnlocked();
    try {
      return unseal(this.key!, sealed, 'hermes-manager:hf-key');
    } catch {
      throw new ApiError(409, 'HuggingFace key could not be decrypted.', 'CREDENTIAL_DAMAGED');
    }
  }
}

// SSH library errors are never exposed; this also filters accidental remote echoes.
export function secretRedactor(
  credentials: Credentials,
  streaming = false,
): (text: string, final?: boolean) => string {
  const values = [
    credentials.password,
    credentials.passphrase,
    ...(streaming ? [] : [credentials.privateKey]),
    ...(credentials.privateKey?.split(/\r?\n/).filter((line) => line && !line.startsWith('-----')) ?? []),
  ].filter((value): value is string => !!value);
  const secrets = [...new Set(values.flatMap((value) => [value, JSON.stringify(value).slice(1, -1)]))].sort(
    (a, b) => b.length - a.length,
  );
  let pending = '';
  return (text, final = false) => {
    text = pending + text;
    pending = '';
    for (const secret of secrets) text = text.split(secret).join('[redacted]');
    if (streaming && !final) {
      // Retain only suffixes that could become a secret when the next SSH chunk arrives.
      let cut = text.length;
      for (const secret of secrets) {
        const lower = Math.max(0, text.length - secret.length + 1);
        for (
          let start = text.lastIndexOf(secret[0]);
          start >= lower;
          start = text.lastIndexOf(secret[0], start - 1)
        ) {
          if (secret.startsWith(text.slice(start))) cut = Math.min(cut, start);
          if (start === 0) break;
        }
      }
      pending = text.slice(cut);
      text = text.slice(0, cut);
    }
    return text;
  };
}
