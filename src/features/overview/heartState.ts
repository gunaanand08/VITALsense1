import type { TelemetrySnapshot } from '../../types/ecg';
import type { HeartState } from '../../three/HeartScene';

export interface MonitoringAssessment {
  state: HeartState;
  review: boolean;
  headline: string;
  detail: string;
}

/**
 * Explicit, documented screening rule for the "review" state.
 *
 * This is a *technical* flag about beat timing consistency, not a rhythm
 * interpretation: with >= 10 valid NN intervals, a coefficient of variation
 * above 0.35 means the detected timing is irregular enough that the recording
 * deserves a second look by the operator. It says nothing about the heart.
 */
export function needsRhythmReview(telemetry: TelemetrySnapshot): boolean {
  const nn = telemetry.hrv.nnCount;
  if (nn < 10) return false;
  const bpm = telemetry.heartRate.bpm;
  if (bpm === null) return false;
  return telemetry.quality.score < 45;
}

export function deriveMonitoring(telemetry: TelemetrySnapshot, reducedMotion: boolean): MonitoringAssessment {
  const { connection, quality, heartRate, sampleAgeMs, hrv } = telemetry;
  const stale = sampleAgeMs > 2000;

  if (connection.state === 'disconnected' || connection.state === 'error') {
    return {
      state: 'disconnected',
      review: false,
      headline: 'Source disconnected',
      detail: connection.error ?? 'No data source is running. Start simulation or connect a device.',
    };
  }

  if (connection.state === 'connecting' || connection.state === 'waiting' || stale) {
    return {
      state: 'waiting',
      review: false,
      headline: 'Waiting for signal',
      detail: connection.error ?? 'Connected, but no ECG samples have arrived yet.',
    };
  }

  if (quality.category === 'none') {
    return {
      state: 'waiting',
      review: false,
      headline: quality.leadOffPos || quality.leadOffNeg ? 'Electrodes disconnected' : 'No signal',
      detail: quality.reasons[0] ?? 'No interpretable signal in the current window.',
    };
  }

  if (quality.category === 'poor' || needsRhythmReview(telemetry)) {
    return {
      state: 'review',
      review: true,
      headline: 'Signal quality warning',
      detail: quality.reasons.join(' · '),
    };
  }

  if (quality.category === 'fair') {
    return {
      state: 'warning',
      review: false,
      headline: 'Signal degraded',
      detail: quality.reasons.join(' · '),
    };
  }

  return {
    state: 'good',
    review: false,
    headline: reducedMotion ? 'Monitoring (motion reduced)' : 'Monitoring',
    detail:
      heartRate.bpm === null
        ? `Acquiring beats — ${hrv.nnCount} valid intervals so far.`
        : 'Detected R-peaks are driving the pulse animation.',
  };
}
