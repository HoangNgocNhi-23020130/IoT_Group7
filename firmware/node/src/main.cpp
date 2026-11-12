/**
 * Marine Pollution IoT - ESP32 Node Firmware
 * Reads:
 *   - DS18B20 (Water Temperature via OneWire)
 *   - pH Sensor (via ADS1115 A0)
 *   - TDS Sensor (via ADS1115 A1)
 *   - Turbidity Sensor (via ADS1115 A2)
 *
 * Features:
 *   - 10-sample median/trimmed-mean filtering
 *   - JSON telemetry publication (marine/{node_id}/telemetry, QoS 1)
 *   - MQTT Last Will and Testament (LWT) on marine/{node_id}/status
 *   - Circular buffer (200 records in RAM) for offline store-and-forward
 *   - Remote command handling on marine/{node_id}/cmd (set_interval, calibrate_ph)
 *   - Non-blocking loop architecture
 */

#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <Wire.h>
#include <Adafruit_ADS1X15.h>
#include <time.h>

// Include secrets (SSID, Password, MQTT host)
#if __has_include("secrets.h")
#include "secrets.h"
#else
#include "secrets.example.h"
#endif

// ==============================================================================
// Hardware Pin Definitions
// ==============================================================================
#define ONE_WIRE_BUS 4        // DS18B20 data pin (requires 4.7k pull-up resistor to 3.3V)
#define I2C_SDA      21       // ADS1115 I2C SDA
#define I2C_SCL      22       // ADS1115 I2C SCL
#define STATUS_LED   2        // Built-in LED for visual network status

// ==============================================================================
// Sensor Channels on ADS1115
// ==============================================================================
#define ADS_PH_CHANNEL        0  // ADS1115 A0: pH 4502C
#define ADS_TDS_CHANNEL       1  // ADS1115 A1: Analog TDS Meter
#define ADS_TURB_CHANNEL      2  // ADS1115 A2: Turbidity Sensor

// ==============================================================================
// Objects and Clients
// ==============================================================================
WiFiClient espClient;
PubSubClient mqttClient(espClient);
OneWire oneWire(ONE_WIRE_BUS);
DallasTemperature tempSensor(&oneWire);
Adafruit_ADS1115 ads;

// ==============================================================================
// Calibration & Configuration State
// ==============================================================================
// pH linear calibration: pH = phSlope * Voltage + phIntercept
float phSlope = -5.70f;
float phIntercept = 21.34f;

// Calibration 2-point memory
float calibV1 = 0.0f, calibPh1 = 6.86f;
float calibV2 = 0.0f, calibPh2 = 4.01f;

// Sampling & Publishing Timing
uint32_t publishIntervalMs = 10000; // Default 10 seconds (configurable via MQTT cmd)
uint32_t lastPublishTime = 0;
uint32_t seqCounter = 0;

// Topics
char topicTelemetry[64];
char topicStatus[64];
char topicCmd[64];

// NTP Server
const char* ntpServer = "pool.ntp.org";
const long  gmtOffset_sec = 7 * 3600; // GMT+7 for Vietnam
const int   daylightOffset_sec = 0;

// ==============================================================================
// Circular Buffer for Offline Store-and-Forward (up to 200 records in RAM)
// ==============================================================================
#define BUFFER_CAPACITY 200

struct TelemetryRecord {
    uint32_t seq;
    time_t ts;
    float temp_c;
    float ph;
    float tds_ppm;
    float turbidity_ntu;
    int16_t rssi;
};

TelemetryRecord offlineBuffer[BUFFER_CAPACITY];
int bufHead = 0;
int bufTail = 0;
int bufCount = 0;

void bufferPush(const TelemetryRecord& rec) {
    offlineBuffer[bufHead] = rec;
    bufHead = (bufHead + 1) % BUFFER_CAPACITY;
    if (bufCount < BUFFER_CAPACITY) {
        bufCount++;
    } else {
        // Overwrite oldest record if full
        bufTail = (bufTail + 1) % BUFFER_CAPACITY;
    }
}

bool bufferPop(TelemetryRecord& rec) {
    if (bufCount == 0) return false;
    rec = offlineBuffer[bufTail];
    bufTail = (bufTail + 1) % BUFFER_CAPACITY;
    bufCount--;
    return true;
}

