/**
 * Fixed-capacity circular buffer for ECG samples.
 *
 * Memory is bounded for arbitrarily long sessions: capacity never grows, writes
 * wrap, and consumers read only the window they need. Indices are "absolute"
 * (total samples ever written), which keeps beat positions stable across wraps.
 */
export class SampleRing {
  readonly capacity: number;
  private values: Float32Array;
  private leadOff: Uint8Array;
  private writeIndex = 0;
  private written = 0;

  constructor(capacity: number) {
    this.capacity = Math.max(1, Math.floor(capacity));
    this.values = new Float32Array(this.capacity);
    this.leadOff = new Uint8Array(this.capacity);
  }

  get size(): number {
    return this.written;
  }

  /** Absolute index of the newest sample, or -1 when empty. */
  get lastIndex(): number {
    return this.written - 1;
  }

  get oldestIndex(): number {
    return Math.max(0, this.written - this.capacity);
  }

  clear(): void {
    this.writeIndex = 0;
    this.written = 0;
    this.values.fill(0);
    this.leadOff.fill(0);
  }

  push(value: number, leadOff = 0): number {
    const idx = this.writeIndex;
    this.values[idx] = Number.isFinite(value) ? value : 0;
    this.leadOff[idx] = leadOff ? 1 : 0;
    this.writeIndex = (idx + 1) % this.capacity;
    this.written += 1;
    return this.written - 1;
  }

  pushMany(values: ArrayLike<number>, leadOff = 0): void {
    for (let i = 0; i < values.length; i += 1) {
      this.push(values[i] ?? 0, leadOff);
    }
  }

  /** Value at an absolute index, or NaN when it has aged out. */
  at(absIndex: number): number {
    if (absIndex < this.oldestIndex || absIndex > this.lastIndex) return Number.NaN;
    return this.values[absIndex % this.capacity];
  }

  isLeadOff(absIndex: number): boolean {
    if (absIndex < this.oldestIndex || absIndex > this.lastIndex) return false;
    return this.leadOff[absIndex % this.capacity] === 1;
  }

  /**
   * Fill `out` with the newest `out.length` samples (oldest first) and return
   * how many were actually available.
   */
  copyLast(out: Float32Array): number {
    const n = Math.min(out.length, this.size, this.capacity);
    const start = this.written - n;
    for (let i = 0; i < n; i += 1) {
      out[i] = this.values[(start + i) % this.capacity];
    }
    return n;
  }

  /** Min/max over an absolute index range, ignoring aged-out samples. */
  range(fromAbs: number, toAbs: number): { min: number; max: number } {
    const from = Math.max(fromAbs, this.oldestIndex);
    const to = Math.min(toAbs, this.lastIndex);
    if (from > to) return { min: 0, max: 0 };
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let i = from; i <= to; i += 1) {
      const v = this.values[i % this.capacity];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return { min, max };
  }
}
