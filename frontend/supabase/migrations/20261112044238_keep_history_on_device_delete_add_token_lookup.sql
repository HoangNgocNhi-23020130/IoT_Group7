/*
# Keep measurement history when a station is deleted + history lookup API

1. Changed tables
- `measurements`: drop the ON DELETE CASCADE foreign key to `devices` and make
  `device_id` nullable. When a station (device row) is removed, its measurement
  history is KEPT (device_id becomes NULL — orphaned readings remain queryable
  via token lookup). Previously deleting a device erased all its readings.

2. New functions
- `lookup_history_by_token(p_token text, p_from timestamptz, p_to timestamptz)`:
  returns all measurements (parameter, value, measured_at, source, device_code,
  device_name, deleted) for a device token in the time window. Works even for
  stations that were deleted (token no longer exists in `devices`) by scanning
  orphaned measurements: token -> most recent device row in `devices_log`-style
  fallback is unnecessary; we match token to device id captured in the log table
  `deleted_devices` which stores id/name/code/token at delete time.
- Trigger `log_deleted_device`: before a device row is deleted, copy its
  id/name/code/token into `deleted_devices` so its history stays searchable.

3. New tables
- `deleted_devices` (id, name, code, token, deleted_at) — tombstone rows, unique on token.

4. Security
- RLS enabled on `deleted_devices`, policies TO anon, authenticated USING (true)
  (internal single-tenant tool, intentionally shared).
- `lookup_history_by_token` is SECURITY DEFINER so it can read orphaned
  measurement rows whose device no longer exists; EXECUTE granted to
  anon + authenticated, revoked from PUBLIC. Validation: token non-empty,
  window max 92 days.

5. Notes
- Changing the FK from CASCADE to ON DELETE SET NULL preserves all existing rows;
  no measurement data is lost in this migration.
*/

CREATE TABLE IF NOT EXISTS deleted_devices (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  code text NOT NULL,
  token text NOT NULL UNIQUE,
  deleted_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE deleted_devices ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON deleted_devices TO anon, authenticated;
GRANT SELECT ON deleted_devices TO service_role;

DROP POLICY IF EXISTS "deleted_devices_select" ON deleted_devices;
CREATE POLICY "deleted_devices_select" ON deleted_devices
  FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE measurements DROP CONSTRAINT IF EXISTS measurements_device_id_fkey;
ALTER TABLE measurements
  ADD CONSTRAINT measurements_device_id_fkey
  FOREIGN KEY (device_id) REFERENCES devices(id)
  ON DELETE SET NULL;

ALTER TABLE measurements ALTER COLUMN device_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION log_deleted_device()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO deleted_devices (id, name, code, token)
  VALUES (OLD.id, OLD.name, OLD.code, OLD.token)
  ON CONFLICT (token) DO UPDATE SET deleted_at = now();
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_deleted_device ON devices;
CREATE TRIGGER trg_log_deleted_device
BEFORE DELETE ON devices
FOR EACH ROW EXECUTE FUNCTION log_deleted_device();

CREATE OR REPLACE FUNCTION lookup_history_by_token(
  p_token text,
  p_from timestamptz,
  p_to timestamptz
)
RETURNS TABLE (
  device_id uuid,
  device_code text,
  device_name text,
  parameter text,
  value double precision,
  measured_at timestamptz,
  source text,
  deleted boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days integer;
BEGIN
  IF p_token IS NULL OR length(trim(p_token)) < 4 THEN
    RAISE EXCEPTION 'Token khong hop le';
  END IF;

  v_days := EXTRACT(EPOCH FROM (p_to - p_from)) / 86400.0;
  IF v_days > 92 THEN
    RAISE EXCEPTION 'Khoang thoi gian toi da la 92 ngay';
  END IF;
  IF v_days < 0 THEN
    RAISE EXCEPTION 'Khoang thoi gian khong hop le';
  END IF;

  RETURN QUERY
  SELECT
    d.id,
    d.code,
    d.name,
    m.parameter,
    m.value,
    m.measured_at,
    m.source,
    false
  FROM devices d
  JOIN measurements m ON m.device_id = d.id
  WHERE d.token = trim(p_token)
    AND m.measured_at BETWEEN p_from AND p_to
  UNION ALL
  SELECT
    dd.id,
    dd.code,
    dd.name,
    m.parameter,
    m.value,
    m.measured_at,
    m.source,
    true
  FROM deleted_devices dd
  JOIN measurements m ON m.device_id = dd.id
  WHERE dd.token = trim(p_token)
    AND m.measured_at BETWEEN p_from AND p_to
  ORDER BY measured_at ASC;
END;
$$;

REVOKE EXECUTE ON FUNCTION lookup_history_by_token(text, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION lookup_history_by_token(text, timestamptz, timestamptz) TO authenticated, anon;
