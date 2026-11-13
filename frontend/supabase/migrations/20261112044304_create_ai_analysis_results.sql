/*
# Create ai_analysis_results table for storing AI analysis output

1. New Tables
- `ai_analysis_results`: id (uuid), device_id (uuid, nullable FK -> devices ON DELETE SET NULL,
  so history survives station deletion), parameter (text), window_hours (integer),
  summary (text), anomaly_score (double precision, nullable, 0-1),
  confidence (double precision, nullable, 0-1),
  findings (jsonb, array of { title, detail }), produced_at (timestamptz), created_at (timestamptz).

2. Indexes
- ai_analysis_results(device_id, parameter, produced_at DESC) for lookups.

3. Security
- RLS enabled. Internal single-tenant tool: SELECT granted to anon, authenticated
  (future UI consumption); INSERT only via service_role (edge function using
  service key bypasses RLS but still needs the grant). No anon/authenticated INSERT —
  AI results come from the backend edge function only.
*/

CREATE TABLE IF NOT EXISTS ai_analysis_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid REFERENCES devices(id) ON DELETE SET NULL,
  parameter text NOT NULL,
  window_hours integer NOT NULL,
  summary text NOT NULL,
  anomaly_score double precision,
  confidence double precision,
  findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  produced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_analysis_results_anomaly_score_check CHECK (anomaly_score IS NULL OR (anomaly_score >= 0 AND anomaly_score <= 1)),
  CONSTRAINT ai_analysis_results_confidence_check CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1))
);

CREATE INDEX IF NOT EXISTS idx_ai_results_device_param_time
  ON ai_analysis_results (device_id, parameter, produced_at DESC);

ALTER TABLE ai_analysis_results ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON ai_analysis_results TO anon, authenticated;
GRANT INSERT ON ai_analysis_results TO service_role;

DROP POLICY IF EXISTS "ai_results_select" ON ai_analysis_results;
CREATE POLICY "ai_results_select" ON ai_analysis_results
  FOR SELECT TO anon, authenticated USING (true);
