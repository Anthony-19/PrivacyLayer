import { stableHash32 } from './stable';

type CryptoLike = {
  getRandomValues<T extends ArrayBufferView | null>(array: T): T;
};

export interface RandomnessSource {
  randomBytes(length: number): Uint8Array;
}

export interface RuntimeRandomnessSourceOptions {
  runtime?: { crypto?: CryptoLike };
  enableNodeFallback?: boolean;
}

function resolveRuntimeCrypto(options: RuntimeRandomnessSourceOptions = {}): CryptoLike {
  const runtime = options.runtime ?? (globalThis as RuntimeRandomnessSourceOptions['runtime']);
  if (runtime?.crypto && typeof runtime.crypto.getRandomValues === 'function') {
    return runtime.crypto;
  }

  if (options.enableNodeFallback !== false) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const nodeCrypto = require('crypto') as { webcrypto?: CryptoLike };
      if (nodeCrypto.webcrypto && typeof nodeCrypto.webcrypto.getRandomValues === 'function') {
        return nodeCrypto.webcrypto;
      }
    } catch {
      // Runtime does not support require('crypto')
    }
  }

  throw new Error(
    'Secure randomness unavailable: no crypto.getRandomValues implementation found in this runtime.'
  );
}

/**
 * RuntimeRandomnessSource uses secure randomness in browser and Node runtimes.
 */
export class RuntimeRandomnessSource implements RandomnessSource {
  private options: RuntimeRandomnessSourceOptions;

  constructor(options: RuntimeRandomnessSourceOptions = {}) {
    this.options = options;
  }

  randomBytes(length: number): Uint8Array {
    if (!Number.isInteger(length) || length <= 0) {
      throw new Error(`Random byte length must be a positive integer, received: ${length}`);
    }
    const out = new Uint8Array(length);
    resolveRuntimeCrypto(this.options).getRandomValues(out);
    return out;
  }
}

let defaultRandomnessSource: RandomnessSource = new RuntimeRandomnessSource();

export function setDefaultRandomnessSource(source: RandomnessSource): void {
  defaultRandomnessSource = source;
}

export function resetDefaultRandomnessSource(): void {
  defaultRandomnessSource = new RuntimeRandomnessSource();
}

/**
 * PrivacyLayer Note
 *
 * Represents a private "IOU" in the shielded pool.
 * A note consists of a nullifier (revealed on withdrawal) and a secret (never revealed).
 * The commitment = Hash(nullifier, secret) is what's stored in the Merkle tree.
 */
export class Note {
  constructor(
    public readonly nullifier: Buffer,
    public readonly secret: Buffer,
    public readonly poolId: string,
    public readonly amount: bigint
  ) {
    if (nullifier.length !== 31 || secret.length !== 31) {
      throw new Error('Nullifier and secret must be 31 bytes to fit BN254 field');
    }
  }

  /**
   * Create a new random note for a specific pool.
   */
  static generate(poolId: string, amount: bigint, randomnessSource: RandomnessSource = defaultRandomnessSource): Note {
    return new Note(
      Buffer.from(randomnessSource.randomBytes(31)),
      Buffer.from(randomnessSource.randomBytes(31)),
      poolId,
      amount
    );
  }

  /**
   * Deterministic derivation for fixtures/testing only.
   * Keep this separate from production randomness.
   */
  static deriveDeterministic(seed: Uint8Array | Buffer | string, poolId: string, amount: bigint): Note {
    const seedBytes = typeof seed === 'string' ? Buffer.from(seed, 'utf8') : Buffer.from(seed);
    const nullifier = stableHash32('note-nullifier', seedBytes, poolId, amount).subarray(0, 31);
    const secret = stableHash32('note-secret', seedBytes, poolId, amount).subarray(0, 31);
    return new Note(Buffer.from(nullifier), Buffer.from(secret), poolId, amount);
  }

  /**
   * In a real implementation, this would use a WASM-based Poseidon hash
   * compatible with the Noir circuit and Soroban host function.
   */
  getCommitment(): Buffer {
    // Placeholder commitment derivation for SDK plumbing tests.
    // Production should replace this with Poseidon(nullifier, secret).
    return stableHash32('commitment', this.nullifier, this.secret);
  }

  /**
   * Import a note from a backup string produced by `exportBackup`.
   *
   * Throws `NoteBackupError` with a typed `code` field on any validation failure:
   * - `INVALID_PREFIX`   — string does not start with the expected prefix
   * - `INVALID_LENGTH`   — payload is not exactly 107 bytes
   * - `INVALID_VERSION`  — version byte is not recognised
   * - `CHECKSUM_MISMATCH` — integrity check failed (truncated or corrupt data)
   * - `CORRUPT_DATA`     — the hex payload could not be parsed
   */
  static importBackup(backup: string): Note {
    if (!backup.startsWith(BACKUP_PREFIX)) {
      throw new NoteBackupError(
        `Note backup must start with "${BACKUP_PREFIX}"`,
        'INVALID_PREFIX'
      );
    }

    const hex = backup.slice(BACKUP_PREFIX.length);
    let payload: Buffer;
    try {
      payload = Buffer.from(hex, 'hex');
    } catch {
      throw new NoteBackupError('Note backup contains invalid hex data', 'CORRUPT_DATA');
    }

    if (payload.length !== BACKUP_PAYLOAD_LENGTH) {
      throw new NoteBackupError(
        `Note backup payload must be ${BACKUP_PAYLOAD_LENGTH} bytes, got ${payload.length}`,
        'INVALID_LENGTH'
      );
    }

    const version = payload[0];
    if (version !== BACKUP_VERSION) {
      throw new NoteBackupError(
        `Unsupported note backup version: ${version} (expected ${BACKUP_VERSION})`,
        'INVALID_VERSION'
      );
    }

    // Verify checksum over bytes [0..102]
    const storedChecksum = payload.subarray(103, 107);
    const computed = createHash('sha256').update(payload.subarray(0, 103)).digest();
    if (!computed.subarray(0, 4).equals(storedChecksum)) {
      throw new NoteBackupError(
        'Note backup checksum mismatch: data may be corrupt or truncated',
        'CHECKSUM_MISMATCH'
      );
    }

    const nullifier = Buffer.from(payload.subarray(1, 32));
    const secret = Buffer.from(payload.subarray(32, 63));
    const poolId = payload.subarray(63, 95).toString('hex');
    const amount = payload.readBigUInt64BE(95);

    return new Note(nullifier, secret, poolId, amount);
  }

  // ---------------------------------------------------------------------------
  // Legacy serialization (kept for backward compatibility)
  // ---------------------------------------------------------------------------

  /**
   * @deprecated Use `exportBackup` for new code.
   */
  serialize(): string {
    const data = Buffer.concat([
      this.nullifier,
      this.secret,
      Buffer.from(this.poolId, 'hex'),
      Buffer.alloc(16), // amount padding
    ]);
    data.writeBigUInt64BE(this.amount, 31 + 31 + 32);
    return `privacylayer-note-${data.toString('hex')}`;
  }

  /**
   * @deprecated Use `Note.importBackup` for new code.
   */
  static deserialize(noteStr: string): Note {
    if (!noteStr.startsWith('privacylayer-note-')) {
      throw new Error('Invalid note format');
    }
    const hex = noteStr.replace('privacylayer-note-', '');
    const data = Buffer.from(hex, 'hex');

    const nullifier = data.subarray(0, 31);
    const secret = data.subarray(31, 62);
    const poolId = data.subarray(62, 94).toString('hex');
    const amount = data.readBigUInt64BE(94);

    return new Note(nullifier, secret, poolId, amount);
  }
}
