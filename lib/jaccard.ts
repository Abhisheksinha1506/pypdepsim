export type JaccardResult = {
  score: number;
  shared: number;
  unionSize: number;
};

// Optimized Jaccard similarity for large sets using sorted arrays and two-pointer technique
// For sets > 100 items, this is faster (O(n log n) vs O(n*m) for Set approach)
function jaccardSimilarityOptimized(a: Set<string>, b: Set<string>): JaccardResult {
  const arrA = Array.from(a).sort();
  const arrB = Array.from(b).sort();
  
  let shared = 0;
  let i = 0;
  let j = 0;
  
  while (i < arrA.length && j < arrB.length) {
    if (arrA[i] === arrB[j]) {
      shared += 1;
      i += 1;
      j += 1;
    } else if (arrA[i] < arrB[j]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  
  const unionSize = arrA.length + arrB.length - shared;
  const score = unionSize > 0 ? shared / unionSize : 0;
  return { score, shared, unionSize };
}

// Standard Jaccard similarity using Set operations (faster for small sets)
function jaccardSimilarityStandard(a: Set<string>, b: Set<string>): JaccardResult {
  let shared = 0;
  a.forEach(function (x) {
    if (b.has(x)) shared += 1;
  });
  const unionSize = a.size + b.size - shared;
  const score = unionSize > 0 ? shared / unionSize : 0;
  return { score, shared, unionSize };
}

// Main Jaccard similarity function - automatically chooses optimal algorithm
export function jaccardSimilarity(a: Set<string>, b: Set<string>): JaccardResult {
  // For small sets (< 100), Set operations are faster
  // For large sets (>= 100), sorted arrays with two-pointer is faster
  const THRESHOLD = 100;
  if (a.size < THRESHOLD && b.size < THRESHOLD) {
    return jaccardSimilarityStandard(a, b);
  }
  return jaccardSimilarityOptimized(a, b);
}


