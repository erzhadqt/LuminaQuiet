#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <WebSocketsClient.h>

// --- Wi-Fi & Backend Settings ---
const char* WIFI_SSID = "ezratkyuti";
const char* WIFI_PASSWORD = "87654321";

// #ifndef WS_HOST_IP
//   #define WS_HOST_IP "127.0.0.1" 
// #endif

const char* API_HOST = WS_HOST_IP;
const uint16_t API_PORT = 8000;
const char* SESSION_CONFIG_PATH = "/api/sessions/current/";
const char* LOGS_PATH = "/api/logs/";
const char* WS_NOISE_PATH = "/ws/noise/";
const char* DEVICE_ID = "esp32-luminaquiet-01";

// Pin definitions for 3 sound sensors
const int SOUND_SENSOR_PINS[] = {34, 35, 32};
const int NUM_SENSORS = sizeof(SOUND_SENSOR_PINS) / sizeof(SOUND_SENSOR_PINS[0]);

const int BLUE_LED_PIN = 18;
const int GREEN_LED_PIN = 19;
const int RED_LED_PIN = 21;
const int BUZZER_PIN = 23;

// Local defaults used at boot until admin config arrives
const int QUIET_THRESHOLD_MIN = 800;
const int MEDIUM_THRESHOLD_MIN = 1500;
const int LOUD_THRESHOLD_MIN = 2500;

// Adaptive threshold offsets used for initial calibration
const int QUIET_OFFSET = 220;
const int MEDIUM_OFFSET = 620;
const int LOUD_OFFSET = 1250;

const int HYSTERESIS = 50;
const unsigned long LOUD_HOLD_MS = 600;
const int CALIBRATION_SAMPLES = 120;

const unsigned long LOOP_DELAY_MS = 10;
const unsigned long LOG_INTERVAL_MS = 500;
const unsigned long IDLE_SESSION_POLL_MS = 3000;
const unsigned long ACTIVE_SESSION_POLL_MS = 2000;
const unsigned long LIVE_SAMPLE_INTERVAL_MS = 1000;
const unsigned long BUZZER_ALARM_DURATION_MS = 3000;
const unsigned long WIFI_CONNECT_TIMEOUT_MS = 20000;
const unsigned long WIFI_RETRY_INTERVAL_MS = 10000;
const unsigned long HTTP_TIMEOUT_MS = 4000;
const unsigned long WS_PING_INTERVAL_MS = 20000;
const unsigned long WS_RECONNECT_INTERVAL_MS = 2000;

// Smoothing variables
const int NUM_READINGS = 10;
int readings[NUM_READINGS];
int readIndex = 0;
int total = 0;
int average = 0;

int sensorValues[NUM_SENSORS] = {0};
int baselineLevel = 0;
int quietThreshold = QUIET_THRESHOLD_MIN;
int mediumThreshold = MEDIUM_THRESHOLD_MIN;
int loudThreshold = LOUD_THRESHOLD_MIN;
bool buzzerOnLoud = false;
bool buzzerAlarmActive = false;
unsigned long buzzerAlarmStartedMs = 0;

unsigned long lastLogMs = 0;
unsigned long loudEnteredMs = 0;
unsigned long quietEnteredMs = 0;
unsigned long lastWifiRetryMs = 0;
unsigned long lastSessionPollMs = 0;
unsigned long lastLiveSampleMs = 0;

int activeSessionId = -1;

enum ControllerMode {
  MODE_IDLE,
  MODE_ACTIVE,
};

enum SessionFetchState {
  FETCH_ERROR,
  FETCH_IDLE,
  FETCH_ACTIVE,
};

ControllerMode controllerMode = MODE_IDLE;

enum SoundState {
  STATE_QUIET,
  STATE_MEDIUM_LOW,
  STATE_MEDIUM,
  STATE_LOUD
};

SoundState currentState = STATE_QUIET;
SoundState lastReportedState = STATE_QUIET;
bool hasReportedState = false;

WebSocketsClient wsClient;
bool wsConnected = false;

void enterIdleMode(const char* reason);
void enterActiveMode();
bool applySessionPayload(JsonVariantConst sessionNode);
void pollSessionState(unsigned long nowMs);

