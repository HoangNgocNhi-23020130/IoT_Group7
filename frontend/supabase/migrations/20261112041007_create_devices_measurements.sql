/*
# Create devices and measurements tables + demo data

1. New Tables
- `devices` (trạm quan trắc): id, name, code (unique), lat, lng, parameters (text[]), token (unique, device auth), last_seen_at, created_at.
- `measurements` (số đo): id (identity), device_id (FK -> devices), parameter (temperature|ph|tds|turbidity), value (double), measured_at, source (auto|manual), created_at.
- `latest_measurements` view: latest reading per device+parameter (security_invoker).

2. Indexes
- measurements(device_id, parameter, measured_at DESC) for history queries.

3. Security
- RLS enabled on both tables. Internal single-tenant tool with no sign-in, so policies
  are TO anon, authenticated USING (true) — data is intentionally shared inside the team.
- Grants to anon, authenticated (frontend) and service_role (ingest edge function).

4. Demo data
- 5 coastal stations; SM-HP-01 seeded with abnormal pH/turbidity to exercise pollution analysis.
- 7 days of hourly readings for 4 parameters; SM-PQ-01 seeded as offline.
*/

CREATE TABLE IF NOT EXISTS devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text UNIQUE NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  parameters text[] NOT NULL DEFAULT '{temperature,ph,tds,turbidity}',
  token text UNIQUE NOT NULL,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS measurements (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  parameter text NOT NULL,
  value double precision NOT NULL,
  measured_at timestamptz NOT NULL,
  source text NOT NULL DEFAULT 'auto' CHECK (source IN ('auto', 'manual')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_measurements_device_param_time
  ON measurements (device_id, parameter, measured_at DESC);

ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE measurements ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON devices TO anon, authenticated;
GRANT SELECT, INSERT ON measurements TO anon, authenticated;
GRANT ALL ON devices TO service_role;
GRANT ALL ON measurements TO service_role;
GRANT USAGE ON SEQUENCE measurements_id_seq TO anon, authenticated;

DROP POLICY IF EXISTS "devices_select" ON devices;
CREATE POLICY "devices_select" ON devices FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "devices_insert" ON devices;
CREATE POLICY "devices_insert" ON devices FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "devices_update" ON devices;
CREATE POLICY "devices_update" ON devices FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "devices_delete" ON devices;
CREATE POLICY "devices_delete" ON devices FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "measurements_select" ON measurements;
CREATE POLICY "measurements_select" ON measurements FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "measurements_insert" ON measurements;
CREATE POLICY "measurements_insert" ON measurements FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE OR REPLACE VIEW latest_measurements WITH (security_invoker = true) AS
SELECT DISTINCT ON (m.device_id, m.parameter)
  m.device_id, m.parameter, m.value, m.measured_at, m.source
FROM measurements m
ORDER BY m.device_id, m.parameter, m.measured_at DESC;

GRANT SELECT ON latest_measurements TO anon, authenticated;

INSERT INTO devices (name, code, lat, lng, token) VALUES
  ('Trạm Hạ Long',         'SM-HL-01', 20.9101, 107.1839, 'dvc_tk7m4hxq2rj8'),
  ('Trạm Cảng Hải Phòng',  'SM-HP-01', 20.8631, 106.6839, 'dvc_k3p9wnc5vzf1'),
  ('Trạm Sơn Trà Đà Nẵng', 'SM-DN-01', 16.1048, 108.2772, 'dvc_b8s2yq7tgm4d'),
  ('Trạm Nha Trang',       'SM-NT-01', 12.2388, 109.1967, 'dvc_r5xj9h2ewq6n'),
  ('Trạm Phú Quốc',        'SM-PQ-01', 10.2899, 107.9703, 'dvc_v4cm7ld3ps8k')
ON CONFLICT (code) DO NOTHING;

INSERT INTO measurements (device_id, parameter, value, measured_at, source)
SELECT d.id,
       p.param,
       round((
         p.base + p.amp * sin(extract(epoch FROM g.bucket) / 3600.0 * p.freq + (hashtext(d.code)::int % 97))
         + (random() - 0.5) * p.noise
       )::numeric, 2)::double precision,
       g.bucket,
       'auto'
FROM devices d
CROSS JOIN generate_series(now() - interval '7 days', now(), interval '1 hour') AS g(bucket)
JOIN (VALUES
  ('temperature', 27.5, 2.0, 0.26, 0.4),
  ('ph',          7.95, 0.5, 0.13, 0.12),
  ('tds',         31500.0, 2200.0, 0.09, 260.0),
  ('turbidity',   15.0, 8.0, 0.21, 3.5)
) AS p(param, base, amp, freq, noise) ON true;

UPDATE measurements m SET value = m.value - 0.9
FROM devices d
WHERE d.id = m.device_id AND d.code = 'SM-HP-01' AND m.parameter = 'ph';

UPDATE measurements m SET value = greatest(m.value + 28 + (random() - 0.5) * 12, 2)
FROM devices d
WHERE d.id = m.device_id AND d.code = 'SM-HP-01' AND m.parameter = 'turbidity';

UPDATE devices SET last_seen_at = CASE
  WHEN code = 'SM-PQ-01' THEN now() - interval '4 hours'
  ELSE now() - (interval '1 minute' * (1 + floor(random() * 8)))
END;
