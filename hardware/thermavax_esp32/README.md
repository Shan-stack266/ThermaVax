# ThermaVax ESP32 temperature sender

This sketch is adapted from `sketch_oct9a.ino`. It keeps the DS18B20, LCD, LEDs, and buzzer behavior and sends temperature readings to the existing ThermaVax hardware endpoint. GPS is intentionally excluded.

Before flashing, configure `WIFI_SSID`, `WIFI_PASSWORD`, `API_URL`, `DEVICE_KEY`, `TRACKING_CODE`, and, for HTTPS deployments, `API_ROOT_CA`. The tracking code must belong to an existing, undelivered shipment. The temperature range must match that shipment's assigned vaccine batch.

For local testing on the same Wi-Fi network, start the Express server with `npm.cmd start`, find your computer's local IPv4 address, and set `API_URL` like this:

```cpp
const char* API_URL = "http://192.168.1.25:3000/api/hardware/temperature";
```

Replace `192.168.1.25` with your actual computer IP address. Make sure Windows Firewall allows the ESP32 to reach port `3000`.

The device sends every 5 seconds to `POST /api/hardware/temperature` with the `X-Device-Key` header and a JSON body containing `tracking_code`, `temperature`, and `temperature_status`. It uses a 5-second HTTP timeout, logs the HTTP status code to Serial, skips uploads while the sensor or Wi-Fi is unavailable, and keeps local monitoring active during network failures.

For deployed HTTPS testing, set `API_URL` to the public HTTPS endpoint and replace the CA placeholder with the real PEM certificate for the API host. The sketch does not disable TLS certificate verification for HTTPS.

Serial Monitor should show `Upload status: 201 / OK` when Supabase receives the reading. If it shows `401`, check `DEVICE_KEY`; if it shows `404`, check `TRACKING_CODE`; if it shows `409`, check that the shipment is not delivered and has assigned batches.

Install the OneWire, DallasTemperature, and LiquidCrystal_I2C libraries.

The original sketch remains unchanged in `C:\Users\Name\Downloads\sketch_oct9a\sketch_oct9a.ino`.