void triggerBuzzerAlarm(unsigned long nowMs) {
  if (!buzzerOnLoud) {
    return;
  }

  buzzerAlarmActive = true;
  buzzerAlarmStartedMs = nowMs;
}

void updateBuzzerAlarm(unsigned long nowMs) {
  if (!buzzerAlarmActive) {
    return;
  }

  if (nowMs - buzzerAlarmStartedMs >= BUZZER_ALARM_DURATION_MS) {
    buzzerAlarmActive = false;
  }
}

bool isBuzzerOn(unsigned long nowMs) {
  return buzzerOnLoud && buzzerAlarmActive && nowMs - buzzerAlarmStartedMs < BUZZER_ALARM_DURATION_MS;
}

void onWebSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  if (type == WStype_CONNECTED) {
    wsConnected = true;
    Serial.println("WebSocket connected.");
    wsClient.sendTXT("{\"action\":\"ping\"}");
    return;
  }

  if (type == WStype_DISCONNECTED) {
    wsConnected = false;
    Serial.println("WebSocket disconnected.");
    return;
  }

  if (type != WStype_TEXT || payload == nullptr || length == 0) {
    return;
  }

  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, payload, length);
  if (error) {
    return;
  }

  const char* messageType = doc["type"] | "";
  if (strcmp(messageType, "session_started") == 0) {
    JsonVariantConst sessionNode = doc["session"];
    if (sessionNode.isNull()) {
      sessionNode = doc;
    }

    int previousSessionId = activeSessionId;
    if (!applySessionPayload(sessionNode)) {
      return;
    }

    if (controllerMode == MODE_IDLE || previousSessionId != activeSessionId) {
      enterActiveMode();
    }
    return;
  }

  if (strcmp(messageType, "session_stopped") != 0) {
    return;
  }

  int sessionId = doc["session_id"] | -1;
  if (controllerMode == MODE_ACTIVE && (sessionId < 0 || sessionId == activeSessionId)) {
    enterIdleMode("WebSocket stop signal received.");
  }
}

void setupWebSocket() {
  wsClient.begin(API_HOST, API_PORT, WS_NOISE_PATH);
  wsClient.onEvent(onWebSocketEvent);
  wsClient.setReconnectInterval(WS_RECONNECT_INTERVAL_MS);
  wsClient.enableHeartbeat(WS_PING_INTERVAL_MS, 3000, 2);
}

void maintainWebSocket() {
  if (WiFi.status() != WL_CONNECTED) {
    wsConnected = false;
    return;
  }

  wsClient.loop();
}

const char* wifiStatusToString(wl_status_t status) {
  if (status == WL_IDLE_STATUS) return "Idle";
  if (status == WL_NO_SSID_AVAIL) return "SSID Not Found";
  if (status == WL_SCAN_COMPLETED) return "Scan Completed";
  if (status == WL_CONNECTED) return "Connected";
  if (status == WL_CONNECT_FAILED) return "Connect Failed";
  if (status == WL_CONNECTION_LOST) return "Connection Lost";
  if (status == WL_DISCONNECTED) return "Disconnected";
  return "Unknown";
}

bool connectToWifi() {
  Serial.print("Connecting to Wi-Fi: ");
  Serial.println(WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.disconnect(true);
  delay(200);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long startedAt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startedAt < WIFI_CONNECT_TIMEOUT_MS) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("Wi-Fi Connected!");
    Serial.print("IP Address: ");
    Serial.println(WiFi.localIP());
    return true;
  }

  Serial.print("Wi-Fi connect timeout. Status: ");
  Serial.println(wifiStatusToString(WiFi.status()));
  return false;
}

String buildApiUrl(const char* path) {
  return String("http://") + String(API_HOST) + ":" + String(API_PORT) + String(path);
}

int readCombinedSoundLevel() {
  int maxValue = 0;
  int sumValues = 0;

  for (int i = 0; i < NUM_SENSORS; i++) {
    int value = analogRead(SOUND_SENSOR_PINS[i]);
    sensorValues[i] = value;
    sumValues += value;
    if (value > maxValue) {
      maxValue = value;
    }
  }

  int avgValue = sumValues / NUM_SENSORS;
  return (maxValue + avgValue) / 2;
}

