# ThermaVax Supabase schema

1. Create a new Supabase project.
2. Open **SQL Editor**, paste `schema.sql`, and run it once.
3. Create the first account under **Authentication > Users**.
4. Promote that account with the final `UPDATE public.profiles ...` statement in the SQL file.
5. Use Supabase Auth for login and the generated Data API/RPC methods for data access.

Supabase Auth owns passwords and sessions; `public.profiles` stores only application role and account status. ThermaVax no longer uses a local SQLite database.

## Important RPCs and views

- `create_shipment(...)`: creates a shipment and reserves multiple batches atomically.
- `resolve_alert(alert_id)`: resolves an active alert with the current user's audit identity.
- `get_tracking_by_token(token)`: anonymous-safe QR tracking result.
- `batch_inventory`: batches with computed expiration status.
- `shipment_overview`: latest temperature/location and active alert count.
- `report_inventory`, `report_expiration`, `report_shipments`, `report_temperatures`, `report_deliveries`.

For ESP32/GSM ingestion, create Supabase Edge Functions that validate a device key and insert into `temperature_readings` or `gps_readings` using the server-side service-role key. The temperature trigger will create violations automatically.
