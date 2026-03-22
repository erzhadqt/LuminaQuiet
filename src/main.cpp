#include <Arduino.h>

// Sound-Activated LED System for ESP32
// Blue (soft), Green (medium), Red (loud) LED activation based on sound volume
// Uses 3 sound sensors to improve area coverage and response reliability

// Pin definitions for 3 sound sensors
const int SOUND_SENSOR_PINS[] = {34, 35, 32};  // Analog pins for sound sensors
const int NUM_SENSORS = sizeof(SOUND_SENSOR_PINS) / sizeof(SOUND_SENSOR_PINS[0]);

const int BLUE_LED_PIN = 18;       // GPIO pin for blue LED
const int GREEN_LED_PIN = 19;      // GPIO pin for green LED
const int RED_LED_PIN = 21;        // GPIO pin for red LED
const int BUZZER_PIN = 23;         // GPIO pin for buzzer

// Minimum threshold floor values (actual thresholds are adapted from calibration)
const int QUIET_THRESHOLD_MIN = 600;
const int MEDIUM_THRESHOLD_MIN = 1000;
const int LOUD_THRESHOLD_MIN = 2000;

// Adaptive threshold offsets above measured baseline noise
const int QUIET_OFFSET = 120;
const int MEDIUM_OFFSET = 420;
const int LOUD_OFFSET = 1000;

// Hysteresis to prevent rapid state toggling near thresholds
const int HYSTERESIS = 50;

// Keep loud alarm active for a short period to avoid chattering
const unsigned long LOUD_HOLD_MS = 600;

// Calibration settings
const int CALIBRATION_SAMPLES = 120;
const int SENSOR_MIN_VALID = 5;
const int SENSOR_MAX_VALID = 4090;

// Loop pacing and logging
const unsigned long LOOP_DELAY_MS = 10;
const unsigned long LOG_INTERVAL_MS = 250;

// Variables for smoothing the combined sound reading
const int NUM_READINGS = 10;      // Number of readings to average
int readings[NUM_READINGS];       // Array to store readings
int readIndex = 0;                // Index of current reading
int total = 0;                    // Running total
int average = 0;                  // Average value

int sensorValues[NUM_SENSORS] = {0};
int baselineLevel = 0;
int quietThreshold = QUIET_THRESHOLD_MIN;
int mediumThreshold = MEDIUM_THRESHOLD_MIN;
int loudThreshold = LOUD_THRESHOLD_MIN;

unsigned long lastLogMs = 0;
unsigned long loudEnteredMs = 0;

enum SoundState {
  STATE_QUIET,
  STATE_MEDIUM_LOW,
  STATE_MEDIUM,
  STATE_LOUD
};

SoundState currentState = STATE_QUIET;

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

  // Blend max + average for better detection:
  int avgValue = sumValues / NUM_SENSORS;
  return (maxValue + avgValue) / 2;
}

// bool sensorLooksInvalid(int value) {
//   return value <= SENSOR_MIN_VALID || value >= SENSOR_MAX_VALID;
// }

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
  if (state == STATE_MEDIUM_LOW) return "Blue LED (Medium-low)";
  if (state == STATE_MEDIUM) return "Green LED (Medium)";
  return "Red LED (Loud)";
}

SoundState computeTargetState(int level) {
  if (level >= loudThreshold) {
    return STATE_LOUD;
  }
  if (level >= mediumThreshold) {
    return STATE_MEDIUM;
  }
  if (level >= quietThreshold) {
    return STATE_MEDIUM_LOW;
  }
  return STATE_QUIET;
}

