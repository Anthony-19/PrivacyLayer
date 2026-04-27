import { Note } from "../src/note";
import { ProofGenerator } from "../src/proof";
import {
  LocalMerkleTree,
  PRODUCTION_MERKLE_TREE_DEPTH,
  generateMerkleFixtureVectors,
} from "../src/merkle";
import { generateWithdrawalProof } from "../src/withdraw";
import { WitnessValidationError } from "../src/errors";
import { GROTH16_PROOF_BYTE_LENGTH } from "../src/witness";

const RECIPIENT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const POOL_ID = "01".repeat(32);

function buildNote(index: number): Note {
  return Note.deriveDeterministic(
    `fixture-${index}`,
    POOL_ID,
    1_000_000_000n, // DEFAULT_DENOMINATION
  );
}

describe("Offline merkle depth support", () => {
  it("can generate deterministic fixture vectors for miniature and production depths", () => {
    const mini = generateMerkleFixtureVectors({
      depth: 4,
      leafCount: 6,
      proveLeafIndices: [0, 3],
    });
    const prod = generateMerkleFixtureVectors({
      depth: PRODUCTION_MERKLE_TREE_DEPTH,
      leafCount: 4,
      proveLeafIndices: [1],
    });

    expect(mini).toHaveLength(2);
    expect(mini[0]?.depth).toBe(4);
    expect(mini[0]?.pathElementsHex).toHaveLength(4);

    expect(prod).toHaveLength(1);
    expect(prod[0]?.depth).toBe(PRODUCTION_MERKLE_TREE_DEPTH);
    expect(prod[0]?.pathElementsHex).toHaveLength(PRODUCTION_MERKLE_TREE_DEPTH);
  });

  it("requires explicit merkleDepth opt-in for miniature trees in witness preparation", async () => {
    const depth = 4;
    const tree = new LocalMerkleTree(depth);
    const note = buildNote(0);
    const leaf = note.getCommitment();
    const leafIndex = tree.insert(leaf);
    const proof = tree.generateProof(leafIndex);

    await expect(
      ProofGenerator.prepareWitness(note, proof, RECIPIENT),
    ).rejects.toThrow(WitnessValidationError);

    const witness = await ProofGenerator.prepareWitness(
      note,
      proof,
      RECIPIENT,
      undefined,
      0n,
      {
        merkleDepth: depth,
        denomination: note.amount,
      },
    );
    expect(witness.hash_path).toHaveLength(depth);
  });

  it("generates proofs with miniature tree only when offline merkleDepth is provided", async () => {
    const depth = 4;
    const tree = new LocalMerkleTree(depth);
    const note = buildNote(1);
    const leafIndex = tree.insert(note.getCommitment());
    const proof = tree.generateProof(leafIndex);

    const backend = {
      async generateProof() {
        return new Uint8Array(GROTH16_PROOF_BYTE_LENGTH);
      },
    };

    await expect(
      generateWithdrawalProof(
        { note, merkleProof: proof, recipient: RECIPIENT },
        backend,
      ),
    ).rejects.toThrow(WitnessValidationError);

    await expect(
      generateWithdrawalProof(
        { note, merkleProof: proof, recipient: RECIPIENT },
        backend,
        { merkleDepth: depth, denomination: note.amount },
      ),
    ).resolves.toBeInstanceOf(Buffer);
  });
});