void enforceThresholdSpacing() {
  if (quietThreshold < 0) quietThreshold = 0;
  if (mediumThreshold < 0) mediumThreshold = 0;
  if (loudThreshold < 0) loudThreshold = 0;

  if (quietThreshold > 4095) quietThreshold = 4095;
  if (mediumThreshold > 4095) mediumThreshold = 4095;
  if (loudThreshold > 4095) loudThreshold = 4095;

  if (mediumThreshold <= quietThreshold + HYSTERESIS) {
    mediumThreshold = min(4095, quietThreshold + HYSTERESIS + 50);
  }
  if (loudThreshold <= mediumThreshold + HYSTERESIS) {
    loudThreshold = min(4095, mediumThreshold + HYSTERESIS + 120);
  }
}

bool validateThresholdOrder(int quietValue, int mediumValue, int loudValue) {
  return quietValue >= 0 && mediumValue >= 0 && loudValue >= 0 &&
         quietValue <= 4095 && mediumValue <= 4095 && loudValue <= 4095 &&
         quietValue < mediumValue && mediumValue < loudValue;
}

void calibrateBaseline() {
  long sum = 0;
  for (int i = 0; i < CALIBRATION_SAMPLES; i++) {
    sum += readCombinedSoundLevel();
    delay(5);
  }

  baselineLevel = sum / CALIBRATION_SAMPLES;
  quietThreshold = max(QUIET_THRESHOLD_MIN, baselineLevel + QUIET_OFFSET);
  mediumThreshold = max(MEDIUM_THRESHOLD_MIN, baselineLevel + MEDIUM_OFFSET);
  loudThreshold = max(LOUD_THRESHOLD_MIN, baselineLevel + LOUD_OFFSET);
  enforceThresholdSpacing();

  Serial.print("Initial thresholds (Q/M/H): ");
  Serial.print(quietThreshold);
  Serial.print("/");
  Serial.print(mediumThreshold);
  Serial.print("/");
  Serial.println(loudThreshold);
}

void resetSmoothingWindow() {
  total = 0;
  readIndex = 0;
  average = 0;
  for (int i = 0; i < NUM_READINGS; i++) {
    readings[i] = 0;
  }
}

void setOutputs(bool blueOn, bool greenOn, bool redOn, bool buzzerOn) {
  digitalWrite(BLUE_LED_PIN, blueOn ? HIGH : LOW);
  digitalWrite(GREEN_LED_PIN, greenOn ? HIGH : LOW);
  digitalWrite(RED_LED_PIN, redOn ? HIGH : LOW);
  digitalWrite(BUZZER_PIN, buzzerOn ? HIGH : LOW);
}

void applyStateOutputs(SoundState state) {
  bool buzzerOn = isBuzzerOn(millis());

  if (state == STATE_QUIET) {
    setOutputs(false, false, false, buzzerOn);
  } else if (state == STATE_MEDIUM_LOW) {
    setOutputs(true, false, false, buzzerOn);
  } else if (state == STATE_MEDIUM) {
    setOutputs(true, true, false, buzzerOn);
  } else {
    setOutputs(false, false, true, buzzerOn);
  }
}

const char* stateToString(SoundState state) {
  if (state == STATE_QUIET) return "Quiet";
  if (state == STATE_MEDIUM_LOW) return "Medium-Low";
  if (state == STATE_MEDIUM) return "Medium";
  return "High";
}

SoundState computeTargetState(int level) {
  if (level >= loudThreshold) return STATE_LOUD;
  if (level >= mediumThreshold) return STATE_MEDIUM;
  if (level >= quietThreshold) return STATE_MEDIUM_LOW;
  return STATE_QUIET;
}

