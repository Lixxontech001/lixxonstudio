import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const flutterwaveSecret = Deno.env.get("FLW_SECRET_KEY");
const resendApiKey = Deno.env.get("RESEND_API_KEY");

const supabase = createClient(supabaseUrl, serviceRoleKey);

interface EntitlementResult {
  product_id: string;
  product_name: string;
  download_token: string;
  file_path: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { transaction_id, tx_ref, order_id, expected_amount, expected_currency } = await req.json();

    if (!transaction_id || !tx_ref || !order_id) {
      return new Response(
        JSON.stringify({ verified: false, error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!flutterwaveSecret) {
      return new Response(
        JSON.stringify({ verified: false, error: "Payment verification not configured. Set FLW_SECRET_KEY edge function secret." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch order from database — server is authoritative
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id, order_number, amount, currency, payment_status, status, customer_email, customer_name")
      .eq("id", order_id)
      .maybeSingle();

    if (orderError || !order) {
      return new Response(
        JSON.stringify({ verified: false, error: "Order not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Idempotency: already paid — return existing entitlements
    if (order.payment_status === "paid") {
      const { data: existingEntitlements } = await supabase
        .from("download_entitlements")
        .select("download_token, file_path, product_id, product:products(name)")
        .eq("order_id", order_id);

      const entitlementResults: EntitlementResult[] = (existingEntitlements || []).map((e: any) => ({
        product_id: e.product_id,
        product_name: e.product?.name || "Digital Product",
        download_token: e.download_token,
        file_path: e.file_path,
      }));

      return new Response(
        JSON.stringify({ verified: true, status: "success", message: "Order already paid", entitlements: entitlementResults, customer_email: order.customer_email }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify transaction reference matches
    if (order.order_number !== tx_ref) {
      return new Response(
        JSON.stringify({ verified: false, error: "Transaction reference mismatch" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify with Flutterwave API
    const verifyResponse = await fetch(
      `https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`,
      {
        headers: {
          "Authorization": `Bearer ${flutterwaveSecret}`,
          "Content-Type": "application/json",
        },
      }
    );

    const verifyData = await verifyResponse.json();

    if (!verifyData || verifyData.status !== "success") {
      await supabase
        .from("orders")
        .update({ payment_status: "failed", status: "failed", payment_reference: String(transaction_id) })
        .eq("id", order_id);

      return new Response(
        JSON.stringify({ verified: false, error: "Flutterwave verification failed", status: "failed" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const tx = verifyData.data;

    if (tx.status !== "successful") {
      await supabase
        .from("orders")
        .update({ payment_status: tx.status === "cancelled" ? "cancelled" : "failed", status: "failed", payment_reference: String(transaction_id) })
        .eq("id", order_id);

      return new Response(
        JSON.stringify({ verified: false, error: `Transaction ${tx.status}`, status: tx.status }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate amount
    const txAmount = parseFloat(tx.amount);
    const expectedAmt = parseFloat(String(expected_amount));
    if (Math.abs(txAmount - expectedAmt) > 0.01) {
      await supabase
        .from("orders")
        .update({ payment_status: "failed", status: "failed", payment_reference: String(transaction_id) })
        .eq("id", order_id);

      return new Response(
        JSON.stringify({ verified: false, error: "Amount mismatch" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate currency
    if (tx.currency !== expected_currency) {
      await supabase
        .from("orders")
        .update({ payment_status: "failed", status: "failed", payment_reference: String(transaction_id) })
        .eq("id", order_id);

      return new Response(
        JSON.stringify({ verified: false, error: "Currency mismatch" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // All checks passed — mark order as paid
    const { error: updateError } = await supabase
      .from("orders")
      .update({
        payment_status: "paid",
        status: "fulfilled",
        payment_reference: String(transaction_id),
        payment_provider: "flutterwave",
        updated_at: new Date().toISOString(),
      })
      .eq("id", order_id);

    if (updateError) {
      return new Response(
        JSON.stringify({ verified: false, error: "Failed to update order" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch order items with product file paths
    const { data: orderItems } = await supabase
      .from("order_items")
      .select("id, product_id, product_name, product_slug, quantity")
      .eq("order_id", order_id);

    // Create download entitlements for digital products (server-side, authoritative)
    const entitlementResults: EntitlementResult[] = [];

    for (const item of (orderItems || [])) {
      if (!item.product_id) continue;

      const { data: product } = await supabase
        .from("products")
        .select("id, name, file_path, is_digital, product_type")
        .eq("id", item.product_id)
        .maybeSingle();

      if (!product || (!product.is_digital && product.product_type !== "digital")) continue;
      if (!product.file_path) continue;

      for (let i = 0; i < (item.quantity || 1); i++) {
        const token = crypto.randomUUID();
        const { error: entError } = await supabase.from("download_entitlements").insert({
          order_id: order_id,
          customer_email: order.customer_email,
          product_id: item.product_id,
          file_path: product.file_path,
          download_token: token,
          download_count: 0,
          max_downloads: 5,
          expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        });

        if (!entError) {
          entitlementResults.push({
            product_id: item.product_id,
            product_name: product.name,
            download_token: token,
            file_path: product.file_path,
          });
        }
      }
    }

    // Send email via Resend if configured
    if (resendApiKey && entitlementResults.length > 0) {
      try {
        const downloadLinks = entitlementResults.map(e =>
          `<tr><td style="padding:12px 0;border-bottom:1px solid #eee;"><strong>${e.product_name}</strong></td><td style="padding:12px 0;border-bottom:1px solid #eee;text-align:right;"><a href="${supabaseUrl}/functions/v1/verify-payment?token=${e.download_token}" style="color:#b8860b;text-decoration:none;font-weight:600;">Download &rarr;</a></td></tr>`
        ).join("");

        const emailHtml = `<!DOCTYPE html><html><body style="font-family:Georgia,serif;max-width:560px;margin:0 auto;padding:24px;color:#2a2a2a;">
<h1 style="font-size:28px;font-weight:300;color:#2a2a2a;margin:0 0 8px;">Your Lixxon Studio Downloads</h1>
<p style="color:#666;font-size:14px;">Hi ${order.customer_name || "there"},</p>
<p style="color:#333;font-size:15px;line-height:1.6;">Thank you for your purchase! Your order <strong>${order.order_number}</strong> is confirmed. Your digital downloads are ready:</p>
<table style="width:100%;border-collapse:collapse;margin:16px 0;">${downloadLinks}</table>
<p style="color:#333;font-size:15px;line-height:1.6;">Each download link can be used up to 5 times and expires in 30 days.</p>
<p style="color:#999;font-size:13px;margin-top:24px;">Lixxon Studio</p>
</body></html>`;

        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${resendApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "Lixxon Studio <noreply@lixxonstudio.com>",
            to: [order.customer_email],
            subject: `Your Downloads — Order ${order.order_number}`,
            html: emailHtml,
          }),
        });
      } catch (emailErr) {
        console.error("Email send failed:", emailErr);
      }
    }

    return new Response(
      JSON.stringify({
        verified: true,
        status: "success",
        order_id,
        order_number: order.order_number,
        customer_email: order.customer_email,
        entitlements: entitlementResults,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ verified: false, error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
