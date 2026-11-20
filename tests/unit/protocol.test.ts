import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, isHelloMessage, parseBatchMessage } from '../../src/types/protocol';

const valid = {
  type: 'ecg_batch',
  protocol_version: PROTOCOL_VERSION,
  device_id: 'cardiopulse-esp32-01',
  sequence: 12,
  sample_rate_hz: 500,
  timestamp_ms: 240,
  samples: [2048, 2050, 2058, 2071],
  lead_off_positive: false,
  lead_off_negative: false,
};

describe('batch parsing', () => {
  it('normalises a valid frame', () => {
    const batch = parseBatchMessage(valid, 1234);
    expect(batch).not.toBeNull();
    expect(batch?.deviceId).toBe('cardiopulse-esp32-01');
    expect(batch?.seq).toBe(12);
    expect(batch?.samples).toBeInstanceOf(Int16Array);
    expect(Array.from(batch?.samples ?? [])).toEqual([2048, 2050, 2058, 2071]);
    expect(batch?.sourceKind).toBe('hardware');
    expect(batch?.receivedAtMs).toBe(1234);
  });

  it('rejects wrong message types and empty sample arrays', () => {
    expect(parseBatchMessage({ ...valid, type: 'hello' }, 0)).toBeNull();
    expect(parseBatchMessage({ ...valid, samples: [] }, 0)).toBeNull();
  });

  it('rejects out-of-range sample rates', () => {
    expect(parseBatchMessage({ ...valid, sample_rate_hz: 5 }, 0)).toBeNull();
    expect(parseBatchMessage({ ...valid, sample_rate_hz: 9000 }, 0)).toBeNull();
  });

  it('rejects non-finite samples', () => {
    expect(parseBatchMessage({ ...valid, samples: [2048, Number.NaN] }, 0)).toBeNull();
  });

  it('clamps ADC values into the 12-bit range', () => {
    const batch = parseBatchMessage({ ...valid, samples: [-20, 5000] }, 0);
    expect(batch?.samples[0]).toBe(0);
    expect(batch?.samples[1]).toBe(4095);
  });

  it('rejects malformed payloads without throwing', () => {
    expect(parseBatchMessage(null, 0)).toBeNull();
    expect(parseBatchMessage('nope', 0)).toBeNull();
    expect(parseBatchMessage({}, 0)).toBeNull();
    expect(parseBatchMessage({ ...valid, device_id: '' }, 0)).toBeNull();
  });
});

describe('hello parsing', () => {
  it('accepts a well-formed hello', () => {
    expect(
      isHelloMessage({
        type: 'hello',
        protocol_version: 1,
        device_id: 'cardiopulse-esp32-01',
        firmware_version: '1.0.0',
        sample_rate_hz: 500,
        batch_size: 25,
        adc_bits: 12,
        adc_pin: 34,
      }),
    ).toBe(true);
  });

  it('rejects a hello with an unusable sample rate', () => {
    expect(isHelloMessage({ type: 'hello', device_id: 'x', sample_rate_hz: 0 })).toBe(false);
  });
});
