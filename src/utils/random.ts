const hash = (x: number) => {
  x |= 0; // force 32-bit int
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;

  return (x >>> 0) / 0xffffffff;
};

export const rand = (x: number, min = 0, max = 1) => {
  return min + hash(x) * (max - min);
};