void updateStateWithHysteresis(int level, unsigned long nowMs) {
  SoundState target = computeTargetState(level);

  if (currentState == STATE_LOUD && target != STATE_LOUD) {
    if (nowMs - loudEnteredMs < LOUD_HOLD_MS) {
      target = STATE_LOUD;
    }
  }

  if (currentState == STATE_QUIET && target == STATE_MEDIUM_LOW && level < quietThreshold + HYSTERESIS) {
    target = STATE_QUIET;
  }

  if (currentState == STATE_MEDIUM_LOW) {
    if (target == STATE_QUIET && level > quietThreshold - HYSTERESIS) {
      target = STATE_MEDIUM_LOW;
    }
    if (target == STATE_MEDIUM && level < mediumThreshold + HYSTERESIS) {
      target = STATE_MEDIUM_LOW;
    }
  }

  if (currentState == STATE_MEDIUM) {
    if (target == STATE_MEDIUM_LOW && level > mediumThreshold - HYSTERESIS) {
      target = STATE_MEDIUM;
    }
    if (target == STATE_LOUD && level < loudThreshold + HYSTERESIS) {
      target = STATE_MEDIUM;
    }
  }

  if (currentState != target) {
    currentState = target;
    if (currentState == STATE_LOUD) {
      loudEnteredMs = nowMs;
    }
  }
}

void logStatus(int rawLevel, int smoothedLevel, unsigned long nowMs) {
  if (nowMs - lastLogMs < LOG_INTERVAL_MS) {
    return;
  }

  lastLogMs = nowMs;

  Serial.print("S1:");
  Serial.print(sensorValues[0]);
  Serial.print(" S2:");
  Serial.print(sensorValues[1]);
  Serial.print(" S3:");
  Serial.print(sensorValues[2]);

  // bool anyInvalid = false;
  // for (int i = 0; i < NUM_SENSORS; i++) {
  //   if (sensorLooksInvalid(sensorValues[i])) {
  //     anyInvalid = true;
  //     break;
  //   }
  // }

  Serial.print(" | Raw:");
  Serial.print(rawLevel);
  Serial.print(" Avg:");
  Serial.print(smoothedLevel);
  Serial.print(" | Thr(Q/M/L):");
  Serial.print(quietThreshold);
  Serial.print('/');
  Serial.print(mediumThreshold);
  Serial.print('/');
  Serial.print(loudThreshold);
  Serial.print(" | Status: ");
  Serial.print(stateToString(currentState));

  // if (anyInvalid) {
  //   Serial.print(" | Warning: sensor out-of-range");
  // }

  Serial.println();
}

void setup() {
  // Initialize serial communication
  Serial.begin(115200);
  
  // Initialize LED pins and Buzzer as outputs
  pinMode(BLUE_LED_PIN, OUTPUT);
  pinMode(GREEN_LED_PIN, OUTPUT);
  pinMode(RED_LED_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  
  // Initialize all LEDs and Buzzer to off
  setOutputs(false, false, false, false);
  
  // Initialize the readings array to 0
  for (int i = 0; i < NUM_READINGS; i++) {
    readings[i] = 0;
  }
  
  // Allow the sound sensor to stabilize
  delay(500);

  Serial.println("Calibrating ambient noise... Keep environment quiet.");
  calibrateBaseline();

  Serial.print("Calibration done. Baseline=");
  Serial.print(baselineLevel);
  Serial.print(" Thresholds(Q/M/L)=");
  Serial.print(quietThreshold);
  Serial.print('/');
  Serial.print(mediumThreshold);
  Serial.print('/');
  Serial.println(loudThreshold);

  Serial.println("Sound-Activated LED System Ready (3 sensors)!");
}

void loop() {
  unsigned long nowMs = millis();

  // Read combined sound value from all sensors
  int sensorValue = readCombinedSoundLevel();
  
  // Smooth the reading using a moving average
  total = total - readings[readIndex];
  readings[readIndex] = sensorValue;
  total = total + readings[readIndex];
  readIndex = (readIndex + 1) % NUM_READINGS;
  
  // Calculate the average
  average = total / NUM_READINGS;

  updateStateWithHysteresis(average, nowMs);
  applyStateOutputs(currentState);
  logStatus(sensorValue, average, nowMs);

  // Small delay for stability
  delay(LOOP_DELAY_MS);
}
