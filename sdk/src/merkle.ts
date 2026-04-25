import { MerkleProof } from './proof';
import { normalizeHex, stableHash32 } from './stable';

export type CommitmentLike = Buffer | Uint8Array | string;

export interface MerkleCheckpoint {
  version: 1;
  depth: number;
  nextIndex: number;
  root: string;
  frontier: Array<string | null>;
  leaves?: string[];
}

export interface BatchSyncResult {
  insertedLeafIndices: number[];
  checkpoint: MerkleCheckpoint;
  root: Buffer;
}

function toLeaf(commitment: CommitmentLike): Buffer {
  if (Buffer.isBuffer(commitment) || commitment instanceof Uint8Array) {
    const bytes = Buffer.from(commitment);
    return bytes.length === 32 ? bytes : stableHash32('leaf-bytes', bytes);
  }

  const normalized = normalizeHex(commitment);
  if (/^[0-9a-f]+$/i.test(normalized) && normalized.length % 2 === 0) {
    const bytes = Buffer.from(normalized, 'hex');
    return bytes.length === 32 ? bytes : stableHash32('leaf-hex', bytes);
  }

  return stableHash32('leaf-text', commitment);
}

export class LocalMerkleTree {
  readonly depth: number;
  private readonly zeroes: Buffer[];
  private readonly frontier: Array<Buffer | null>;
  private trackedLeaves: Buffer[];
  private nextIndex: number;
  private root: Buffer;

  constructor(depth: number = 20) {
    if (!Number.isInteger(depth) || depth <= 0 || depth > 31) {
      throw new Error(`Merkle depth must be an integer in [1, 31], received ${depth}`);
    }

    this.depth = depth;
    this.zeroes = this.buildZeroes(depth);
    this.frontier = new Array<Buffer | null>(depth).fill(null);
    this.trackedLeaves = [];
    this.nextIndex = 0;
    this.root = Buffer.from(this.zeroes[depth]);
  }

  static fromCheckpoint(checkpoint: MerkleCheckpoint): LocalMerkleTree {
    if (checkpoint.frontier.length !== checkpoint.depth) {
      throw new Error(
        `Invalid checkpoint: frontier length ${checkpoint.frontier.length} does not match depth ${checkpoint.depth}`
      );
    }

    const tree = new LocalMerkleTree(checkpoint.depth);
    tree.nextIndex = checkpoint.nextIndex;
    tree.root = Buffer.from(normalizeHex(checkpoint.root), 'hex');

    for (let i = 0; i < checkpoint.frontier.length; i += 1) {
      const entry = checkpoint.frontier[i];
      tree.frontier[i] = entry ? Buffer.from(normalizeHex(entry), 'hex') : null;
    }

    if (checkpoint.leaves) {
      tree.trackedLeaves = checkpoint.leaves.map((leaf) => Buffer.from(normalizeHex(leaf), 'hex'));
    }

    return tree;
  }

  get leafCount(): number {
    return this.nextIndex;
  }

  getRoot(): Buffer {
    return Buffer.from(this.root);
  }

  insert(leaf: CommitmentLike): number {
    const capacity = 2 ** this.depth;
    if (this.nextIndex >= capacity) {
      throw new Error(`Merkle tree is full at depth ${this.depth}`);
    }

    const normalizedLeaf = toLeaf(leaf);
    this.trackedLeaves.push(normalizedLeaf);

    let index = this.nextIndex;
    let current = normalizedLeaf;

    for (let level = 0; level < this.depth; level += 1) {
      if ((index & 1) === 0) {
        this.frontier[level] = current;
        current = this.hashPair(current, this.zeroes[level]);
      } else {
        const left = this.frontier[level] ?? this.zeroes[level];
        current = this.hashPair(left, current);
      }
      index >>= 1;
    }

    const insertedAt = this.nextIndex;
    this.nextIndex += 1;
    this.root = current;
    return insertedAt;
  }

  insertBatch(leaves: CommitmentLike[]): number[] {
    const indices: number[] = [];
    for (const leaf of leaves) {
      indices.push(this.insert(leaf));
    }
    return indices;
  }

  /**
   * Generates a Merkle proof for a tracked leaf index.
   * This requires that leaves are available in memory.
   */
  generateProof(leafIndex: number): MerkleProof {
    if (!Number.isInteger(leafIndex) || leafIndex < 0 || leafIndex >= this.nextIndex) {
      throw new Error(`Leaf index ${leafIndex} is out of range for tree size ${this.nextIndex}`);
    }
    if (this.trackedLeaves.length < this.nextIndex) {
      throw new Error(
        'Cannot generate Merkle proof from checkpoint-only tree state; tracked leaves are unavailable.'
      );
    }

    const pathElements: Buffer[] = [];
    const pathIndices: number[] = [];
    const memo = new Map<string, Buffer>();

    let index = leafIndex;
    for (let level = 0; level < this.depth; level += 1) {
      const siblingIndex = index ^ 1;
      pathElements.push(this.nodeAt(level, siblingIndex, memo));
      pathIndices.push(index & 1);
      index >>= 1;
    }

    return {
      root: this.getRoot(),
      pathElements,
      pathIndices,
      leafIndex
    };
  }

  createCheckpoint(options: { includeLeaves?: boolean } = {}): MerkleCheckpoint {
    return {
      version: 1,
      depth: this.depth,
      nextIndex: this.nextIndex,
      root: this.root.toString('hex'),
      frontier: this.frontier.map((entry) => (entry ? entry.toString('hex') : null)),
      leaves: options.includeLeaves ? this.trackedLeaves.map((leaf) => leaf.toString('hex')) : undefined
    };
  }

  private hashPair(left: Buffer, right: Buffer): Buffer {
    return stableHash32('merkle-node', left, right);
  }

  private buildZeroes(depth: number): Buffer[] {
    const zeroes: Buffer[] = [Buffer.alloc(32, 0)];
    for (let i = 0; i < depth; i += 1) {
      zeroes.push(this.hashPair(zeroes[i], zeroes[i]));
    }
    return zeroes;
  }

  private nodeAt(level: number, index: number, memo: Map<string, Buffer>): Buffer {
    const key = `${level}:${index}`;
    const existing = memo.get(key);
    if (existing) {
      return existing;
    }

    const span = 2 ** level;
    const startLeaf = index * span;

    if (startLeaf >= this.trackedLeaves.length) {
      return this.zeroes[level];
    }

    if (level === 0) {
      return this.trackedLeaves[index] ?? this.zeroes[0];
    }

    const left = this.nodeAt(level - 1, index * 2, memo);
    const right = this.nodeAt(level - 1, index * 2 + 1, memo);
    const node = this.hashPair(left, right);
    memo.set(key, node);
    return node;
  }
}

export function syncCommitmentBatch(
  tree: LocalMerkleTree,
  commitments: CommitmentLike[],
  checkpointOptions: { includeLeaves?: boolean } = {}
): BatchSyncResult {
  const insertedLeafIndices = tree.insertBatch(commitments);
  return {
    insertedLeafIndices,
    checkpoint: tree.createCheckpoint(checkpointOptions),
    root: tree.getRoot()
  };
}