void updateStateWithHysteresis(int level, unsigned long nowMs) {
  SoundState target = computeTargetState(level);

  if (currentState == STATE_LOUD && target != STATE_LOUD) {
    if (nowMs - loudEnteredMs < LOUD_HOLD_MS) target = STATE_LOUD;
  }
  if (currentState == STATE_QUIET && target == STATE_MEDIUM_LOW && level < quietThreshold + HYSTERESIS) {
    target = STATE_QUIET;
  }
  if (currentState == STATE_MEDIUM_LOW) {
    if (target == STATE_QUIET && level > quietThreshold - HYSTERESIS) target = STATE_MEDIUM_LOW;
    if (target == STATE_MEDIUM && level < mediumThreshold + HYSTERESIS) target = STATE_MEDIUM_LOW;
  }
  if (currentState == STATE_MEDIUM) {
    if (target == STATE_MEDIUM_LOW && level > mediumThreshold - HYSTERESIS) target = STATE_MEDIUM;
    if (target == STATE_LOUD && level < loudThreshold + HYSTERESIS) target = STATE_MEDIUM;
  }

  if (currentState != target) {
    currentState = target;
    if (currentState == STATE_LOUD) {
      loudEnteredMs = nowMs;
    }
  }
}

int mapToDbLevel(int smoothedLevel) {
  if (baselineLevel >= 4095) {
    return 30;
  }
  int mappedDb = map(smoothedLevel, baselineLevel, 4095, 30, 100);
  return constrain(mappedDb, 30, 100);
}

void enterIdleMode(const char* reason) {
  controllerMode = MODE_IDLE;
  currentState = STATE_QUIET;
  lastReportedState = STATE_QUIET;
  hasReportedState = false;
  activeSessionId = -1;
  buzzerAlarmActive = false;
  buzzerAlarmStartedMs = 0;
  setOutputs(false, false, false, false);

  if (reason != nullptr && strlen(reason) > 0) {
    Serial.print("Mode switched to IDLE: ");
    Serial.println(reason);
  }
}

void enterActiveMode() {
  controllerMode = MODE_ACTIVE;
  currentState = STATE_QUIET;
  lastReportedState = STATE_QUIET;
  hasReportedState = false;
  loudEnteredMs = 0;
  quietEnteredMs = millis();
  lastLiveSampleMs = 0;
  buzzerAlarmActive = false;
  buzzerAlarmStartedMs = 0;
  resetSmoothingWindow();

  Serial.print("Mode switched to ACTIVE | session #");
  Serial.print(activeSessionId);
  Serial.print(" | Q/M/H: ");
  Serial.print(quietThreshold);
  Serial.print("/");
  Serial.print(mediumThreshold);
  Serial.print("/");
  Serial.println(loudThreshold);
}

bool applySessionPayload(JsonVariantConst sessionNode) {
  JsonVariantConst thresholds = sessionNode["thresholds"];

  int sessionId = sessionNode["id"] | -1;
  int nextQuiet = quietThreshold;
  int nextMedium = mediumThreshold;
  int nextLoud = loudThreshold;

  if (!sessionNode["quiet_threshold"].isNull()) {
    nextQuiet = sessionNode["quiet_threshold"].as<int>();
  } else if (!thresholds["quiet"].isNull()) {
    nextQuiet = thresholds["quiet"].as<int>();
  }

  if (!sessionNode["medium_threshold"].isNull()) {
    nextMedium = sessionNode["medium_threshold"].as<int>();
  } else if (!thresholds["medium"].isNull()) {
    nextMedium = thresholds["medium"].as<int>();
  }

  if (!sessionNode["high_threshold"].isNull()) {
    nextLoud = sessionNode["high_threshold"].as<int>();
  } else if (!sessionNode["loud_threshold"].isNull()) {
    nextLoud = sessionNode["loud_threshold"].as<int>();
  } else if (!thresholds["high"].isNull()) {
    nextLoud = thresholds["high"].as<int>();
  } else if (!thresholds["loud"].isNull()) {
    nextLoud = thresholds["loud"].as<int>();
  }

  if (!validateThresholdOrder(nextQuiet, nextMedium, nextLoud)) {
    Serial.println("Ignored session payload: invalid threshold ordering/range.");
    return false;
  }

  if (sessionId < 0) {
    Serial.println("Ignored session payload: missing session id.");
    return false;
  }

  quietThreshold = nextQuiet;
  mediumThreshold = nextMedium;
  loudThreshold = nextLoud;
  activeSessionId = sessionId;
  buzzerOnLoud = sessionNode["buzzer_on_loud"] | true;

  if (!buzzerOnLoud) {
    buzzerAlarmActive = false;
    buzzerAlarmStartedMs = 0;
  }

  return true;
}

