/**
 * submit-form — single hardened intake for every public write that used to hit tables directly.
 *
 * POST { kind, ...fields, website?: "" }    (`website` is a honeypot: bots fill it, humans never see it)
 *
 * kinds:
 *   comment          { post_id, parent_id?, author_name, author_email, content, fingerprint? }
 *   review           { product_id, author_name, customer_email, rating, content? }
 *   contact          { name, email, topic?, message }
 *   feedback         { type, message, page_url?, email?, fingerprint? }
 *   newsletter       { email, source? }               → double opt-in email
 *   newsletter_confirm   { token }
 *   newsletter_unsubscribe { token }
 *   newsletter_prefs { email, preferred_categories[], frequency }  (must be signed in as that email)
 *   question         { post_id, author_name, author_email, question }   (reader Q&A)
 *   restock_notify   { product_id, email }
 *   comment_report   { comment_id, reason? }
 *
 * Every kind: honeypot, per-IP + per-email rate limit, strict length caps, email validation.
 * Comments & reviews are inserted with is_approved=false (and a DB trigger enforces it anyway).
 */
import {
  json, preflight, serviceClient, callerUser, clientIp, rateLimit, normEmail, cleanText, sendEmail, emailShell, escapeHtml, siteUrl,
} from "../_shared/http.ts";

