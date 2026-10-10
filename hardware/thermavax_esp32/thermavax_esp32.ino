#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClient.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <LiquidCrystal_I2C.h>

// Adapted from sketch_oct9a.ino. GPS is intentionally excluded.
#define TEMP_PIN 4
#define GREEN_LED 5
#define YELLOW_LED 14
#define RED_LED 25
#define BUZZER_PIN 26
#define LCD_SDA 16
#define LCD_SCL 15
#define LCD_ADDRESS 0x27

const char* WIFI_SSID = "CHANGE_ME";
const char* WIFI_PASSWORD = "CHANGE_ME";
// Use your deployed HTTPS URL for final testing, or your computer LAN IP for local testing.
// Example local URL: http://192.168.1.25:3000/api/hardware/temperature
const char* API_URL = "http://192.168.1.27:3000/api/hardware/temperature";
const char* DEVICE_KEY = "a59b076a9f0d2e2ac0919f230e735ef52c89096a90ab243f944d90de00e56197";
const char* TRACKING_CODE = "TVX-34F8063FE490";

// Replace with the PEM CA certificate for the API host before deployment.
// Certificate verification remains enabled; an unset/invalid certificate fails closed.
static const char* API_ROOT_CA = "-----BEGIN CERTIFICATE-----\\nREPLACE_WITH_YOUR_API_CA_CERTIFICATE\\n-----END CERTIFICATE-----\\n";

const float SAFE_MIN_C = 2.0f;
const float SAFE_MAX_C = 8.0f;
const float CRITICAL_LOW_C = 0.0f;
const float CRITICAL_HIGH_C = 10.0f;
const unsigned long SENSOR_INTERVAL_MS = 1000;
const unsigned long UPLOAD_INTERVAL_MS = 5000;
const unsigned long WIFI_RETRY_INTERVAL_MS = 10000;
const uint16_t HTTP_TIMEOUT_MS = 5000;

OneWire oneWire(TEMP_PIN);
DallasTemperature sensor(&oneWire);
LiquidCrystal_I2C lcd(LCD_ADDRESS, 16, 2);
float temperatureC = NAN;
bool sensorOK = false;
unsigned long lastSensorRead = 0;
unsigned long lastUpload = 0;
unsigned long lastWifiAttempt = WIFI_RETRY_INTERVAL_MS;
bool lastUploadSucceeded = false;
int lastUploadStatusCode = 0;

enum Status { SAFE, WARNING, CRITICAL, SENSOR_ERROR };
Status status = SENSOR_ERROR;

const char* statusText() {
  switch (status) {
    case SAFE: return "SAFE";
    case WARNING: return "WARNING";
    case CRITICAL: return "CRITICAL";
    default: return "SENSOR ERROR";
  }
}

void updateStatus() {
  if (!sensorOK) status = SENSOR_ERROR;
  else if (temperatureC < CRITICAL_LOW_C || temperatureC > CRITICAL_HIGH_C) status = CRITICAL;
  else if (temperatureC < SAFE_MIN_C || temperatureC > SAFE_MAX_C) status = WARNING;
  else status = SAFE;
}

void updateOutputs() {
  digitalWrite(GREEN_LED, LOW);
  digitalWrite(YELLOW_LED, LOW);
  digitalWrite(RED_LED, LOW);
  noTone(BUZZER_PIN);
  if (status == SAFE) digitalWrite(GREEN_LED, HIGH);
  if (status == WARNING) digitalWrite(YELLOW_LED, HIGH);
  if (status == CRITICAL || status == SENSOR_ERROR) digitalWrite(RED_LED, HIGH);
  if (status == CRITICAL) tone(BUZZER_PIN, 2000);
}

void updateLcd() {
  lcd.clear();
  lcd.setCursor(0, 0);
  if (sensorOK) {
    lcd.print("Temp: "); lcd.print(temperatureC, 1); lcd.write((uint8_t)223); lcd.print("C");
  } else lcd.print("Sensor Error!");
  lcd.setCursor(0, 1); lcd.print("Status: "); lcd.print(statusText());
}

void readTemperature() {
  sensor.requestTemperatures();
  float value = sensor.getTempCByIndex(0);
  sensorOK = value != DEVICE_DISCONNECTED_C && isfinite(value) && value >= -55.0f && value <= 125.0f;
  temperatureC = sensorOK ? value : NAN;
  updateStatus(); updateOutputs(); updateLcd();
}

