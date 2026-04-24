import fs from 'fs';
import path from 'path';
import { Note } from '../src/note';
import { MerkleProof, ProofGenerator, VerifyingBackend } from '../src/proof';
import { generateWithdrawalProof, verifyWithdrawalProof, extractPublicInputs } from '../src/withdraw';

class MockVerifyingBackend implements VerifyingBackend {
  async verifyProof(proof: Uint8Array, publicInputs: string[], artifacts: any): Promise<boolean> {
    // Basic mock logic: 
    // - Valid if proof[0] is 0xab
    // - Invalid if publicInputs contain 'TAMPERED'
    if (proof[0] !== 0xab) return false;
    if (publicInputs.some(input => input === 'TAMPERED')) return false;
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
    const backend = new MockVerifyingBackend();
    
    // Create a dummy proof that matches our mock's "valid" criteria
    const proof = new Uint8Array(64).fill(0xab);
    
    // Prepare dummy public inputs
    const publicInputs = [
      '0xroot',
      '0xnullifier',
      '0xrecipient',
      '100',
      '0xrelayer',
      '0'
    ];

    const isValid = await verifyWithdrawalProof(proof, publicInputs, withdrawArtifact, backend);
    expect(isValid).toBe(true);
  });

  it('should fail verification for tampered proof bytes', async () => {
    const backend = new MockVerifyingBackend();
    
    // Tampered proof (wrong first byte)
    const proof = new Uint8Array(64).fill(0xff);
    
    const publicInputs = ['0xroot', '0xnullifier', '0xrecipient', '100', '0xrelayer', '0'];

    const isValid = await verifyWithdrawalProof(proof, publicInputs, withdrawArtifact, backend);
    expect(isValid).toBe(false);
  });

  it('should fail verification for tampered public inputs', async () => {
    const backend = new MockVerifyingBackend();
    
    const proof = new Uint8Array(64).fill(0xab);
    
    // Tampered public inputs
    const publicInputs = ['TAMPERED', '0xnullifier', '0xrecipient', '100', '0xrelayer', '0'];

    const isValid = await verifyWithdrawalProof(proof, publicInputs, withdrawArtifact, backend);
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
      pathElements: [Buffer.from('04'.repeat(32), 'hex')],
      pathIndices: [0],
      leafIndex: 0
    };

    const witness = await ProofGenerator.prepareWitness(note, merkleProof, '0xrec');
    const publicInputs = extractPublicInputs(witness);
    
    expect(publicInputs).toHaveLength(6);
    expect(publicInputs[0]).toBe(witness.root);
    expect(publicInputs[2]).toBe(witness.recipient);
  });
});