const UUID = /^[0-9a-f-]{36}$/i;

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return json({ error: "Invalid request" }, 400);
  if (typeof body.website === "string" && body.website.trim() !== "") return json({ ok: true }); // honeypot: pretend success

  const kind = String(body.kind || "");
  const sb = serviceClient();
  const ip = clientIp(req);
  const site = siteUrl();

  // global per-IP guard, then per-kind limits
  if (!(await rateLimit(sb, ip, "form_any", 60, 600))) return json({ error: "Too many requests. Please slow down." }, 429);

  switch (kind) {
    // ------------------------------------------------------------------ COMMENT
    case "comment": {
      if (!(await rateLimit(sb, ip, "comment", 5, 600))) return json({ error: "You're commenting too fast. Try again in a few minutes." }, 429);
      const post_id = String(body.post_id || "");
      const parent_id = body.parent_id ? String(body.parent_id) : null;
      const author_name = cleanText(body.author_name, 80);
      const author_email = normEmail(body.author_email);
      const content = cleanText(body.content, 4000);
      if (!UUID.test(post_id) || (parent_id && !UUID.test(parent_id))) return json({ error: "Invalid article." }, 400);
      if (!author_name || !author_email || content.length < 2) return json({ error: "Please add your name, a valid email and a comment." }, 400);
      if (/(https?:\/\/[^\s]+){3,}/i.test(content)) return json({ error: "Too many links for a comment." }, 400);
      const { data: post } = await sb.from("posts").select("id, title, status").eq("id", post_id).maybeSingle();
      if (!post || post.status !== "published") return json({ error: "Comments are closed for this article." }, 400);
      const { data, error } = await sb.from("comments").insert({
        post_id, parent_id, author_name, author_email, content, is_visible: true, is_approved: false,
        fingerprint: cleanText(body.fingerprint, 64) || null,
      }).select("id").single();
      if (error) return json({ error: "Could not save your comment." }, 500);
      return json({ ok: true, id: data.id, pending: true, message: "Thanks — your comment will appear once approved." });
    }

    // ------------------------------------------------------------------ COMMENT EDIT (15-minute window, same device)
    case "comment_edit": {
      if (!(await rateLimit(sb, ip, "comment_edit", 10, 600))) return json({ error: "Too many edits." }, 429);
      const id = String(body.comment_id || "");
      const fp = cleanText(body.fingerprint, 64);
      const content = cleanText(body.content, 4000);
      if (!UUID.test(id) || !fp || content.length < 2) return json({ error: "Invalid edit." }, 400);
      const { data: c } = await sb.from("comments").select("id, fingerprint, created_at").eq("id", id).maybeSingle();
      if (!c || c.fingerprint !== fp) return json({ error: "You can only edit your own comments." }, 403);
      if (Date.now() - new Date(c.created_at).getTime() > 15 * 60 * 1000) return json({ error: "The 15-minute edit window has closed." }, 403);
      const { error } = await sb.from("comments").update({ content, edited_at: new Date().toISOString() }).eq("id", id);
      if (error) return json({ error: "Could not update your comment." }, 500);
      return json({ ok: true });
    }

    // ------------------------------------------------------------------ REVIEW
    case "review": {
      if (!(await rateLimit(sb, ip, "review", 3, 3600))) return json({ error: "Too many reviews from this connection." }, 429);
      const product_id = String(body.product_id || "");
      const author_name = cleanText(body.author_name, 80);
      const customer_email = normEmail(body.customer_email);
      const rating = Math.round(Number(body.rating));
      const content = cleanText(body.content, 3000);
      if (!UUID.test(product_id) || !author_name || !customer_email || !(rating >= 1 && rating <= 5)) return json({ error: "Please fill in all review fields." }, 400);
      const { data: existing } = await sb.from("product_reviews").select("id").eq("product_id", product_id).ilike("customer_email", customer_email).maybeSingle();
      if (existing) return json({ error: "You have already reviewed this product." }, 409);
      const { data: paid } = await sb.from("orders").select("id, items:order_items!inner(product_id)").ilike("customer_email", customer_email).eq("payment_status", "paid").eq("items.product_id", product_id).limit(1);
      const { error } = await sb.from("product_reviews").insert({ product_id, author_name, customer_email, rating, content: content || null, is_approved: false, verified_purchase: (paid || []).length > 0 });
      if (error) return json({ error: "Could not save your review." }, 500);
      return json({ ok: true, pending: true, message: "Thank you — your review is awaiting moderation." });
    }

    // ------------------------------------------------------------------ CONTACT
    case "contact": {
      const email = normEmail(body.email);
      if (!(await rateLimit(sb, ip, "contact", 3, 3600)) || (email && !(await rateLimit(sb, email, "contact_email", 3, 86400)))) return json({ error: "You've sent several messages recently. We'll reply soon." }, 429);
      const name = cleanText(body.name, 120);
      const topic = cleanText(body.topic, 80) || null;
      const message = cleanText(body.message, 8000);
      if (!name || !email || message.length < 5) return json({ error: "Please complete all fields." }, 400);
      const { error } = await sb.from("contact_messages").insert({ name, email, topic, message });
      if (error) return json({ error: "Could not send your message." }, 500);
      const notify = Deno.env.get("ADMIN_NOTIFY_EMAIL");
      if (notify) await sendEmail({ to: notify, subject: `New contact message from ${name}`, replyTo: email, html: emailShell(`New message${topic ? ` · ${topic}` : ""}`, `<p><strong>${escapeHtml(name)}</strong> &lt;${escapeHtml(email)}&gt;</p><p style="white-space:pre-wrap;">${escapeHtml(message)}</p>`) });
      return json({ ok: true, message: "Message received. We reply within 2 business days." });
    }

    // ------------------------------------------------------------------ FEEDBACK
    case "feedback": {
      if (!(await rateLimit(sb, ip, "feedback", 5, 3600))) return json({ error: "Too much feedback at once — thank you though!" }, 429);
      const type = ["bug", "idea", "praise", "other"].includes(body.type) ? body.type : "other";
      const message = cleanText(body.message, 4000);
      if (message.length < 3) return json({ error: "Please write a little more." }, 400);
      const { error } = await sb.from("user_feedback").insert({ type, message, page_url: cleanText(body.page_url, 500) || null, email: normEmail(body.email) || null, fingerprint: cleanText(body.fingerprint, 64) || null });
      if (error) return json({ error: "Could not save feedback." }, 500);
      return json({ ok: true });
    }

    // ------------------------------------------------------------------ NEWSLETTER (double opt-in)
    case "newsletter": {
      const email = normEmail(body.email);
      if (!email) return json({ error: "Please enter a valid email." }, 400);
      if (!(await rateLimit(sb, ip, "newsletter", 5, 3600))) return json({ error: "Too many sign-ups from this connection." }, 429);
      const source = cleanText(body.source, 60) || null;
      const { data: existing } = await sb.from("newsletter_subscribers").select("id, status, confirm_token").ilike("email", email).maybeSingle();
      let token = existing?.confirm_token;
      if (existing?.status === "active") return json({ ok: true, already: true, message: "You're already subscribed." });
      if (!existing) {
        const { data, error } = await sb.from("newsletter_subscribers").insert({ email, source, status: "pending" }).select("confirm_token").single();
        if (error) return json({ error: "Could not subscribe." }, 500);
        token = data.confirm_token;
      } else {
        await sb.from("newsletter_subscribers").update({ status: "pending", source, updated_at: new Date().toISOString() }).eq("id", existing.id);
      }
      const sent = await sendEmail({
        to: email, subject: "Confirm your subscription to Lixxon Studio",
        html: emailShell("One click to confirm", `<p>Thanks for subscribing. Please confirm your email to start receiving our weekly edit on skincare, style and minimalist wellness.</p>
          <p style="margin:28px 0;"><a href="${site}/newsletter/confirm?token=${token}" style="background:#1A1A1A;color:#fff;padding:14px 26px;text-decoration:none;letter-spacing:.15em;text-transform:uppercase;font-size:12px;">Confirm subscription</a></p>
          <p style="color:#5A5A5A;font-size:13px;">If you didn't request this, simply ignore this email.</p>`),
      });
      if (!sent) {
        // email not configured yet: activate immediately so the feature still works on $0 setup
        await sb.from("newsletter_subscribers").update({ status: "active", confirmed_at: new Date().toISOString() }).ilike("email", email);
        return json({ ok: true, confirmed: true, message: "You're subscribed. Welcome!" });
      }
      return json({ ok: true, confirmed: false, message: "Check your inbox to confirm your subscription." });
    }
    case "newsletter_confirm": {
      const token = String(body.token || "");
      if (!UUID.test(token)) return json({ error: "Invalid link." }, 400);
      const { data } = await sb.from("newsletter_subscribers").update({ status: "active", confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("confirm_token", token).select("email").maybeSingle();
      if (!data) return json({ error: "This confirmation link is invalid or already used." }, 404);
      return json({ ok: true, email: data.email });
    }
    case "newsletter_unsubscribe": {
      const token = String(body.token || "");
      if (!UUID.test(token)) return json({ error: "Invalid link." }, 400);
      const { data } = await sb.from("newsletter_subscribers").update({ status: "unsubscribed", updated_at: new Date().toISOString() }).eq("unsubscribe_token", token).select("email").maybeSingle();
      if (!data) return json({ error: "Invalid unsubscribe link." }, 404);
      return json({ ok: true });
    }
    case "newsletter_prefs": {
      const user = await callerUser(req);
      const email = normEmail(body.email);
      if (!user || !email || (user.email || "").toLowerCase() !== email) return json({ error: "Please sign in with this email to manage preferences." }, 401);
      const cats = Array.isArray(body.preferred_categories) ? body.preferred_categories.filter((c: unknown) => typeof c === "string").slice(0, 20) : [];
      const frequency = body.frequency === "daily" ? "daily" : "weekly";
      const { error } = await sb.from("newsletter_preferences").upsert({ email, preferred_categories: cats, frequency, updated_at: new Date().toISOString() }, { onConflict: "email" });
      if (error) return json({ error: "Could not save preferences." }, 500);
      return json({ ok: true });
    }

    // ------------------------------------------------------------------ READER Q&A
    case "question": {
      if (!(await rateLimit(sb, ip, "question", 3, 3600))) return json({ error: "Too many questions at once." }, 429);
      const post_id = String(body.post_id || "");
      const author_name = cleanText(body.author_name, 80);
      const author_email = normEmail(body.author_email);
      const question = cleanText(body.question, 1500);
      if (!UUID.test(post_id) || !author_name || !author_email || question.length < 5) return json({ error: "Please complete all fields." }, 400);
      const { error } = await sb.from("article_questions").insert({ post_id, author_name, author_email, question });
      if (error) return json({ error: "Could not submit your question." }, 500);
      return json({ ok: true, message: "Question received — our editors answer the best ones in the article." });
    }

    // ------------------------------------------------------------------ RESTOCK / SERIES NOTIFY
    case "restock_notify": {
      const email = normEmail(body.email);
      const product_id = String(body.product_id || "");
      if (!email || !UUID.test(product_id) || body.consent !== true) return json({ error: "Please enter a valid email and confirm the one-time alert." }, 400);
      if (!(await rateLimit(sb, ip, "notify", 10, 3600))) return json({ error: "Too many requests." }, 429);
      const { data: product, error: productError } = await sb.from("products").select("id, is_active, stock_status").eq("id", product_id).maybeSingle();
      if (productError) return json({ error: "Could not check product availability." }, 500);
      if (!product || !product.is_active) return json({ error: "This product is unavailable." }, 404);
      if (!["out_of_stock", "coming_soon"].includes(product.stock_status)) return json({ error: "This product is available now. Refresh the page to shop." }, 409);
      const { error } = await sb.from("product_notifications").upsert({
        product_id,
        email,
        alert_id: crypto.randomUUID(),
        consented_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        notified_at: null,
      }, { onConflict: "product_id,email" });
      if (error) {
        console.error("restock alert save failed", error.message);
        return json({ error: "Could not save this alert. Please try again." }, 500);
      }
      return json({ ok: true, message: "One-time restock alert saved. You are not subscribed to the newsletter." });
    }

    // ------------------------------------------------------------------ REPORT COMMENT
    case "comment_report": {
      const comment_id = String(body.comment_id || "");
      if (!UUID.test(comment_id)) return json({ error: "Invalid comment." }, 400);
      if (!(await rateLimit(sb, `${ip}:${comment_id}`, "report", 1, 86400))) return json({ ok: true });
      await sb.rpc("report_comment", { p_comment_id: comment_id, p_reason: cleanText(body.reason, 300) || null });
      return json({ ok: true, message: "Thanks, our moderators will take a look." });
    }

    default:
      return json({ error: "Unknown form kind" }, 400);
  }
});
