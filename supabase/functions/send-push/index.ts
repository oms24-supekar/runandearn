// Edge function to send a Web Push notification to a user.
// Body: { user_id: string, title: string, body: string, url?: string }
// Auth required. Caller must be the same user_id (or we just trust JWT user).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.58.0/cors";
import webpush from "https://esm.sh/web-push@3.6.7";

interface Payload {
  title: string;
  body: string;
  url?: string;
  target_user_id?: string; // optional override (defaults to caller)
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY");
    const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY");
    const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:noreply@example.com";
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      return new Response(JSON.stringify({ error: "VAPID keys not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsRes, error: claimsErr } = await supabase.auth.getClaims(token);
    if (claimsErr || !claimsRes?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const callerId = claimsRes.claims.sub as string;

    const payload = (await req.json()) as Payload;
    if (!payload?.title || !payload?.body) {
      return new Response(JSON.stringify({ error: "title and body required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use service role to read subscriptions (RLS blocks cross-user access otherwise)
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const targetUser = payload.target_user_id ?? callerId;
    const { data: subs, error: subsErr } = await admin
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", targetUser);

    if (subsErr) {
      return new Response(JSON.stringify({ error: subsErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

    const notification = JSON.stringify({
      title: payload.title,
      body: payload.body,
      url: payload.url ?? "/",
    });

    const results = await Promise.allSettled(
      (subs ?? []).map((s) =>
        webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          notification
        )
      )
    );

    // Clean up dead subscriptions (410 Gone / 404)
    const dead: string[] = [];
    results.forEach((r, i) => {
      if (r.status === "rejected") {
        const status = (r.reason as { statusCode?: number })?.statusCode;
        if (status === 404 || status === 410) {
          dead.push(subs![i].id);
        }
      }
    });
    if (dead.length > 0) {
      await admin.from("push_subscriptions").delete().in("id", dead);
    }

    const sent = results.filter((r) => r.status === "fulfilled").length;
    return new Response(JSON.stringify({ sent, total: results.length }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("send-push error:", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