// ==============================================================================
// Filtered Sensor Reading Functions (10-sample trimmed mean)
// ==============================================================================
float readAdsVoltageFiltered(uint8_t channel, int samples = 10) {
    float rawVolts[16];
    if (samples > 16) samples = 16;
    if (samples < 3) samples = 3;

    for (int i = 0; i < samples; i++) {
        int16_t adc = ads.readADC_SingleEnded(channel);
        rawVolts[i] = ads.computeVolts(adc);
        delay(10);
    }

    // Sort to remove min and max
    for (int i = 0; i < samples - 1; i++) {
        for (int j = i + 1; j < samples; j++) {
            if (rawVolts[i] > rawVolts[j]) {
                float tmp = rawVolts[i];
                rawVolts[i] = rawVolts[j];
                rawVolts[j] = tmp;
            }
        }
    }

    // Average the middle (samples - 2) values
    float sum = 0.0f;
    for (int i = 1; i < samples - 1; i++) {
        sum += rawVolts[i];
    }
    return sum / (float)(samples - 2);
}

float readTemperatureC() {
    tempSensor.requestTemperatures();
    float t = tempSensor.getTempCByIndex(0);
    if (t < -40.0f || t > 85.0f) {
        return 28.0f; // Sensor error fallback
    }
    return t;
}

float readPh(float voltage) {
    float ph = phSlope * voltage + phIntercept;
    return constrain(ph, 0.0f, 14.0f);
}

float readTds(float voltage, float tempC) {
    // Temperature compensation
    float compCoeff = 1.0f + 0.02f * (tempC - 25.0f);
    float compVoltage = voltage / compCoeff;
    // DFRobot TDS transfer formula
    float tds = (133.42f * compVoltage * compVoltage * compVoltage
                 - 255.86f * compVoltage * compVoltage
                 + 857.39f * compVoltage) * 0.5f;
    return max(0.0f, tds);
}

float readTurbidity(float voltage) {
    // Standard analog turbidity sensor characteristic curve:
    // Clear water ~4.1V -> 0 NTU; Dirty water drops towards 2.5V
    if (voltage >= 4.1f) return 0.5f;
    if (voltage <= 2.5f) return 3000.0f;
    float ntu = -1120.4f * (voltage * voltage) + 5742.3f * voltage - 4352.9f;
    return max(0.1f, ntu);
}

// ==============================================================================
// ISO-8601 Timestamp Generation
// ==============================================================================
String getIsoTimestamp(time_t rawTime = 0) {
    struct tm timeinfo;
    if (rawTime == 0) {
        if (!getLocalTime(&timeinfo)) {
            return "2026-11-20T08:00:00Z";
        }
    } else {
        gmtime_r(&rawTime, &timeinfo);
    }
    char buf[32];
    strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &timeinfo);
    return String(buf);
}

// ==============================================================================
// MQTT Command Handler (Remote Control)
// ==============================================================================
void handleMqttCommand(char* topic, byte* payload, unsigned int length) {
    char jsonStr[256];
    if (length >= sizeof(jsonStr)) return;
    memcpy(jsonStr, payload, length);
    jsonStr[length] = '\0';

    StaticJsonDocument<256> doc;
    DeserializationError error = deserializeJson(doc, jsonStr);
    if (error) {
        Serial.printf("[CMD] JSON parse failed: %s\n", error.c_str());
        return;
    }

    const char* cmd = doc["cmd"] | "";

    // 1. Change sampling/publishing interval
    if (strcmp(cmd, "set_interval") == 0) {
        uint32_t newInterval = doc["interval_sec"] | 10;
        if (newInterval >= 1 && newInterval <= 3600) {
            publishIntervalMs = newInterval * 1000;
            Serial.printf("[CMD] Sampling interval updated to: %u seconds\n", newInterval);
        }
    }
    // 2. 2-Point pH Calibration
    else if (strcmp(cmd, "calibrate_ph") == 0) {
        int point = doc["point"] | 1;
        float targetPh = doc["target_ph"] | 7.0f;
        float currentV = readAdsVoltageFiltered(ADS_PH_CHANNEL, 15);

        if (point == 1) {
            calibV1 = currentV;
            calibPh1 = targetPh;
            Serial.printf("[CMD] Calibrated Point 1: pH %.2f at %.3fV\n", calibPh1, calibV1);
        } else if (point == 2) {
            calibV2 = currentV;
            calibPh2 = targetPh;
            if (fabs(calibV2 - calibV1) > 0.05f) {
                phSlope = (calibPh2 - calibPh1) / (calibV2 - calibV1);
                phIntercept = calibPh1 - phSlope * calibV1;
                Serial.printf("[CMD] Calibrated Point 2: pH %.2f at %.3fV\n", calibPh2, calibV2);
                Serial.printf("[CMD] New pH Formula: pH = %.2f * V + %.2f\n", phSlope, phIntercept);
            }
        }
    }
}

