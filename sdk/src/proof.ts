import { Note } from './note';

export interface MerkleProof {
  root: Buffer;
  pathElements: Buffer[];
  pathIndices: number[];
  leafIndex: number;
}

export interface Groth16Proof {
  proof: Uint8Array;
  publicInputs: string[];
}

/**
 * ProvingBackend
 * 
 * Abstraction for the proof generation engine (e.g., Barretenberg).
 * This allows the SDK to remain agnostic of the runtime (Node.js vs Browser).
 */
export interface ProvingBackend {
  /**
   * Generates a proof for the given witness.
   * @param witness The circuit-friendly witness inputs.
   * @returns The generated proof as a Uint8Array.
   */
  generateProof(witness: any): Promise<Uint8Array>;
}

/**
 * VerifyingBackend
 * 
 * Abstraction for the proof verification engine.
 */
export interface VerifyingBackend {
  /**
   * Verifies a proof against public inputs and circuit artifacts.
   * @param proof The generated proof bytes.
   * @param publicInputs The public inputs for the circuit.
   * @param artifacts The circuit artifacts (vkey, acir, etc).
   * @returns A boolean indicating if the proof is valid.
   */
  verifyProof(proof: Uint8Array, publicInputs: string[], artifacts: any): Promise<boolean>;
}

/**
 * ProofGenerator
 * 
 * Logic to orchestrate Noir proof generation for withdrawals.
 * This class prepares the circuit witnesses and interacts with a ProvingBackend.
 */
export class ProofGenerator {
  private backend?: ProvingBackend;

  constructor(backend?: ProvingBackend) {
    this.backend = backend;
  }

  /**
   * Sets or updates the proving backend.
   */
  setBackend(backend: ProvingBackend) {
    this.backend = backend;
  }

  /**
   * Generates a proof using the configured backend.
   */
  async generate(witness: any): Promise<Uint8Array> {
    if (!this.backend) {
      throw new Error('Proving backend not configured. Please provide a backend to the ProofGenerator.');
    }
    return this.backend.generateProof(witness);
  }

  /**
   * Prepares the witness inputs for the Noir withdrawal circuit.
   */
  static async prepareWitness(
    note: Note,
    merkleProof: MerkleProof,
    recipient: string,
    relayer: string = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', // Zero address
    fee: bigint = 0n
  ) {
    return {
      root: merkleProof.root.toString('hex'),
      nullifier_hash: '...', // Hash(nullifier) - ideally this should be computed correctly
      recipient: recipient,
      relayer: relayer,
      fee: fee.toString(),
      nullifier: note.nullifier.toString('hex'),
      secret: note.secret.toString('hex'),
      path_elements: merkleProof.pathElements.map(e => e.toString('hex')),
      path_indices: merkleProof.pathIndices.map(i => i.toString())
    };
  }

  /**
   * Formats a raw proof from Noir/Barretenberg into the format 
   * expected by the Soroban contract.
   */
  static formatProof(rawProof: Uint8Array): Buffer {
    // Soroban contract expects Proof struct: { a: BytesN<64>, b: BytesN<128>, c: BytesN<64> }
    return Buffer.from(rawProof);
  }
}
