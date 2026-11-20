# SAFETY AND MEDICAL LIMITATIONS — CARDIOPULSE

## 1. Intended use

CARDIOPULSE is an **educational instrumentation prototype** for teaching and demonstrating portable
single-lead ECG acquisition, signal processing and rhythm-rate analysis. It is intended for:

- engineering and biomedical students learning acquisition and QRS detection;
- project evaluation by faculty;
- exploratory, non-clinical signal inspection;
- demonstrations where the operator understands the device is not certified.

It is **not** intended for diagnosis, screening, monitoring of a patient, triage, or any decision
about treatment.

## 2. Electrical safety

| Rule | Why |
| --- | --- |
| Measure only on **battery power** | Breaks any conductive path to mains |
| **Never** measure while the board is powered by USB, a charger, or a mains adapter | A fault in the supply becomes a fault current path through the electrodes |
| **Do not charge** the battery while electrodes are attached | Charging circuits can couple mains-referenced voltages |
| Disconnect wired peripherals (USB serial, debug probes) during a measurement | Same reason |
| Keep the analog front-end and leads away from other mains-powered equipment | Induced currents and 50/60 Hz pickup |
| Never attach electrodes to a person with a pacemaker or implanted stimulator for a student experiment | Out of scope for an uncertified device |

The software cannot verify any of the above. The operator is responsible, and the UI repeats the
warning.

## 3. What a single AD8232 lead cannot do

- It cannot establish structural heart health, ischaemia, infarction, or a "normal/abnormal heart".
- It cannot detect or exclude arrhythmias reliably; a single lead with a hobby-grade front-end and no
  clinical validation cannot replace a 12-lead ECG.
- It cannot measure blood pressure, oxygen saturation, or cardiac output.
- ST-segment interpretation requires calibrated, clinically validated equipment and trained review.

Therefore the UI never states a cardiac verdict. Colour encodes **monitoring status** (connected,
waiting, quality, review-needed) and the words used are technical: "signal quality", "beat detected",
"rhythm review flag".

## 4. Metric limitations

| Metric | Limitation |
| --- | --- |
| BPM | Derived from detected R-peaks; artefacts can shift it. Median-of-5 smoothing, not a diagnosis |
| RR intervals | ±1 sample (~2 ms at 500 Hz) plus filter phase shift; intervals > 50 % from median are rejected |
| SDNN / RMSSD | Require ≥ 10 valid intervals; short recordings and a single lead make them non-clinical. No normative comparison is offered |
| Signal quality | A technical score (saturation, noise, baseline stability, RR consistency), **not** a confidence that a reading is medically valid |
| Lead-off | Reflects the AD8232's LO+/LO− comparators, not electrode impedance |
| Latency | Measured, displayed, never guaranteed |

## 5. Data handling

- Recordings stay in the browser (IndexedDB). There is no telemetry, account, upload or third-party
  analytics.
- Exported PDFs/CSVs contain whatever the operator records — treat them as study data, not medical
  records.
- Clearing browser data deletes recordings permanently.

## 6. Wording rules enforced in this repository

1. Never write "your heart is healthy/unhealthy", "normal rhythm", "arrhythmia detected", "diagnosis",
   or "risk".
2. Simulation must always be labelled `SIMULATION` on every surface that shows values.
3. Missing data is shown as `—` or "insufficient intervals", never estimated.
4. A hardware result is only "verified" after a physical device test; protocol tests with the scripted
   device are described as such.

## 7. Regulatory position

This project has no regulatory clearance (no CE marking, no FDA clearance, no ISO 13485 quality
system). Presenting it as a medical device, or using it to inform care, would be both unsafe and
outside its intended use. Any future clinical ambition would require certified hardware, a validated
algorithm, clinical evaluation, and a quality management system.
