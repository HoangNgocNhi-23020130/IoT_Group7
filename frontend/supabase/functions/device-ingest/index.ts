import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const VALID_PARAMETERS = new Set(["temperature", "ph", "tds", "turbidity"]);

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

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return new Response(JSON.stringify({ error: "Missing device token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: device, error: deviceError } = await supabase
      .from("devices")
      .select("id, code, parameters")
      .eq("token", token)
      .maybeSingle();

    if (deviceError || !device) {
      return new Response(JSON.stringify({ error: "Invalid device token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const readings = Array.isArray(body) ? body : [body];
    const rows: Array<{ device_id: string; parameter: string; value: number; measured_at: string; source: string }> = [];

    for (const item of readings) {
      const r = item as Record<string, unknown>;
      const parameter = typeof r.parameter === "string" ? r.parameter.toLowerCase() : "";
      const value = typeof r.value === "number" ? r.value : Number(r.value);
      const measuredAt = typeof r.measured_at === "string" ? r.measured_at : new Date().toISOString();

      if (!VALID_PARAMETERS.has(parameter)) {
        return new Response(JSON.stringify({ error: `Unknown parameter: ${parameter || "(missing)"}` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!Number.isFinite(value)) {
        return new Response(JSON.stringify({ error: `Invalid value for ${parameter}` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (Number.isNaN(Date.parse(measuredAt))) {
        return new Response(JSON.stringify({ error: `Invalid measured_at for ${parameter}` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      rows.push({ device_id: device.id, parameter, value, measured_at: measuredAt, source: "auto" });
    }

    if (rows.length === 0) {
      return new Response(JSON.stringify({ error: "No readings provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: insertError } = await supabase.from("measurements").insert(rows);
    if (insertError) {
      return new Response(JSON.stringify({ error: "Failed to store readings" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: touchError } = await supabase
      .from("devices")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", device.id);
    if (touchError) {
      console.error("Failed to update last_seen_at:", touchError.message);
    }

    return new Response(
      JSON.stringify({ ok: true, device: device.code, stored: rows.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Unexpected server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
