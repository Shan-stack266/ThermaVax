# ThermaVax

Cold-chain vaccine inventory, shipment, temperature, GPS, alert, delivery, and reporting system.

## Run locally

Create `.env` from `.env.example`, then set `SUPABASE_PROJECT_ID`, `SUPABASE_URL`,
and `SUPABASE_ANON_KEY`. Run `supabase/schema.sql` once in the Supabase SQL Editor.

For React development, run the Express API and Vite frontend in separate terminals:

```powershell
npm.cmd start
npm.cmd run dev
```

Open `http://localhost:5173`. Vite proxies `/api` requests to Express on port 3000.

For a production-style local run, build the React frontend and start Express:

```powershell
npm.cmd run build
npm.cmd start
```

Open `http://localhost:3000`. Express serves the generated React application from `dist/`.

For deployment, set `NODE_ENV=production` and `PUBLIC_APP_URL` to the public HTTPS
origin used in generated QR codes. Set `APP_ORIGIN` only when the frontend is hosted
on a different origin. Set `TRUST_PROXY=1` only when Express is behind one trusted
reverse proxy.

## Vercel deployment

The project includes `vercel.json` and `api/index.js` so Vercel can serve the Vite
frontend and the existing Express API from one domain. Vercel should use:

- Build command: `npm run build`
- Output directory: `dist`
- API entry point: `api/index.js`

Set these environment variables in Vercel Project Settings:

- `SUPABASE_PROJECT_ID`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SECRET_KEY`
- `THERMAVAX_DEVICE_KEY`
- `PUBLIC_APP_URL`
- `NODE_ENV=production`
- `APP_ORIGIN` only if another frontend origin calls this API
- `TRUST_PROXY=1` only if needed behind a trusted proxy

After the first deployment, set `PUBLIC_APP_URL` to the generated
`https://your-project.vercel.app` URL and add
`https://your-project.vercel.app/?reset=password` to Supabase Auth redirect URLs.

ESP32 ingestion uses ordinary HTTPS requests to `POST /api/hardware/temperature`
and can reach a Vercel deployment if the device trusts the certificate and uses the
same `THERMAVAX_DEVICE_KEY`. Vercel serverless functions do not provide a continuously
running background process, so this deployment is appropriate for request-based
ingestion, not for any future design that requires persistent sockets, MQTT listeners,
or long-running hardware workers.

For the browser live ESP32 panel, also set the browser-facing Vite variables
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. These are not secret values, but
`SUPABASE_SECRET_KEY` and `THERMAVAX_DEVICE_KEY` must remain server/device-only.

Create the first account in Supabase Authentication, then promote it in the SQL Editor:

```sql
update public.profiles set role = 'admin' where email = 'admin@example.com';
```

## Roles

- Administrators manage vaccine batches, create shipments, manage users, and export reports.
- Staff monitor shipment temperature, GPS readings, and shipment progress,
  resolve alerts, and review delivery records. Inventory is read-only
  for staff.
- Riders accept or reject assigned shipments and mark completed deliveries as delivered.

Shipment details display sensor history without manual temperature, GPS, or status controls.
Shipment progression can still be provided through the authenticated status API.
Administrators can delete unfinished shipments; assigned stock is restored by the database.
Delivered shipments are retained, and the Deliveries workspace lists their vaccine batches,
assigned doses, actual shipment-level received quantities, and confirmation details.

Staff accounts must exist under Supabase **Authentication > Users**, have a confirmed
email, and have a matching `public.profiles` row with `role = 'staff'`. A row in
`public.profiles` is not a password account by itself. When email confirmation is
enabled, the ThermaVax server uses `SUPABASE_SECRET_KEY` to create administrator-added
staff as confirmed accounts. Existing pending accounts can be confirmed from User
Management. Keep this key server-only and never place it in browser or hardware code.
If a secret key is ever posted or shared, revoke it in Supabase, create a replacement,
and update the local `.env` directly. Do not send the replacement through chat or commit it.

Password reset uses Supabase Auth. Add the value of `PUBLIC_APP_URL` plus
`/?reset=password` to the allowed redirect URLs in Supabase Authentication settings,
for example `http://localhost:3000/?reset=password` during local testing.

For a Supabase project created before the staff workspace was added, run
`supabase/staff-workspace-migration.sql` once in the Supabase SQL Editor.

For an existing project, also run `supabase/integrity-hardening-migration.sql`
once to enforce shipment transitions, validate deliveries, and reduce public
QR tracking fields.

If the project previously used development-only simulated readings, run
`supabase/remove-simulated-readings-migration.sql` once to delete those records
and reset reading defaults to manual entry.

For the staff workspace acknowledgement feature, run
`supabase/staff-workspace-enhancements-migration.sql` once in the Supabase SQL Editor.
Staff shipment filtering matches the assigned personnel field against the staff email name.

The same migration adds rider accounts and rider assignment responses. Create a rider from
User Management, then use that rider's email name in the shipment assignment field.

To store and display the ESP32-reported status exactly, run
`supabase/hardware-temperature-status-migration.sql` once in the Supabase SQL Editor.

For standalone ESP32 DS18B20 readings stored in `public.sensor_readings`, run
`supabase/sensor-readings-access-migration.sql` once in the Supabase SQL Editor.
This enables authenticated dashboard reads and Supabase Realtime events for new
rows without allowing browser users to insert device readings.

## Hardware ingestion

ESP32/GSM devices can send JSON to:

- `POST /api/hardware/temperature`
- `POST /api/hardware/gps`

Include `X-Device-Key`. Hardware ingestion requires both `THERMAVAX_DEVICE_KEY`
and the server-only `SUPABASE_SECRET_KEY`. Never expose the secret key in browser
code or on ESP32 hardware.

The adapted ESP32 temperature sender is in
`hardware/thermavax_esp32/thermavax_esp32.ino`. It uses the existing DS18B20,
LCD, LED, and buzzer wiring and sends readings over HTTPS. Configure the values
described in `hardware/thermavax_esp32/README.md` before flashing. GPS is not
included in this integration.

Temperature payload:

```json
{"tracking_code":"TVX-...","temperature":4.2,"temperature_status":"SAFE","recorded_at":"2026-09-30T08:00:00Z"}
```

`temperature_status` and `recorded_at` are optional. When `recorded_at` is omitted,
the server stores the receipt time. The dashboard recomputes display status from
the stored reading when no hardware status is stored and marks a device stale when
no recent reading is available.

Standalone device payload:

```json
{"device_id":"esp32-device-001","temperature":4.2,"status":"SAFE"}
```

Standalone readings are written to the existing `public.sensor_readings` table.
The server validates the device ID and temperature, checks any submitted status,
then stores the server-computed status using the ESP32 thresholds: below 2 C is
`CRITICAL LOW`, 2 C to below 8 C is `SAFE`, 8 C to below 11 C is `WARNING`, and
11 C or above is `CRITICAL HIGH`.

GPS payload:

```json
{"tracking_code":"TVX-...","latitude":14.5995,"longitude":120.9842,"recorded_at":"2026-09-30T08:00:00Z"}
```
