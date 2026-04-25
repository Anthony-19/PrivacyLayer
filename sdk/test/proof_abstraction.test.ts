import { Note } from '../src/note';
import { MerkleProof, ProvingBackend } from '../src/proof';
import { generateWithdrawalProof } from '../src/withdraw';

class MockBackend implements ProvingBackend {
  async generateProof(witness: any): Promise<Uint8Array> {
    // Placeholder: production Groth16 payload is 256 bytes (A || B || C)
    return new Uint8Array(256).fill(0xab);
  }
}

describe('Proving Path Abstraction', () => {
  it('should generate a proof using a mock backend', async () => {
    const backend = new MockBackend();
    
    const note = new Note(
      Buffer.from('01'.repeat(31), 'hex'),
      Buffer.from('02'.repeat(31), 'hex'),
      '03'.repeat(32), // poolId (hex string)
      1000n // amount
    );
    
    const merkleProof: MerkleProof = {
      root: Buffer.from('03'.repeat(32), 'hex'),
      pathElements: Array.from({ length: 20 }, () => Buffer.from('04'.repeat(32), 'hex')),
      leafIndex: 0,
    };
    
    const request = {
      note,
      merkleProof,
      recipient: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      relayer: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      fee: 0n
    };
    
    const proof = await generateWithdrawalProof(request, backend);
    
    expect(proof).toBeDefined();
    expect(proof.length).toBe(256);
    expect(proof[0]).toBe(0xab);
  });

  it('should throw if no backend is provided to ProofGenerator (via direct usage)', async () => {
    const { ProofGenerator } = require('../src/proof');
    const generator = new ProofGenerator();
    await expect(generator.generate({})).rejects.toThrow('Proving backend not configured');
  });
});
