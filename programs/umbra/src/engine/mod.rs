pub mod amm;
pub mod fixed_point;
pub mod sqrt;
pub mod normal_pdf;

pub use amm::*;
pub use fixed_point::*;
pub use sqrt::*;
pub use normal_pdf::*;

// ─────────────────────────────────────────────────────────────────────
// This module contains pure math functions with no Anchor dependencies.
// All functions operate on primitive types and return Result<T> using
// the UmbraError type for consistency.
//
// Implementation is deferred to the corresponding task:
//   P-2: fixed_point.rs, sqrt.rs
//   P-3: normal_pdf.rs
//   P-5/P-6: amm.rs
// ─────────────────────────────────────────────────────────────────────
