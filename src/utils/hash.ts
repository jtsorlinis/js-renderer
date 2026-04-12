import { Vector3 } from "../maths";

const hash = (x: number) => {
  x |= 0; // force 32-bit int
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;

  return (x >>> 0) / 0xffffffff;
};

const hashRange = (x: number, min = 0, max = 1) => {
  return min + hash(x) * (max - min);
};

export const hash3 = (x: number, min = 0, max = 1) => {
  return new Vector3(
    hashRange(x, min, max),
    hashRange(x + 1, min, max),
    hashRange(x + 2, min, max),
  );
};
