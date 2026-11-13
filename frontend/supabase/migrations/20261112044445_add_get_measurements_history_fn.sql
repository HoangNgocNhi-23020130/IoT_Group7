/*
# Add get_measurements_history backend function

1. New functions
- `get_measurements_history(p_device_id uuid, p_from timestamptz, p_to timestamptz)`:
  returns measurements for one device in a time window. The frontend calls this
  instead of querying the measurements table directly, so table access can later
  be locked down without breaking the app. Validates the window (max 92 days,
  from before to).

2. Security
- SECURITY DEFINER with fixed search_path; EXECUTE granted to anon + authenticated,
  revoked from PUBLIC.
*/

CREATE OR REPLACE FUNCTION get_measurements_history(
  p_device_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
RETURNS TABLE (
  id bigint,
  device_id uuid,
  parameter text,
  value double precision,
  measured_at timestamptz,
  source text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_device_id IS NULL THEN
    RAISE EXCEPTION 'Thieu ma tram';
  END IF;
  IF p_to - p_from > interval '92 days' THEN
    RAISE EXCEPTION 'Khoang thoi gian toi da la 92 ngay';
  END IF;
  IF p_to <= p_from THEN
    RAISE EXCEPTION 'Khoang thoi gian khong hop le';
  END IF;

  RETURN QUERY
  SELECT m.id, m.device_id, m.parameter, m.value, m.measured_at, m.source
  FROM measurements m
  WHERE m.device_id = p_device_id
    AND m.measured_at BETWEEN p_from AND p_to
  ORDER BY m.measured_at ASC;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_measurements_history(uuid, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_measurements_history(uuid, timestamptz, timestamptz) TO anon, authenticated;
