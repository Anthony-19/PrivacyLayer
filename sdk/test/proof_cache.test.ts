import { Note } from '../src/note';
import { InMemoryProofCache, MerkleProof, ProofGenerator, ProvingBackend } from '../src/proof';
import { buildWithdrawalProofCacheKey, generateWithdrawalProof, WithdrawalRequest } from '../src/withdraw';
import { stableHash32 } from '../src/stable';

class CountingBackend implements ProvingBackend {
  public calls = 0;

  async generateProof(witness: any): Promise<Uint8Array> {
    this.calls += 1;
    const digest = stableHash32('proof', JSON.stringify(witness));
    const proof = new Uint8Array(64);
    proof.set(digest, 0);
    proof.set(digest, 32);
    return proof;
  }
}

function makeRequest(overrides: Partial<WithdrawalRequest> = {}): WithdrawalRequest {
  const note = new Note(
    Buffer.from('01'.repeat(31), 'hex'),
    Buffer.from('02'.repeat(31), 'hex'),
    '03'.repeat(32),
    1000n
  );

  const merkleProof: MerkleProof = {
    root: Buffer.from('04'.repeat(32), 'hex'),
    pathElements: Array.from({ length: 20 }, (_, i) => Buffer.from((5 + i).toString(16).padStart(2, '0').repeat(32), 'hex')),
    pathIndices: Array.from({ length: 20 }, () => 0),
    leafIndex: 0
  };

  return {
    note,
    merkleProof,
    recipient: '0xrecipient',
    relayer: '0xrelayer',
    fee: 0n,
    ...overrides
  };
}

describe('Withdrawal proof cache', () => {
  it('reuses proof for repeated canonical inputs (cache hit)', async () => {
    const backend = new CountingBackend();
    const cache = new InMemoryProofCache();
    const request = makeRequest();

    const first = await generateWithdrawalProof(request, backend, { cache });
    const second = await generateWithdrawalProof(request, backend, { cache });

    expect(backend.calls).toBe(1);
    expect(first.equals(second)).toBe(true);
  });

  it('misses cache when no cache adapter is provided', async () => {
    const backend = new CountingBackend();
    const request = makeRequest();

    await generateWithdrawalProof(request, backend);
    await generateWithdrawalProof(request, backend);

    expect(backend.calls).toBe(2);
  });

  it('invalidates cached proof when public inputs change', async () => {
    const backend = new CountingBackend();
    const cache = new InMemoryProofCache();

    const firstRequest = makeRequest({ recipient: '0xalice' });
    const secondRequest = makeRequest({ recipient: '0xbob' });

    const witnessA = await ProofGenerator.prepareWitness(
      firstRequest.note,
      firstRequest.merkleProof,
      firstRequest.recipient,
      firstRequest.relayer,
      firstRequest.fee
    );
    const witnessB = await ProofGenerator.prepareWitness(
      secondRequest.note,
      secondRequest.merkleProof,
      secondRequest.recipient,
      secondRequest.relayer,
      secondRequest.fee
    );

    const keyA = buildWithdrawalProofCacheKey(firstRequest, witnessA);
    const keyB = buildWithdrawalProofCacheKey(secondRequest, witnessB);

    expect(keyA).not.toBe(keyB);

    await generateWithdrawalProof(firstRequest, backend, { cache });
    await generateWithdrawalProof(secondRequest, backend, { cache });

    expect(backend.calls).toBe(2);
  });
});
