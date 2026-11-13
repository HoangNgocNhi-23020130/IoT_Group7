import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// POST /ai-analysis
// Body: { device_code, parameter, window_hours, summary, anomaly_score,
//         confidence?, findings?: [{ title, detail }], produced_at? }
// Stores AI analysis results for later consumption; no UI reads this yet.

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const deviceCode = typeof body.device_code === "string" ? body.device_code.trim().toUpperCase() : "";
    const parameter = typeof body.parameter === "string" ? body.parameter.trim().toLowerCase() : "";
    const summary = typeof body.summary === "string" ? body.summary.trim() : "";

    if (!deviceCode || !parameter || !summary) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: device_code, parameter, summary" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const windowHours = typeof body.window_hours === "number"
      ? body.window_hours
      : Number(body.window_hours ?? 24);
    if (!Number.isFinite(windowHours) || windowHours <= 0 || windowHours > 24 * 92) {
      return new Response(JSON.stringify({ error: "window_hours must be between 0 and 2208" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let anomalyScore: number | null = null;
    if (body.anomaly_score !== undefined && body.anomaly_score !== null) {
      const raw = typeof body.anomaly_score === "number" ? body.anomaly_score : Number(body.anomaly_score);
      if (!Number.isFinite(raw) || raw < 0 || raw > 1) {
        return new Response(JSON.stringify({ error: "anomaly_score must be between 0 and 1" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      anomalyScore = raw;
    }

    let confidence: number | null = null;
    if (body.confidence !== undefined && body.confidence !== null) {
      const raw = typeof body.confidence === "number" ? body.confidence : Number(body.confidence);
      if (!Number.isFinite(raw) || raw < 0 || raw > 1) {
        return new Response(JSON.stringify({ error: "confidence must be between 0 and 1" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      confidence = raw;
    }

    let findings: Array<{ title: string; detail: string }> = [];
    if (body.findings !== undefined) {
      if (!Array.isArray(body.findings)) {
        return new Response(JSON.stringify({ error: "findings must be an array" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      for (const f of body.findings) {
        const item = f as Record<string, unknown>;
        const title = typeof item?.title === "string" ? item.title.trim() : "";
        const detail = typeof item?.detail === "string" ? item.detail.trim() : "";
        if (!title || !detail) {
          return new Response(
            JSON.stringify({ error: "Each finding must have title and detail" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        findings.push({ title, detail });
      }
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: device, error: deviceError } = await supabase
      .from("devices")
      .select("id, code")
      .eq("code", deviceCode)
      .maybeSingle();

    if (deviceError || !device) {
      return new Response(JSON.stringify({ error: `Unknown device_code: ${deviceCode}` }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: result, error: insertError } = await supabase
      .from("ai_analysis_results")
      .insert({
        device_id: device.id,
        parameter,
        window_hours: windowHours,
        summary,
        anomaly_score: anomalyScore,
        confidence,
        findings,
        produced_at: typeof body.produced_at === "string" ? body.produced_at : new Date().toISOString(),
      })
      .select("id, produced_at")
      .single();

    if (insertError) {
      return new Response(JSON.stringify({ error: "Failed to store analysis result" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ ok: true, id: result.id, stored_at: result.produced_at }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (_err) {
    return new Response(
      JSON.stringify({ error: "Unexpected server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
