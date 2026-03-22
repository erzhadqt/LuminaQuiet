#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>

// --- Wi-Fi & Server Settings ---
const char* WIFI_SSID = "ezratkyuti";
const char* WIFI_PASSWORD = "87654321";

// REPLACE 192.168.X.X with your computer's actual local IP address!
const char* SERVER_URL = "http://10.239.69.1:8000/api/current-noise/";

// Pin definitions for 3 sound sensors
const int SOUND_SENSOR_PINS[] = {34, 35, 32};  
const int NUM_SENSORS = sizeof(SOUND_SENSOR_PINS) / sizeof(SOUND_SENSOR_PINS[0]);

const int BLUE_LED_PIN = 18;       
const int GREEN_LED_PIN = 19;      
const int RED_LED_PIN = 21;        
const int BUZZER_PIN = 23;         

// Minimum threshold floor values
const int QUIET_THRESHOLD_MIN = 600;
const int MEDIUM_THRESHOLD_MIN = 1000;
const int LOUD_THRESHOLD_MIN = 2000;

// Adaptive threshold offsets
const int QUIET_OFFSET = 120;
const int MEDIUM_OFFSET = 420;
const int LOUD_OFFSET = 1000;

const int HYSTERESIS = 50;
const unsigned long LOUD_HOLD_MS = 600;
const int CALIBRATION_SAMPLES = 120;

const unsigned long LOOP_DELAY_MS = 10;
const unsigned long LOG_INTERVAL_MS = 250;
const unsigned long HTTP_POST_INTERVAL_MS = 250; // Send data to Django every 2 seconds
const unsigned long WIFI_CONNECT_TIMEOUT_MS = 20000;
const unsigned long WIFI_RETRY_INTERVAL_MS = 10000;

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

unsigned long lastLogMs = 0;
unsigned long lastHttpMs = 0;
unsigned long loudEnteredMs = 0;
unsigned long lastWifiRetryMs = 0;

enum SoundState {
  STATE_QUIET,
  STATE_MEDIUM_LOW,
  STATE_MEDIUM,
  STATE_LOUD
};

SoundState currentState = STATE_QUIET;

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

// --- Helper Functions from your original code ---
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

  if (mediumThreshold <= quietThreshold + HYSTERESIS) {
    mediumThreshold = quietThreshold + HYSTERESIS + 50;
  }
  if (loudThreshold <= mediumThreshold + HYSTERESIS) {
    loudThreshold = mediumThreshold + HYSTERESIS + 120;
  }
}

void setOutputs(bool blueOn, bool greenOn, bool redOn, bool buzzerOn) {
  digitalWrite(BLUE_LED_PIN, blueOn ? HIGH : LOW);
  digitalWrite(GREEN_LED_PIN, greenOn ? HIGH : LOW);
  digitalWrite(RED_LED_PIN, redOn ? HIGH : LOW);
  digitalWrite(BUZZER_PIN, buzzerOn ? HIGH : LOW);
}

void applyStateOutputs(SoundState state) {
  if (state == STATE_QUIET) {
    setOutputs(false, false, false, false);
  } else if (state == STATE_MEDIUM_LOW) {
    setOutputs(true, false, false, false);
  } else if (state == STATE_MEDIUM) {
    setOutputs(true, true, false, false);
  } else {
    setOutputs(false, false, true, true);
  }
}

const char* stateToString(SoundState state) {
  if (state == STATE_QUIET) return "Quiet";
  if (state == STATE_MEDIUM_LOW) return "Medium-Low";
  if (state == STATE_MEDIUM) return "Medium";
  return "Loud/Warning";
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
    if (currentState == STATE_LOUD) loudEnteredMs = nowMs;
  }
}

// --- NEW: Function to send data to Django ---
void sendDataToBackend(int rawLevel, int smoothedLevel, const char* statusStr) {
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(SERVER_URL);
    http.addHeader("Content-Type", "application/json");

    // Convert raw analog readings (0-4095) to an approximate decibel mapping for the dashboard
    // Note: You may need to tune this formula based on your specific microphone module
    int mappedDb = map(smoothedLevel, baselineLevel, 4095, 30, 100); 
    if (mappedDb < 30) mappedDb = 30;

    // Create JSON payload string manually to save memory
    String jsonPayload = "{\"average_level\":" + String(mappedDb) + 
                         ",\"raw_level\":" + String(smoothedLevel) + 
                         ",\"status\":\"" + String(statusStr) + "\"}";

    int httpResponseCode = http.POST(jsonPayload);
    
    Serial.print("HTTP POST [");
    Serial.print(httpResponseCode);
    Serial.print("] Payload: ");
    Serial.println(jsonPayload);
    
    http.end();
  } else {
    Serial.println("Wi-Fi Disconnected. Cannot send data.");
  }
}

void setup() {
  Serial.begin(115200);
  
  pinMode(BLUE_LED_PIN, OUTPUT);
  pinMode(GREEN_LED_PIN, OUTPUT);
  pinMode(RED_LED_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  setOutputs(false, false, false, false);
  
  for (int i = 0; i < NUM_READINGS; i++) readings[i] = 0;
  
  connectToWifi();

  delay(500);

  Serial.println("Calibrating ambient noise... Keep environment quiet.");
  calibrateBaseline();
  Serial.println("Sound-Activated LED System Ready (3 sensors)!");
}

void loop() {
  unsigned long nowMs = millis();

  if (WiFi.status() != WL_CONNECTED && nowMs - lastWifiRetryMs >= WIFI_RETRY_INTERVAL_MS) {
    lastWifiRetryMs = nowMs;
    Serial.println("Wi-Fi disconnected, retrying...");
    connectToWifi();
  }

  int sensorValue = readCombinedSoundLevel();
  
  total = total - readings[readIndex];
  readings[readIndex] = sensorValue;
  total = total + readings[readIndex];
  readIndex = (readIndex + 1) % NUM_READINGS;
  average = total / NUM_READINGS;

  updateStateWithHysteresis(average, nowMs);
  applyStateOutputs(currentState);

  // Send to backend every 2 seconds
  if (nowMs - lastHttpMs >= HTTP_POST_INTERVAL_MS) {
    lastHttpMs = nowMs;
    sendDataToBackend(sensorValue, average, stateToString(currentState));
  }

  // Serial Monitor Logging
  if (nowMs - lastLogMs >= LOG_INTERVAL_MS) {
    lastLogMs = nowMs;
    Serial.print("Avg: ");
    Serial.print(average);
    Serial.print(" | Status: ");
    Serial.println(stateToString(currentState));
  }

  delay(LOOP_DELAY_MS);
}