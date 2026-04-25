use std::hash::pedersen_hash;

/// Compute commitment from nullifier, secret and pool_id.
/// commitment = Hash(nullifier, secret, pool_id)
pub fn compute_commitment(nullifier: Field, secret: Field, pool_id: Field) -> Field {
    pedersen_hash([nullifier, secret, pool_id])
}
