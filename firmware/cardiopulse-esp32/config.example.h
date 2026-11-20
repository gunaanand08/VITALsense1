// CARDIOPULSE ESP32 configuration example.
// Copy this file to `config.h` and edit the values for your board.
// `config.h` is git-ignored so credentials never enter the repository.

#ifndef CARDIOPULSE_CONFIG_H
#define CARDIOPULSE_CONFIG_H

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------
#define DEVICE_ID "cardiopulse-esp32-01"
#define FIRMWARE_VERSION "1.0.0"
#define PROTOCOL_VERSION 1

// ---------------------------------------------------------------------------
// Wi-Fi
// ---------------------------------------------------------------------------
#define WIFI_SSID "your-ssid"
#define WIFI_PASSWORD "your-password"

// ---------------------------------------------------------------------------
// Bridge endpoint (the machine running `npm run server`)
// ---------------------------------------------------------------------------
// Use the bridge machine's LAN IP, not "localhost": the ESP32 is a separate host.
#define BRIDGE_HOST "192.168.1.50"
#define BRIDGE_PORT 8787
#define BRIDGE_PATH "/ws/device"

// ---------------------------------------------------------------------------
// Acquisition
// ---------------------------------------------------------------------------
// 500 Hz is the recommended default. `SAMPLE_BATCH_SIZE` trades frame overhead
// against latency: 25 samples at 500 Hz = 50 ms per WebSocket frame.
#define SAMPLE_RATE_HZ 500
#define SAMPLE_BATCH_SIZE 25

// Ring buffer capacity in samples (must be a power-of-two-friendly size).
// 4096 samples = ~8 s of slack at 500 Hz.
#define RING_CAPACITY 4096

// ADC input.
//
// GPIO34 is an ADC1 channel and is the usual choice on classic ESP32 boards
// (ESP32-WROOM-32 / DevKitC). It is NOT universal:
//   * ESP32-S3 / C3 boards route ADC1 differently and may use GPIO1-GPIO10.
//   * GPIO34-39 are input-only, which is fine here but means no pull-ups.
//   * ADC2 pins are unusable while Wi-Fi is active — stay on ADC1.
// Verify against your board's pinout before flashing, and keep the AD8232
// OUTPUT within 0-3.3 V.
#define ADC_PIN 34

// AD8232 lead-off detection outputs (active HIGH on the module).
#define LO_PLUS_PIN 25
#define LO_MINUS_PIN 26

#endif  // CARDIOPULSE_CONFIG_H
