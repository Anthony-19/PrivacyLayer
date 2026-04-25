// ============================================================
// Merkle Tree Library
// ============================================================
// Provides an incremental Merkle tree path verifier for use
// in the withdrawal proof circuit.
//
// The public API remains small while implementation details are
// separated into config, root computation, and verification logic.
// ============================================================

pub mod config;
pub mod index;
pub mod root;
pub mod verify;

/// Tree depth constant - must match the Soroban contract.
pub global TREE_DEPTH: u32 = config::TREE_DEPTH;

/// Compute the Merkle root from a leaf and its authentication path.
///
/// The leaf index is validated to be within [0, 2^20-1] range.
pub fn compute_root(
    leaf: Field,
    index: Field,
    hash_path: [Field; 20],
) -> Field {
    index::validate_leaf_index(index);
    root::compute_root(leaf, index, hash_path)
}

/// Verify that a leaf is included in the Merkle tree with the given root.
///
/// Validates the leaf index before verifying inclusion to prevent
/// out-of-range indices from being accepted.
pub fn verify_inclusion(
    leaf: Field,
    index: Field,
    hash_path: [Field; 20],
    root: Field,
) {
    index::validate_leaf_index(index);
    verify::verify_inclusion(leaf, index, hash_path, root)
}
