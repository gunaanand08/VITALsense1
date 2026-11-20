# CARDIOPULSE ESP32 firmware

Arduino-ESP32 sketch that samples an AD8232 single-lead front-end and streams
batches to the local bridge over WebSocket.

> **Educational prototype — not a medical device.**
> Battery power only while electrodes are on a person. Never measure while the
> board is on mains/USB power or while the battery is charging.

## Hardware

| Signal | ESP32 | Notes |
| --- | --- | --- |
| AD8232 `OUTPUT` | `ADC_PIN` (default GPIO34) | ADC1 only — ADC2 is unusable with Wi-Fi on |
| AD8232 `3.3V` | 3V3 | Most breakouts regulate 3.3 V from 5 V; check yours |
| AD8232 `GND` | GND | Common ground |
| AD8232 `LO+` | GPIO25 | Lead-off, active HIGH |
| AD8232 `LO−` | GPIO26 | Lead-off, active HIGH |
| AD8232 `SDN` | 3V3 | Shutdown is active LOW; tie high to run |
| Electrodes | RA / LA / RL | Placement per your module's documentation |

GPIO34 is an example for classic ESP32 boards, **not** a universal pin. ESP32-S3/C3
route ADC1 differently — change `ADC_PIN` in `config.h`.

## Libraries

- **arduinoWebSockets** (Links2004) — `WebSocketsClient`
- ESP32 Arduino core 3.x (uses the `timerBegin(frequency)` API in this sketch)

## Flash

1. Copy `config.example.h` → `config.h`, set Wi-Fi credentials and `BRIDGE_HOST`
   (the LAN IP of the machine running `npm run server`, **not** `localhost`).
2. Open `cardiopulse-esp32.ino` in Arduino IDE (or `arduino-cli`), select your board.
3. Run the bridge: `npm run server` on that machine.
4. Flash, open the serial monitor at 115200 baud, and confirm
   `[ws] connected` and `[status] samples=… ws=up`.
5. In CARDIOPULSE, switch to **Hardware** mode; the device id and packet counters appear.

## Design notes

- **Timer-driven sampling.** A 1 MHz hardware timer triggers the ADC read every
  `1e6 / SAMPLE_RATE_HZ` µs. `loop()` never blocks acquisition.
- **Ring buffer between ISR and network.** A full buffer sets an overrun flag and
  drops the newest sample instead of corrupting older data — loss is reported, not hidden.
- **Fixed batch frames.** 25 samples per frame at 500 Hz (50 ms). JSON is used
  because it is inspectable; the payload stays small (~300 bytes/frame).
- **Sequence numbers** let the bridge and the browser detect gaps.
- **Reconnect** is handled by `setReconnectInterval(2000)` plus a 15 s heartbeat.

## Known limitations

- `analogRead()` inside the ISR costs ~10 µs; at 500 Hz that is 0.5 % duty cycle
  and acceptable, but a faster front-end would need continuous DMA sampling.
- Wi-Fi jitter can delay frames; the device clock (`timestamp_ms`) stays accurate
  because it is derived from the sample counter, not from transmission time.
- No mDNS advertisement yet, so discovery on the settings page relies on the
  device being already connected, or on manual entry.
- Not tested against physical hardware in this repository — see
  `docs/KNOWN_LIMITATIONS.md`.
