import fs from 'fs';
import path from 'path';
import { Note } from '../src/note';
import { MerkleProof, ProofGenerator, VerifyingBackend } from '../src/proof';
import { verifyWithdrawalProof, extractPublicInputs } from '../src/withdraw';

class MockVerifyingBackend implements VerifyingBackend {
  constructor(private readonly expectedPublicInputs: string[]) {}

  async verifyProof(proof: Uint8Array, publicInputs: string[], artifacts: any): Promise<boolean> {
    if (proof[0] !== 0xab) return false;
    if (publicInputs.length !== this.expectedPublicInputs.length) return false;
    for (let i = 0; i < publicInputs.length; i++) {
      if (publicInputs[i] !== this.expectedPublicInputs[i]) return false;
    }
    return true;
  }
}

describe('Verification Harness', () => {
  const artifactsDir = path.resolve(__dirname, '../../artifacts/zk');
  const manifestPath = path.join(artifactsDir, 'manifest.json');
  
  let manifest: any;
  let withdrawArtifact: any;

  beforeAll(() => {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const artifactPath = path.join(artifactsDir, manifest.circuits.withdraw.path);
    withdrawArtifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  });

  it('should verify a valid proof successfully', async () => {
    const proof = new Uint8Array(64).fill(0xab);
    const publicInputs = ['pool', 'root', 'nullifier_hash', 'recipient', '100', 'relayer', '0'];
    const backend = new MockVerifyingBackend(publicInputs);
    const isValid = await verifyWithdrawalProof(proof, publicInputs, withdrawArtifact, backend);
    expect(isValid).toBe(true);
  });

  it('should fail verification for tampered proof bytes', async () => {
    const publicInputs = ['pool', 'root', 'nullifier_hash', 'recipient', '100', 'relayer', '0'];
    const backend = new MockVerifyingBackend(publicInputs);
    const proof = new Uint8Array(64).fill(0xff);
    const isValid = await verifyWithdrawalProof(proof, publicInputs, withdrawArtifact, backend);
    expect(isValid).toBe(false);
  });

  it.each([
    ['pool_id', 0],
    ['root', 1],
    ['nullifier_hash', 2],
    ['recipient', 3],
    ['amount', 4],
    ['relayer', 5],
    ['fee', 6],
  ])('should fail verification when %s is tampered', async (_label: string, idx: number) => {
    const proof = new Uint8Array(64).fill(0xab);
    const good = ['pool', 'root', 'nullifier_hash', 'recipient', '100', 'relayer', '0'];
    const backend = new MockVerifyingBackend(good);
    const tampered = good.slice();
    tampered[idx] = tampered[idx] + '_tampered';
    const isValid = await verifyWithdrawalProof(proof, tampered, withdrawArtifact, backend);
    expect(isValid).toBe(false);
  });

  it('should integrate generate and verify flow with extraction', async () => {
    // This test ensures that extractPublicInputs works with ProofGenerator.prepareWitness
    const note = new Note(
      Buffer.from('01'.repeat(31), 'hex'),
      Buffer.from('02'.repeat(31), 'hex'),
      '03'.repeat(32),
      1000n
    );
    
    const merkleProof: MerkleProof = {
      root: Buffer.from('03'.repeat(32), 'hex'),
      pathElements: Array.from({ length: 20 }, () => Buffer.from('04'.repeat(32), 'hex')),
      leafIndex: 0
    };

    const witness = await ProofGenerator.prepareWitness(
      note,
      merkleProof,
      'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'
    );
    const publicInputs = extractPublicInputs(witness);
    
    expect(publicInputs).toHaveLength(7);
    expect(publicInputs[0]).toBe(witness.pool_id);
    expect(publicInputs[1]).toBe(witness.root);
    expect(publicInputs[3]).toBe(witness.recipient);
  });
});