void connectWifi() {
  if (WiFi.status() == WL_CONNECTED || millis() - lastWifiAttempt < WIFI_RETRY_INTERVAL_MS) return;
  lastWifiAttempt = millis();
  Serial.print("Connecting Wi-Fi to ");
  Serial.println(WIFI_SSID);
  WiFi.mode(WIFI_STA); WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

bool hasPlaceholderConfig() {
  if (String(WIFI_SSID) == "CHANGE_ME" || String(WIFI_PASSWORD) == "CHANGE_ME") {
    Serial.println("Upload blocked: set WIFI_SSID and WIFI_PASSWORD before flashing");
    return true;
  }
  if (String(API_URL).indexOf("CHANGE_ME") >= 0 || String(API_URL).indexOf("your-domain.example") >= 0) {
    Serial.println("Upload blocked: replace API_URL with your local or deployed API endpoint");
    return true;
  }
  if (String(DEVICE_KEY).length() < 16) {
    Serial.println("Upload blocked: DEVICE_KEY is missing or too short");
    return true;
  }
  if (!String(TRACKING_CODE).startsWith("TVX-")) {
    Serial.println("Upload blocked: TRACKING_CODE should match an existing shipment");
    return true;
  }
  return false;
}

bool uploadTemperature() {
  if (hasPlaceholderConfig()) return false;
  if (!sensorOK) {
    Serial.println("Upload skipped: sensor reading is invalid");
    return false;
  }
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Upload skipped: Wi-Fi is not connected");
    return false;
  }
  HTTPClient http;
  http.setTimeout(HTTP_TIMEOUT_MS);
  WiFiClient localClient;
  WiFiClientSecure secureClient;
  bool requestStarted = false;
  if (String(API_URL).startsWith("https://")) {
    secureClient.setCACert(API_ROOT_CA);
    requestStarted = http.begin(secureClient, API_URL);
  } else {
    requestStarted = http.begin(localClient, API_URL);
  }
  if (!requestStarted) {
    Serial.println("Upload failed: unable to initialize HTTP request");
    return false;
  }
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Key", DEVICE_KEY);
  String body = String("{\"tracking_code\":\"") + TRACKING_CODE
    + "\",\"temperature\":" + String(temperatureC, 2)
    + ",\"temperature_status\":\"" + statusText() + "\"}";
  int statusCode = http.POST(body);
  String response = http.getString();
  http.end();
  lastUploadStatusCode = statusCode;
  lastUploadSucceeded = statusCode >= 200 && statusCode < 300;
  Serial.print("Upload status: ");
  Serial.print(statusCode);
  Serial.print(" / ");
  Serial.println(lastUploadSucceeded ? "OK" : response);
  if (lastUploadSucceeded) {
    Serial.print("Saved reading for ");
    Serial.print(TRACKING_CODE);
    Serial.print(" at ");
    Serial.print(temperatureC, 2);
    Serial.println(" C");
  }
  return lastUploadSucceeded;
}

void setup() {
  Serial.begin(115200);
  pinMode(GREEN_LED, OUTPUT); pinMode(YELLOW_LED, OUTPUT); pinMode(RED_LED, OUTPUT); pinMode(BUZZER_PIN, OUTPUT);
  Wire.begin(LCD_SDA, LCD_SCL); lcd.init(); lcd.backlight();
  sensor.begin(); sensor.setResolution(12);
  WiFi.setAutoReconnect(true); WiFi.persistent(false);
  readTemperature();
  Serial.println("ThermaVax ESP32 telemetry ready");
  Serial.print("API URL: ");
  Serial.println(API_URL);
}

void loop() {
  unsigned long now = millis();
  connectWifi();
  if (WiFi.status() == WL_CONNECTED && lastWifiAttempt != 0) {
    Serial.print("Wi-Fi connected. ESP32 IP: ");
    Serial.println(WiFi.localIP());
    lastWifiAttempt = 0;
  }
  if (now - lastSensorRead >= SENSOR_INTERVAL_MS) { lastSensorRead = now; readTemperature(); }
  if (now - lastUpload >= UPLOAD_INTERVAL_MS) { lastUpload = now; uploadTemperature(); }
}
