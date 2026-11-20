# HARDWARE INTEGRATION — AD8232 + ESP32

> **Educational prototype.** Not a certified medical device. Battery power only while electrodes are
> attached; never measure on mains-powered or charging hardware.

## 1. Signal chain

```
Electrodes → AD8232 (instrumentation amp + filters) → analog output → ESP32 ADC1
          → timer-sampled ring buffer → batched WebSocket → bridge → browser
```

- AD8232 provides a single lead (typically Lead I with RA/LA/RL electrodes), roughly 1000× gain,
  an internal 0.5 Hz-ish high-pass and a ~40 Hz-ish low-pass, plus lead-off detection.
- The analog output is centred near mid-supply; expect ~1 V swing for a 1 mV cardiac signal.
- ESP32 samples the output; all digital filtering, R-peak detection and metrics happen in the
  browser-side TypeScript pipeline, not on the MCU.

## 2. Wiring (classic ESP32 DevKit, example)

| AD8232 | ESP32 | Note |
| --- | --- | --- |
| `3.3V` | 3V3 | Check your breakout: some accept 5 V and regulate internally |
| `GND` | GND | Single common ground |
| `OUTPUT` | GPIO34 | ADC1 channel, input-only pin |
| `LO+` | GPIO25 | Active HIGH on lead-off |
| `LO−` | GPIO26 | Active HIGH on lead-off |
| `SDN` | 3V3 | Shutdown is active LOW; tie high |

Electrodes: RA (right arm), LA (left arm), RL (right leg / reference) per your module's documentation.

## 3. GPIO and ADC caveats

- **GPIO34 is an example, not a universal pin.** ADC1 pins differ on ESP32-S3 (GPIO1–GPIO10) and C3.
  Change `ADC_PIN` in `config.h` and verify against the board pinout.
- **ADC2 is unusable while Wi-Fi is active** on classic ESP32 — always choose an ADC1 pin.
- GPIO34–39 are input-only and have no internal pull-ups (not needed here).
- **Attenuation:** the sketch uses `ADC_11db` for the ~0–3.3 V range. Do not feed the ADC more than
  3.3 V; the AD8232 output must stay within the supply rails.
- **Resolution:** 12-bit (0–4095) → ≈0.8 mV per count at the ADC pin; with the AFE's ~1000× gain,
  ≈0.8 µV per count at the electrodes. `COUNTS_PER_MV = 1240` is used for display scaling.
- **Noise:** keep the analog lead short, away from the Wi-Fi antenna, and use a star ground at the
  ESP32 GND pin. Expect 50/60 Hz pickup; the notch filter handles the residual.

## 4. Power architecture

| Configuration | Allowed? |
| --- | --- |
| Battery (LiPo + regulator, or 3×AA) powering ESP32 + AD8232 | **Yes** — the only supported measurement configuration |
| USB from a laptop, electrodes **not** attached | Yes — bench testing only |
| USB/mains-powered while electrodes are on a person | **No** — potential path to mains |
| Charging the battery during a measurement | **No** |

The firmware and UI cannot enforce this; it is the operator's responsibility. The UI repeats the
warning on the Overview page.

## 5. Sampling performance

- Timer-driven acquisition at `SAMPLE_RATE_HZ` (default 500 Hz). `analogRead()` inside the ISR costs
  ~10 µs, i.e. 0.5 % of the 2 ms budget at 500 Hz.
- A 4096-sample ring buffer decouples acquisition from networking (~8 s of slack at 500 Hz). If the
  network stalls longer than that, the buffer overruns and the condition is reported, never hidden.
- JSON frames of 25 samples ≈ 300 bytes at 20 frames/s ≈ 6 kB/s — comfortable for 2.4 GHz Wi-Fi.
- Measured latency is displayed in the UI; no latency guarantee is made.

## 6. Board/variant uncertainty

The exact ESP32 variant and AD8232 breakout are not fixed by this repository. Therefore:

- all pins live in `firmware/cardiopulse-esp32/config.example.h`;
- the firmware uses the ESP32 Arduino core 3.x timer API (`timerBegin(frequency)`);
- supply requirements of the breakout are documented per-vendor and must be checked;
- the sketch makes no assumption about a second ADC channel or an onboard DAC.

## 7. Bringing up hardware

1. Flash with `WIFI_SSID`, `WIFI_PASSWORD`, `BRIDGE_HOST` (LAN IP of the bridge machine) set.
2. Open the serial monitor: `[wifi] connected`, `[ws] connected`, then `[status] samples=… ws=up`.
3. Attach electrodes (battery power), verify `lead_off_*` goes false.
4. In the UI: Device Settings → Hardware → confirm device id and sample rate; Overview shows a live
   trace and the electrodes panel shows both leads connected.
5. Record a short session, export the CSV, and inspect raw values offline.

If the trace looks railed or flat, check electrode contact first, then `ADC_PIN` and attenuation.
