import { Note } from './note';
import { MerkleProof, ProofCache, ProofGenerator, ProvingBackend, VerifyingBackend, WithdrawalWitness } from './proof';
import { BatchSyncResult, CommitmentLike, LocalMerkleTree, MerkleCheckpoint, syncCommitmentBatch } from './merkle';
import { stableHash32, stableStringify } from './stable';

/**
 * WithdrawalRequest
 * 
 * Parameters for generating a withdrawal proof.
 */
export interface WithdrawalRequest {
  note: Note;
  merkleProof: MerkleProof;
  recipient: string;
  relayer?: string;
  fee?: bigint;
}

export interface WithdrawalProofGenerationOptions {
  cache?: ProofCache;
  cacheKey?: string;
}

interface WithdrawalCacheMaterial {
  note: {
    nullifier: string;
    secret: string;
    pool: string;
    denomination: string;
  };
  root: string;
  pool: string;
  publicInputs: {
    root: string;
    nullifier_hash: string;
    recipient: string;
    amount: string;
    relayer: string;
    fee: string;
  };
}

function buildCacheMaterial(request: WithdrawalRequest, witness: WithdrawalWitness): WithdrawalCacheMaterial {
  return {
    note: {
      nullifier: witness.nullifier,
      secret: witness.secret,
      pool: request.note.poolId,
      denomination: witness.amount
    },
    root: witness.root,
    pool: request.note.poolId,
    publicInputs: {
      root: witness.root,
      nullifier_hash: witness.nullifier_hash,
      recipient: witness.recipient,
      amount: witness.amount,
      relayer: witness.relayer,
      fee: witness.fee
    }
  };
}

export function buildWithdrawalProofCacheKey(
  request: WithdrawalRequest,
  witness: WithdrawalWitness
): string {
  const material = buildCacheMaterial(request, witness);
  const canonical = stableStringify(material);
  return `withdraw-proof:${stableHash32('withdraw-proof-cache-v1', canonical).toString('hex')}`;
}

/**
 * Transport-agnostic helper for syncing new deposit commitments into a local tree.
 */
export function syncWithdrawalTree(
  tree: LocalMerkleTree,
  commitments: CommitmentLike[],
  checkpointOptions: { includeLeaves?: boolean } = {}
): BatchSyncResult {
  return syncCommitmentBatch(tree, commitments, checkpointOptions);
}

export function restoreWithdrawalTree(checkpoint: MerkleCheckpoint): LocalMerkleTree {
  return LocalMerkleTree.fromCheckpoint(checkpoint);
}

/**
 * generateWithdrawalProof
 * 
 * A stable API for generating a withdrawal proof across environments.
 * It abstracts the proving backend so that the SDK remains environment-agnostic.
 * 
 * @param request The withdrawal parameters.
 * @param backend The proving backend to use (e.g., Node or Browser Barretenberg).
 * @returns The formatted proof as a Buffer.
 */
export async function generateWithdrawalProof(
  request: WithdrawalRequest,
  backend: ProvingBackend,
  options: WithdrawalProofGenerationOptions = {}
): Promise<Buffer> {
  const { note, merkleProof, recipient, relayer, fee } = request;

  // 1. Prepare witness inputs for the circuit
  const witness = await ProofGenerator.prepareWitness(
    note,
    merkleProof,
    recipient,
    relayer,
    fee
  );

  const key = options.cacheKey ?? buildWithdrawalProofCacheKey(request, witness);
  if (options.cache) {
    const cached = await options.cache.get(key);
    if (cached) {
      return Buffer.from(cached);
    }
  }

  // 2. Generate the raw proof using the injected backend
  const proofGenerator = new ProofGenerator(backend);
  const rawProof = await proofGenerator.generate(witness);

  // 3. Format the proof for the Soroban contract
  const proof = ProofGenerator.formatProof(rawProof);
  if (options.cache) {
    await options.cache.set(key, proof);
  }
  return proof;
}

/**
 * extractPublicInputs
 * 
 * Extracts the public inputs from a witness object in the order
 * expected by the circuit and the verifier.
 */
export function extractPublicInputs(witness: WithdrawalWitness): string[] {
  // Ordered according to circuits/withdraw/src/main.nr:
  // 1. pool_id
  // 2. root
  // 3. nullifier_hash
  // 4. recipient
  // 5. amount
  // 6. relayer
  // 7. fee
  return [
    witness.pool_id,
    witness.root,
    witness.nullifier_hash,
    witness.recipient,
    witness.amount,
    witness.relayer,
    witness.fee
  ];
}

/**
 * verifyWithdrawalProof
 * 
 * Verifies a withdrawal proof off-chain using circuit artifacts.
 * 
 * @param proof The proof bytes to verify.
 * @param publicInputs The public inputs used for the proof.
 * @param artifacts The circuit artifacts (vkey, etc).
 * @param backend The verifying backend to use.
 */
export async function verifyWithdrawalProof(
  proof: Uint8Array,
  publicInputs: string[],
  artifacts: any,
  backend: VerifyingBackend
): Promise<boolean> {
  return backend.verifyProof(proof, publicInputs, artifacts);
}
