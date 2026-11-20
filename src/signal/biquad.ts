/**
 * Second-order IIR biquads (RBJ audio-EQ cookbook formulas).
 *
 * Direct Form I with persistent state so that streaming across batch boundaries
 * introduces no discontinuity. Coefficients are always derived from the sample
 * rate actually reported by the source — never hard-coded.
 */
export class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;

  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  setNormalized(
    b: [number, number, number],
    a: [number, number, number],
  ): void {
    const a0 = a[0] || 1;
    this.b0 = b[0] / a0;
    this.b1 = b[1] / a0;
    this.b2 = b[2] / a0;
    this.a1 = a[1] / a0;
    this.a2 = a[2] / a0;
  }

  process(x: number): number {
    // A non-finite input would poison the recursive state forever.
    if (!Number.isFinite(x)) x = 0;
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }

  reset(): void {
    this.x1 = 0;
    this.x2 = 0;
    this.y1 = 0;
    this.y2 = 0;
  }
}

const nyquistGuard = (fs: number, f0: number) => Math.min(f0, fs * 0.49);

export function designLowpass(fs: number, f0: number, q = Math.SQRT1_2): Biquad {
  const f = nyquistGuard(fs, f0);
  const w0 = (2 * Math.PI * f) / fs;
  const cosw = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const b: [number, number, number] = [(1 - cosw) / 2, 1 - cosw, (1 - cosw) / 2];
  const a: [number, number, number] = [1 + alpha, -2 * cosw, 1 - alpha];
  const bq = new Biquad();
  bq.setNormalized(b, a);
  return bq;
}

export function designHighpass(fs: number, f0: number, q = Math.SQRT1_2): Biquad {
  const f = nyquistGuard(fs, f0);
  const w0 = (2 * Math.PI * f) / fs;
  const cosw = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const b: [number, number, number] = [(1 + cosw) / 2, -(1 + cosw), (1 + cosw) / 2];
  const a: [number, number, number] = [1 + alpha, -2 * cosw, 1 - alpha];
  const bq = new Biquad();
  bq.setNormalized(b, a);
  return bq;
}

export function designNotch(fs: number, f0: number, q = 30): Biquad {
  const f = nyquistGuard(fs, f0);
  const w0 = (2 * Math.PI * f) / fs;
  const cosw = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const b: [number, number, number] = [1, -2 * cosw, 1];
  const a: [number, number, number] = [1 + alpha, -2 * cosw, 1 - alpha];
  const bq = new Biquad();
  bq.setNormalized(b, a);
  return bq;
}