// ==============================================================================
// Network & MQTT Connection Management
// ==============================================================================
void setupWifi() {
    Serial.printf("\n[Wi-Fi] Connecting to %s ", WIFI_SSID);
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASS);

    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 25) {
        delay(400);
        Serial.print(".");
        attempts++;
    }

    if (WiFi.status() == WL_CONNECTED) {
        Serial.printf("\n[Wi-Fi] Connected! IP: %s, RSSI: %d dBm\n",
                      WiFi.localIP().toString().c_str(), WiFi.RSSI());
        configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);
        digitalWrite(STATUS_LED, HIGH);
    } else {
        Serial.println("\n[Wi-Fi] Failed to connect. Will retry in loop.");
        digitalWrite(STATUS_LED, LOW);
    }
}

void reconnectMqtt() {
    if (WiFi.status() != WL_CONNECTED) return;
    if (mqttClient.connected()) return;

    Serial.printf("[MQTT] Attempting connection to %s:%d...\n", MQTT_HOST, 1883);

    // LWT payload (Retained message indicating offline state if connection abruptly drops)
    char lwtPayload[128];
    snprintf(lwtPayload, sizeof(lwtPayload),
             "{\"node_id\":\"%s\",\"status\":\"offline\",\"reason\":\"LWT\"}",
             NODE_ID);

    bool connected = false;
#ifdef MQTT_USER
    connected = mqttClient.connect(NODE_ID, MQTT_USER, MQTT_PASS, topicStatus, 1, true, lwtPayload);
#else
    connected = mqttClient.connect(NODE_ID, topicStatus, 1, true, lwtPayload);
#endif

    if (connected) {
        Serial.println("[MQTT] Connected to Mosquitto Broker!");
        // Publish Online birth certificate
        char birthPayload[128];
        snprintf(birthPayload, sizeof(birthPayload),
                 "{\"node_id\":\"%s\",\"status\":\"online\"}",
                 NODE_ID);
        mqttClient.publish(topicStatus, birthPayload, true);

        // Subscribe to remote command topic
        mqttClient.subscribe(topicCmd, 1);
        Serial.printf("[MQTT] Subscribed to command topic: %s\n", topicCmd);
    } else {
        Serial.printf("[MQTT] Connect failed, rc=%d. Will retry in next loop.\n", mqttClient.state());
    }
}

// ==============================================================================
// Telemetry Transmission & Buffer Flushing
// ==============================================================================
bool publishTelemetry(const TelemetryRecord& rec) {
    StaticJsonDocument<384> doc;
    doc["node_id"] = NODE_ID;
    doc["seq"] = rec.seq;
    doc["ts"] = getIsoTimestamp(rec.ts);
    doc["temp_c"] = serialized(String(rec.temp_c, 2));
    doc["ph"] = serialized(String(rec.ph, 2));
    doc["tds_ppm"] = serialized(String(rec.tds_ppm, 1));
    doc["turbidity_ntu"] = serialized(String(rec.turbidity_ntu, 2));

    JsonObject color = doc.createNestedObject("color");
    color["r"] = 100;
    color["g"] = 140;
    color["b"] = 120;

    doc["rssi"] = rec.rssi;

    char buffer[384];
    size_t n = serializeJson(doc, buffer);
    return mqttClient.publish(topicTelemetry, buffer, n);
}

void flushOfflineBuffer() {
    // Send up to 3 buffered records per loop to avoid blocking network socket
    int sent = 0;
    while (bufCount > 0 && mqttClient.connected() && sent < 3) {
        TelemetryRecord rec;
        if (bufferPop(rec)) {
            if (publishTelemetry(rec)) {
                sent++;
                Serial.printf("[BUFFER] Flushed offline record seq=%u (remaining=%d)\n", rec.seq, bufCount);
            } else {
                // If publish failed, push back and stop flushing for now
                bufferPush(rec);
                break;
            }
        }
    }
}

