import { Note } from './note';

export interface DepositRequest {
  poolId: string;
  amount: bigint;
  note?: Note;
}

export interface DepositPayload {
  note: Note;
  poolId: string;
  amount: bigint;
  commitment: Buffer;
}

/**
 * Creates deposit payload data from either a supplied note or a new note.
 */
export function createDeposit(request: DepositRequest): DepositPayload {
  const note = request.note ?? Note.generate(request.poolId, request.amount);

  return {
    note,
    poolId: note.poolId,
    amount: note.amount,
    commitment: note.getCommitment()
  };
}

export function createBatchCommitments(notes: Note[]): Buffer[] {
  return notes.map((note) => note.getCommitment());
}
