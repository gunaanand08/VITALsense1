import { designHighpass, designLowpass, designNotch, type Biquad } from './biquad';

export interface FilterOptions {
  /** 0 disables the stage. */
  highPassHz: number;
  lowPassHz: number;
  /** 0 disables, 50 or 60 for mains rejection. */
  notchHz: number;
  enabled: boolean;
}

export const DEFAULT_FILTERS: FilterOptions = {
  highPassHz: 0.5,
  lowPassHz: 40,
  notchHz: 50,
  enabled: true,
};

/**
 * Streaming ECG filter chain: baseline high-pass -> low-pass -> mains notch.
 * All state is reset when the sample rate changes so coefficients and history
 * stay consistent.
 */
export class FilterChain {
  private fs = 0;
  private hp: Biquad | null = null;
  private lp: Biquad | null = null;
  private notch: Biquad | null = null;
  private opts: FilterOptions = { ...DEFAULT_FILTERS };

  constructor(sampleRateHz: number, options: FilterOptions = DEFAULT_FILTERS) {
    this.configure(sampleRateHz, options);
  }

  configure(sampleRateHz: number, options: FilterOptions): void {
    const fsChanged = sampleRateHz !== this.fs;
    const optsChanged =
      options.highPassHz !== this.opts.highPassHz ||
      options.lowPassHz !== this.opts.lowPassHz ||
      options.notchHz !== this.opts.notchHz ||
      options.enabled !== this.opts.enabled;

    if (!fsChanged && !optsChanged) return;

    this.fs = sampleRateHz;
    this.opts = { ...options };

    const enabled = options.enabled;
    this.hp = enabled && options.highPassHz > 0 ? designHighpass(sampleRateHz, options.highPassHz) : null;
    this.lp = enabled && options.lowPassHz > 0 && options.lowPassHz < sampleRateHz / 2
      ? designLowpass(sampleRateHz, options.lowPassHz)
      : null;
    this.notch = enabled && options.notchHz > 0 ? designNotch(sampleRateHz, options.notchHz) : null;
  }

  /** Process a single raw sample. Non-finite inputs collapse to 0. */
  process(raw: number): number {
    let y = Number.isFinite(raw) ? raw : 0;
    if (this.hp) y = this.hp.process(y);
    if (this.lp) y = this.lp.process(y);
    if (this.notch) y = this.notch.process(y);
    return y;
  }

  reset(): void {
    this.hp?.reset();
    this.lp?.reset();
    this.notch?.reset();
  }

  get active(): { highPass: boolean; lowPass: boolean; notch: boolean } {
    return { highPass: !!this.hp, lowPass: !!this.lp, notch: !!this.notch };
  }
}
