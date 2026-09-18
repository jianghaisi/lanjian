// Explicit live ports preserve the existing book/request scope and draft ownership.
export function createReviewFormattingActions(ports) {
  function findingConfidenceLabel(value) {
    return Number.isFinite(value) ? `${Math.round(Number(value) * 100)}%` : '未估算'
  }

  return { findingConfidenceLabel }
}