SessionFetchState fetchSessionConfig() {
  if (WiFi.status() != WL_CONNECTED) {
    return FETCH_ERROR;
  }

  HTTPClient http;
  http.begin(buildApiUrl(SESSION_CONFIG_PATH));
  http.setTimeout(HTTP_TIMEOUT_MS);

  int statusCode = http.GET();
  String body = http.getString();
  http.end();

  if (statusCode == 404) {
    return FETCH_IDLE;
  }

  if (statusCode != 200) {
    Serial.print("Session fetch failed. HTTP ");
    Serial.println(statusCode);
    return FETCH_ERROR;
  }

  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, body);
  if (error) {
    Serial.print("Session JSON parse error: ");
    Serial.println(error.c_str());
    return FETCH_ERROR;
  }

  JsonVariantConst sessionNode = doc["session"];
  if (sessionNode.isNull()) {
    Serial.println("Session payload missing session object.");
    return FETCH_ERROR;
  }

  if (!applySessionPayload(sessionNode)) {
    return FETCH_ERROR;
  }

  return FETCH_ACTIVE;
}

bool postStateChange(
  SoundState fromState,
  SoundState toState,
  int rawLevel,
  int smoothedLevel,
  unsigned long quietDurationMs
) {
  if (WiFi.status() != WL_CONNECTED) {
    return false;
  }

  HTTPClient http;
  http.begin(buildApiUrl(LOGS_PATH));
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(HTTP_TIMEOUT_MS);

  JsonDocument doc;
  doc["session_id"] = activeSessionId;
  doc["device_id"] = DEVICE_ID;
  doc["from_state"] = stateToString(fromState);
  doc["to_state"] = stateToString(toState);
  doc["state"] = stateToString(toState);
  doc["average_level"] = mapToDbLevel(smoothedLevel);
  doc["raw_level"] = rawLevel;
  doc["quiet_duration_ms"] = quietDurationMs;
  doc["uptime_ms"] = millis();
  doc["wifi_rssi"] = WiFi.RSSI();
  JsonArray sensorArray = doc["sensor_values"].to<JsonArray>();
  for (int i = 0; i < NUM_SENSORS; i++) {
    sensorArray.add(sensorValues[i]);
  }

  String payload;
  serializeJson(doc, payload);
  int statusCode = http.POST(payload);
  String response = http.getString();
  http.end();

  if (statusCode == 201 || statusCode == 200) {
    Serial.print("Logged state change: ");
    Serial.print(stateToString(fromState));
    Serial.print(" -> ");
    Serial.print(stateToString(toState));
    Serial.print(" | quiet_duration_ms=");
    Serial.println(quietDurationMs);
    return true;
  }

  if (statusCode == 404) {
    enterIdleMode("Server reports no active session.");
    return false;
  }

  Serial.print("Failed to log state change. HTTP ");
  Serial.print(statusCode);
  Serial.print(" | body: ");
  Serial.println(response);
  return false;
}

void monitorNoiseWhenActive(unsigned long nowMs) {
  int rawLevel = readCombinedSoundLevel();

  total = total - readings[readIndex];
  readings[readIndex] = rawLevel;
  total = total + readings[readIndex];
  readIndex = (readIndex + 1) % NUM_READINGS;
  average = total / NUM_READINGS;

  if (!hasReportedState) {
    currentState = computeTargetState(average);
    if (currentState == STATE_LOUD) {
      loudEnteredMs = nowMs;
      triggerBuzzerAlarm(nowMs);
    }
    if (currentState == STATE_QUIET) {
      quietEnteredMs = nowMs;
    }
    lastReportedState = currentState;
    hasReportedState = true;
    updateBuzzerAlarm(nowMs);
    applyStateOutputs(currentState);
    return;
  }

  updateStateWithHysteresis(average, nowMs);
  if (currentState == STATE_LOUD && lastReportedState != STATE_LOUD) {
    triggerBuzzerAlarm(nowMs);
  }
  updateBuzzerAlarm(nowMs);
  applyStateOutputs(currentState);

  if (currentState == lastReportedState) {
    if (nowMs - lastLiveSampleMs >= LIVE_SAMPLE_INTERVAL_MS) {
      postStateChange(currentState, currentState, rawLevel, average, 0);
      lastLiveSampleMs = nowMs;
    }
    return;
  }

  unsigned long quietDurationMs = 0;
  if (lastReportedState == STATE_QUIET && currentState != STATE_QUIET && quietEnteredMs > 0) {
    quietDurationMs = nowMs - quietEnteredMs;
  }
  if (currentState == STATE_QUIET) {
    quietEnteredMs = nowMs;
  }

  postStateChange(lastReportedState, currentState, rawLevel, average, quietDurationMs);
  lastReportedState = currentState;
  lastLiveSampleMs = nowMs;
}

