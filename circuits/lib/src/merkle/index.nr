use crate::merkle::config;

/// Validates that the leaf index is within the valid range for the Merkle tree.
///
/// The tree has TREE_DEPTH = 20, so valid indices are [0, 2^20 - 1].
/// This ensures oversized field values cannot masquerade as valid Merkle positions.
///
/// # Arguments
/// - `index` : the leaf position to validate
///
/// # Panics
/// Asserts if index >= 2^TREE_DEPTH
pub fn validate_leaf_index(index: Field) {
    // Maximum valid index: 2^20 - 1 = 1,048,575
    let max_index = (1 << config::TREE_DEPTH) - 1;
    assert(index <= max_index, "leaf index out of range: must be < 2^20");
}

/// Validates that index bit length doesn't exceed tree depth.
/// This is a range-proof style validation using bit decomposition.
pub fn validate_index_bits(index: Field) {
    let index_bits: [bool; 20] = index.to_le_bits();
    // If index fits in 20 bits, all higher bits must be 0.
    // This is implicitly guaranteed by Noir's bit decomposition,
    // but we document the constraint here for clarity.
    let _ = index_bits;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_zero_index() {
        validate_leaf_index(0);
    }

    #[test]
    fn test_valid_max_index() {
        // 2^20 - 1 = 1,048,575
        validate_leaf_index(1_048_575);
    }

    #[test]
    fn test_boundary_valid() {
        // Just before max
        validate_leaf_index(1_048_574);
    }

    #[test(should_fail)]
    fn test_invalid_exceeds_max() {
        // 2^20 = 1,048,576 is out of range
        validate_leaf_index(1_048_576);
    }

    #[test(should_fail)]
    fn test_invalid_large_value() {
        // Much larger than 2^20
        validate_leaf_index(10_000_000);
    }
}
