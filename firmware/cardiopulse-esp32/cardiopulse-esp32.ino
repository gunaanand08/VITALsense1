/*
 * CARDIOPULSE — ESP32 + AD8232 acquisition firmware
 * ------------------------------------------------
 * EDUCATIONAL PROTOTYPE — NOT A MEDICAL DEVICE.
 *
 * Battery power only while electrodes are attached. Never measure a person
 * while the board is powered from mains/USB or while the battery is charging.
 *
 * Pipeline: AD8232 OUTPUT -> ADC pin -> hardware timer -> ring buffer ->
 * batched JSON frames -> WebSocket client -> local bridge -> browser.
 *
 * Sampling runs from a hardware timer; networking happens in loop(). Network
 * stalls therefore delay transmission but never change the sample interval.
 */

#include <WiFi.h>
#include <WebSocketsClient.h>

#include "config.h"

// ---------------------------------------------------------------------------
// Acquisition state
// ---------------------------------------------------------------------------
const int ADC_BITS = 12;
const int ADC_MAX = (1 << ADC_BITS) - 1;
const uint32_t SAMPLE_PERIOD_US = 1000000UL / SAMPLE_RATE_HZ;

volatile uint16_t *ring = nullptr;
volatile uint32_t ringHead = 0;  // written by ISR
volatile uint32_t ringTail = 0;  // read by loop()
volatile uint32_t sampleCounter = 0;
volatile bool overrun = false;

hw_timer_t *sampleTimer = nullptr;
portMUX_TYPE timerMux = portMUX_INITIALIZER_UNLOCKED;

WebSocketsClient webSocket;
bool wsConnected = false;
uint32_t sequenceNumber = 0;
uint32_t lastReconnectAttempt = 0;

// Batch buffer reused every frame (no heap churn in the hot path).
uint16_t batch[SAMPLE_BATCH_SIZE];
size_t batchFill = 0;
uint32_t batchStartSample = 0;

void IRAM_ATTR onSampleTimer() {
  portENTER_CRITICAL_ISR(&timerMux);
  uint32_t next = (ringHead + 1) % RING_CAPACITY;
  if (next == ringTail) {
    overrun = true;  // buffer full: drop newest rather than corrupt older data
  } else {
    ring[ringHead] = analogRead(ADC_PIN);
    ringHead = next;
    sampleCounter++;
  }
  portEXIT_CRITICAL_ISR(&timerMux);
}

// ---------------------------------------------------------------------------
// Networking
// ---------------------------------------------------------------------------
void sendHello() {
  char frame[220];
  snprintf(
      frame, sizeof(frame),
      "{\"type\":\"hello\",\"protocol_version\":%d,\"device_id\":\"%s\","
      "\"firmware_version\":\"%s\",\"sample_rate_hz\":%d,\"batch_size\":%d,"
      "\"adc_bits\":%d,\"adc_pin\":%d}",
      PROTOCOL_VERSION, DEVICE_ID, FIRMWARE_VERSION, SAMPLE_RATE_HZ,
      SAMPLE_BATCH_SIZE, ADC_BITS, ADC_PIN);
  webSocket.sendTXT(frame);
}

void sendBatch(const uint16_t *samples, size_t count, uint32_t firstSample) {
  static char frame[64 + SAMPLE_BATCH_SIZE * 6];
  const bool loPlus = digitalRead(LO_PLUS_PIN) == HIGH;
  const bool loMinus = digitalRead(LO_MINUS_PIN) == HIGH;
  // timestamp is the device clock of the batch's first sample.
  uint32_t timestampMs = (uint32_t)((uint64_t)firstSample * 1000ULL / SAMPLE_RATE_HZ);

  int written = snprintf(
      frame, sizeof(frame),
      "{\"type\":\"ecg_batch\",\"protocol_version\":%d,\"device_id\":\"%s\","
      "\"sequence\":%lu,\"sample_rate_hz\":%d,\"timestamp_ms\":%lu,"
      "\"lead_off_positive\":%s,\"lead_off_negative\":%s,\"samples\":[",
      PROTOCOL_VERSION, DEVICE_ID, (unsigned long)sequenceNumber, SAMPLE_RATE_HZ,
      (unsigned long)timestampMs, loPlus ? "true" : "false",
      loMinus ? "true" : "false");

  for (size_t i = 0; i < count; i++) {
    int wrote = snprintf(frame + written, sizeof(frame) - written, "%s%u",
                         i == 0 ? "" : ",", samples[i]);
    if (wrote <= 0 || (size_t)(written + wrote) >= sizeof(frame)) break;
    written += wrote;
  }
  snprintf(frame + written, sizeof(frame) - written, "]}");
  webSocket.sendTXT(frame);
  sequenceNumber++;
}