// ==============================================================================
// Arduino Setup & Loop
// ==============================================================================
void setup() {
    Serial.begin(115200);
    delay(500);
    Serial.println("\n==================================================");
    Serial.printf(" Marine Pollution IoT - Station [%s]\n", NODE_ID);
    Serial.println("==================================================");

    pinMode(STATUS_LED, OUTPUT);
    digitalWrite(STATUS_LED, LOW);

    // Initialize Topics
    snprintf(topicTelemetry, sizeof(topicTelemetry), "marine/%s/telemetry", NODE_ID);
    snprintf(topicStatus, sizeof(topicStatus), "marine/%s/status", NODE_ID);
    snprintf(topicCmd, sizeof(topicCmd), "marine/%s/cmd", NODE_ID);

    // Initialize I2C and ADS1115 ADC
    Wire.begin(I2C_SDA, I2C_SCL);
    if (!ads.begin(0x48)) {
        Serial.println("[ADS1115] WARNING: ADS1115 not found at 0x48! Check wiring.");
    } else {
        ads.setGain(GAIN_ONE); // +/- 4.096V range (1 bit = 0.125mV)
        Serial.println("[ADS1115] Initialized successfully (+/- 4.096V range).");
    }

    // Initialize DS18B20 OneWire sensor
    tempSensor.begin();
    Serial.printf("[DS18B20] Detected %d temperature sensor(s).\n", tempSensor.getDeviceCount());

    // Wi-Fi & MQTT
    setupWifi();
    mqttClient.setServer(MQTT_HOST, 1883);
    mqttClient.setCallback(handleMqttCommand);
    mqttClient.setBufferSize(512);

    reconnectMqtt();
}

void loop() {
    // 1. Maintain Wi-Fi and MQTT connections
    if (WiFi.status() != WL_CONNECTED) {
        digitalWrite(STATUS_LED, LOW);
        static uint32_t lastWifiRetry = 0;
        if (millis() - lastWifiRetry > 10000) {
            setupWifi();
            lastWifiRetry = millis();
        }
    } else {
        if (!mqttClient.connected()) {
            static uint32_t lastMqttRetry = 0;
            if (millis() - lastMqttRetry > 5000) {
                reconnectMqtt();
                lastMqttRetry = millis();
            }
        } else {
            mqttClient.loop();
            // Flush any buffered offline records
            flushOfflineBuffer();
        }
    }

    // 2. Periodic Sensor Sampling & Transmission
    uint32_t now = millis();
    if (now - lastPublishTime >= publishIntervalMs) {
        lastPublishTime = now;
        seqCounter++;

        // Read all physical sensors
        float tempC = readTemperatureC();
        float phVoltage = readAdsVoltageFiltered(ADS_PH_CHANNEL);
        float tdsVoltage = readAdsVoltageFiltered(ADS_TDS_CHANNEL);
        float turbVoltage = readAdsVoltageFiltered(ADS_TURB_CHANNEL);

        float ph = readPh(phVoltage);
        float tds = readTds(tdsVoltage, tempC);
        float turb = readTurbidity(turbVoltage);
        int16_t rssi = WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : -95;

        // Populate record
        TelemetryRecord rec;
        rec.seq = seqCounter;
        rec.ts = time(nullptr);
        rec.temp_c = tempC;
        rec.ph = ph;
        rec.tds_ppm = tds;
        rec.turbidity_ntu = turb;
        rec.rssi = rssi;

        Serial.printf("[SENSORS] seq=%u | Temp: %.1fC | pH: %.2f (%.3fV) | TDS: %.0fppm | Turb: %.1fNTU | RSSI: %d\n",
                      rec.seq, tempC, ph, phVoltage, tds, turb, rssi);

        // If online -> publish directly; If offline/MQTT down -> push to circular RAM buffer
        if (mqttClient.connected()) {
            if (!publishTelemetry(rec)) {
                Serial.println("[MQTT] Publish failed! Buffering in RAM...");
                bufferPush(rec);
            }
        } else {
            Serial.printf("[OFFLINE] Stored record in RAM buffer (queue=%d/%d)\n", bufCount + 1, BUFFER_CAPACITY);
            bufferPush(rec);
        }
    }
}
