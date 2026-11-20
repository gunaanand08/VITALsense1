# DATA STORAGE AND REPORTS — CARDIOPULSE

## 1. Principles

- **Local only.** IndexedDB in the operator's browser; no server persistence, no upload, no account.
- **Raw fidelity.** Stored samples are the raw ADC values. Filtered values, beat markers and RR
  intervals are re-derived deterministically at export/replay time.
- **Bounded memory.** Recordings are written in fixed 5000-sample chunks during capture.
- **Visible failure.** Quota errors stop the recording and surface a toast; existing sessions are
  never touched.

## 2. Database

`IndexedDB` database `cardiopulse`, version 1 (`src/storage/db.ts`, typed with `idb`).

### `sessions` (key: `id`)

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | UUID (`crypto.randomUUID`, fallback timestamp+random) |
| `startedAt` / `endedAt` | epoch ms | Wall-clock capture window |
| `durationMs` | number | `endedAt − startedAt` |
| `source` | `simulation` \| `hardware` | Provenance, always displayed |
| `deviceId` | string \| null | Device that produced the samples |
| `sampleRateHz` | number | Reported rate at capture time |
| `sampleCount` | number | Total stored samples |
| `avgBpm` / `minBpm` / `maxBpm` | number \| null | From valid NN intervals only |
| `sdnnMs` / `rmssdMs` | number \| null | `null` when < 10 valid intervals |
| `nnCount` | number | Valid intervals used |
| `meanQuality` / `minQuality` | number \| null | Technical quality score |
| `notes` | string | Operator free text (included in reports) |
| `chunkCount` | number | Number of sample chunks |
| `corrupt` | boolean? | Set on read when validation fails |

### `chunks` (key: `[sessionId, index]`, index `bySession`)

| Field | Type | Meaning |
| --- | --- | --- |
| `sessionId`, `index` | string, number | Composite key |
| `startIndex` | number | Absolute sample index of the chunk's first sample |
| `sampleRateHz` | number | Denormalised for standalone reads |
| `samples` | `Int16Array` | Raw ADC counts |
| `leadOff` | `Uint8Array` | 1 where either electrode was off |

Sizing: 500 Hz × 60 s = 30 000 samples = 60 kB raw + 30 kB lead-off ≈ 90 kB per minute.

## 3. Write path

1. `engine.startRecording()` resets chunk buffers and the session accumulator.
2. Every ingested sample is appended to the current chunk (`Int16Array` + `Uint8Array`).
3. At 5000 samples the chunk is sliced and pushed to the in-memory list (no IndexedDB traffic during
   capture, so a slow disk cannot stall the signal path).
4. `engine.stopRecording()` flushes the partial chunk, aggregates HR/HRV/quality, and returns a
   `RecordingResult`.
5. The store writes the session metadata and all chunks in **one transaction**.

An empty recording (0 samples) is discarded with a warning rather than storing a meaningless row.

## 4. Read path and integrity

- `listSessions()` validates required fields; invalid rows are returned flagged `corrupt`, shown with
  a warning badge, excluded from exports, and still deletable.
- `getSessionChunks()` reads by the `bySession` index and sorts by `index`; `analyzeSamples()`
  re-derives the filtered trace and beats from the concatenated raw samples.
- Duplicate identifiers are impossible (`crypto.randomUUID`), and a failed write rolls back with its
  transaction.
- Deletion removes all chunks and the metadata in one transaction, after a confirmation dialog.

## 5. CSV export

`buildCsv()` produces full-fidelity output — **one row per stored sample**, no decimation.

```
# CARDIOPULSE session export
# session_id,<uuid>
# started_at,2026-01-02T10:30:00.000Z
# ended_at,…
# source,simulation|hardware
# device_id,…
# sample_rate_hz,500
# sample_count,30000
# columns,index=…,time_ms=…,raw_adc=…,filtered=…,beat=1 at detected R-peak,rr_ms=…,lead_off=…
# notes,"…"
# educational prototype - not a medical device
index,time_ms,raw_adc,filtered,beat,rr_ms,lead_off
0,0.00,2048,0.000,,,0
```

- `filtered` = output of the live chain (0.5 Hz HP → 40 Hz LP → 50 Hz notch) applied offline. The
  first ~0.5 s of every recording contains the filters' settling transient — real, unfiltered data,
  not an export bug. Plots scale to the 99th percentile of |amplitude| so that transient cannot
  flatten the rest of the trace.
- `beat` = `1` at a refined R-peak index; `rr_ms` is the interval ending at that beat.
- `lead_off` = 1 where either electrode was disconnected.
- Notes and identifiers are CSV-escaped (quotes doubled).

## 6. PDF export

`buildPdf()` (jsPDF, A4, vector output — not a screenshot):

1. Header band with CARDIOPULSE, tagline, "Educational prototype — not a medical device", session id.
2. Session identification: recorded/ended, duration, source, device, sample rate, samples, chunks.
3. Heart rate and variability table: avg/min/max BPM, SDNN, RMSSD, valid NN, beats, mean quality.
   Missing metrics print as `insufficient intervals`, never as a number.
4. ECG waveform: min/max-decimated vector plot of the filtered signal with R-peak ticks along the top.
5. Signal quality and electrodes: explains that quality is technical, plus LO+/LO− state (or
   "not recorded" when unavailable).
6. Operator notes, if present.
7. Footer disclaimer: educational use only, single-lead limitations, no treatment decisions.

## 7. Storage lifecycle

- The Settings page shows `navigator.storage.estimate()` usage/quota.
- There is no automatic eviction or cloud backup: clearing site data destroys recordings.
- Deleting a session is immediate and irreversible, which is why it is confirmed first.