void webSocketEvent(WStype_t type, uint8_t *payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      wsConnected = true;
      Serial.printf("[ws] connected to %s:%d%s\n", BRIDGE_HOST, BRIDGE_PORT, BRIDGE_PATH);
      sendHello();
      break;
    case WStype_DISCONNECTED:
      wsConnected = false;
      Serial.println("[ws] disconnected");
      break;
    case WStype_TEXT:
      // Bridge acknowledgements are informational only.
      break;
    default:
      break;
  }
  (void)payload;
  (void)length;
}

// ---------------------------------------------------------------------------
// Setup / loop
// ---------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(200);

  analogReadResolution(ADC_BITS);
  // 11 dB attenuation gives the full ~0-3.3 V range on ADC1 pins.
  analogSetAttenuation(ADC_11db);

  pinMode(LO_PLUS_PIN, INPUT);
  pinMode(LO_MINUS_PIN, INPUT);

  ring = (uint16_t *)malloc(sizeof(uint16_t) * RING_CAPACITY);
  if (!ring) {
    Serial.println("[fatal] ring buffer allocation failed");
    while (true) delay(1000);
  }

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("[wifi] connecting");
  while (WiFi.status() != WL_CONNECTED) {
    delay(400);
    Serial.print('.');
  }
  Serial.printf("\n[wifi] connected, ip=%s\n", WiFi.localIP().toString().c_str());

  webSocket.begin(BRIDGE_HOST, BRIDGE_PORT, BRIDGE_PATH);
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(2000);
  webSocket.enableHeartbeat(15000, 3000, 2);

  // 1 MHz timer base, alarm every SAMPLE_PERIOD_US -> exact sample rate.
  sampleTimer = timerBegin(1000000);
  timerAttachInterrupt(sampleTimer, &onSampleTimer);
  timerAlarm(sampleTimer, SAMPLE_PERIOD_US, true, 0);

  Serial.printf("[acq] sampling at %d Hz on GPIO%d\n", SAMPLE_RATE_HZ, ADC_PIN);
  Serial.println("[note] educational prototype — not a medical device");
}

void loop() {
  webSocket.loop();

  // Drain the ring buffer into fixed-size batches.
  while (ringTail != ringHead) {
    portENTER_CRITICAL(&timerMux);
    uint32_t head = ringHead;
    portEXIT_CRITICAL(&timerMux);

    if (batchFill == 0) batchStartSample = sampleCounter - (uint32_t)((head + RING_CAPACITY - ringTail) % RING_CAPACITY);

    batch[batchFill++] = ring[ringTail];
    ringTail = (ringTail + 1) % RING_CAPACITY;

    if (batchFill >= SAMPLE_BATCH_SIZE) {
      if (wsConnected) sendBatch(batch, batchFill, batchStartSample);
      batchFill = 0;
    }

    if (ringTail == head) break;
  }

  static uint32_t lastStatus = 0;
  if (millis() - lastStatus > 5000) {
    lastStatus = millis();
    Serial.printf("[status] samples=%lu ws=%s heap=%u overrun=%s\n",
                  (unsigned long)sampleCounter, wsConnected ? "up" : "down",
                  (unsigned)ESP.getFreeHeap(), overrun ? "yes" : "no");
  }

  delay(1);  // yield to the network stack; sampling is timer-driven
}
