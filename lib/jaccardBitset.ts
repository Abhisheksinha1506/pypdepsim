export function jaccardBitset(a: Uint32Array, b: Uint32Array): number {
  if (!a || !b || a.length === 0 || b.length === 0) return 0;
  let i = 0;
  let j = 0;
  let inter = 0;
  while (i < a.length && j < b.length) {
    const va = a[i];
    const vb = b[j];
    if (va === vb) {
      inter += 1;
      i += 1;
      j += 1;
    } else if (va < vb) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return inter / (a.length + b.length - inter);
}

export function intersectCount(a: Uint32Array, b: Uint32Array): number {
  if (!a || !b || a.length === 0 || b.length === 0) return 0;
  let i = 0;
  let j = 0;
  let count = 0;
  while (i < a.length && j < b.length) {
    const va = a[i];
    const vb = b[j];
    if (va === vb) {
      count += 1;
      i += 1;
      j += 1;
    } else if (va < vb) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return count;
}