void maintainWifi(unsigned long nowMs) {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }
  if (nowMs - lastWifiRetryMs < WIFI_RETRY_INTERVAL_MS) {
    return;
  }

  lastWifiRetryMs = nowMs;
  Serial.println("Wi-Fi disconnected, retrying...");
  connectToWifi();
  setupWebSocket();
}

void pollSessionState(unsigned long nowMs) {
  if (WiFi.status() != WL_CONNECTED) {
    return;
  }

  const unsigned long pollInterval =
      controllerMode == MODE_ACTIVE ? ACTIVE_SESSION_POLL_MS : IDLE_SESSION_POLL_MS;

  if (nowMs - lastSessionPollMs < pollInterval) {
    return;
  }

  lastSessionPollMs = nowMs;
  int previousSessionId = activeSessionId;
  SessionFetchState fetchState = fetchSessionConfig();

  if (fetchState == FETCH_ACTIVE) {
    if (controllerMode == MODE_IDLE || previousSessionId != activeSessionId) {
      enterActiveMode();
    }
    return;
  }

  if (fetchState == FETCH_IDLE && controllerMode == MODE_ACTIVE) {
    enterIdleMode("Session expired or stopped.");
  }
}

void printRuntimeStatus(unsigned long nowMs) {
  if (nowMs - lastLogMs < LOG_INTERVAL_MS) {
    return;
  }
  lastLogMs = nowMs;

  if (controllerMode == MODE_IDLE) {
    Serial.print("Mode: IDLE | Wi-Fi: ");
    Serial.println(wifiStatusToString(WiFi.status()));
    return;
  }

  Serial.print("Mode: ACTIVE #");
  Serial.print(activeSessionId);
  Serial.print(" | Avg ADC: ");
  Serial.print(average);
  Serial.print(" | dB: ");
  Serial.print(mapToDbLevel(average));
  Serial.print(" | State: ");
  Serial.print(stateToString(currentState));
  Serial.print(" | Q/M/H: ");
  Serial.print(quietThreshold);
  Serial.print("/");
  Serial.print(mediumThreshold);
  Serial.print("/");
  Serial.print(loudThreshold);
  Serial.print(" | Buzzer: ");
  Serial.println(buzzerOnLoud ? "ON" : "OFF");
}

void setup() {
  Serial.begin(115200);

  pinMode(BLUE_LED_PIN, OUTPUT);
  pinMode(GREEN_LED_PIN, OUTPUT);
  pinMode(RED_LED_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  setOutputs(false, false, false, false);

  for (int i = 0; i < NUM_READINGS; i++) {
    readings[i] = 0;
  }

  connectToWifi();

  delay(500);
  Serial.println("Calibrating ambient noise... Keep environment quiet.");
  calibrateBaseline();

  SessionFetchState sessionState = fetchSessionConfig();
  if (sessionState == FETCH_ACTIVE) {
    enterActiveMode();
  } else {
    enterIdleMode("Waiting for active session.");
  }

  Serial.println("LuminaQuiet ready: session-controlled HTTP mode enabled.");
}

void loop() {
  unsigned long nowMs = millis();

  maintainWifi(nowMs);
  maintainWebSocket();
  pollSessionState(nowMs);

  if (controllerMode == MODE_ACTIVE) {
    monitorNoiseWhenActive(nowMs);
  }

  printRuntimeStatus(nowMs);

  delay(LOOP_DELAY_MS);
}
