// Approval page. Everything here is public; every action is checked server-side
// against the owner's Supabase Auth session. All request content is rendered as
// text (never HTML), because it can contain text copied from web pages and email.

(() => {
  "use strict";

  if (window.top !== window.self) {
    document.body.textContent = "";
    return; // never run inside a frame
  }

  const SUPABASE_URL = "https://vgywbnkdqhtftxthkbif.supabase.co";
  const PUBLISHABLE_KEY = "sb_publishable_fenfBK9E3i_7IwfxwyXzZA_5Y0l5Ogg";
  const API = `${SUPABASE_URL}/functions/v1/approvals`;

  const sb = window.supabase.createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    auth: { flowType: "implicit", detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
  });

  const app = document.getElementById("app");
  const signOutBtn = document.getElementById("sign-out");
  const params = new URLSearchParams(location.search);
  const requestId = params.get("request");
  const action = params.get("action");

  // Supabase reports a failed sign-in link in the URL hash. Read it once, then clear it.
  const hash = new URLSearchParams(location.hash.slice(1));
  const LINK_ERRORS = {
    otp_expired: "That sign-in link has expired or was already used. Request a new one, and open only the newest email.",
  };
  const linkError = hash.get("error_code")
    ? LINK_ERRORS[hash.get("error_code")] || `Sign-in failed: ${hash.get("error_description") || hash.get("error_code")}`
    : null;
  if (linkError) history.replaceState(null, "", location.pathname + location.search);

  function sendError(error) {
    if (error.status === 429 || /rate limit/i.test(error.message)) {
      return "Too many sign-in emails in the last hour. Wait a while, then try again.";
    }
    return `Couldn't send the link: ${error.message}`;
  }

  // ---- tiny DOM helper (text only) ----------------------------------------
  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") node.className = v;
      else if (k === "onclick") node.addEventListener("click", v);
      else if (k === "text") node.textContent = v;
      else node.setAttribute(k, v);
    }
    for (const c of children) if (c != null) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return node;
  }
  const show = (...nodes) => app.replaceChildren(...nodes);
  const money = (c) => `$${(c / 100).toFixed(2)}`;
  const pretty = (v) => (v == null ? "" : typeof v === "string" ? v : JSON.stringify(v, null, 2));
  const pageUrl = (q = "") => location.origin + location.pathname + q;

  function relTime(iso) {
    const ms = new Date(iso).getTime() - Date.now();
    const h = Math.round(Math.abs(ms) / 36e5);
    const m = Math.round(Math.abs(ms) / 6e4);
    const span = h >= 1 ? `${h} h` : `${m} min`;
    return ms >= 0 ? `in ${span}` : `${span} ago`;
  }

  // ---- API ------------------------------------------------------------------
  async function api(path, body) {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    const res = await fetch(API + path, {
      method: body ? "POST" : "GET",
      headers: { authorization: `Bearer ${token}`, apikey: PUBLISHABLE_KEY, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (res.status === 401) throw Object.assign(new Error("not-owner"), { code: 401 });
    if (!res.ok && !("ok" in json)) throw new Error(json.error || `Error ${res.status}`);
    return json;
  }

  // ---- views ----------------------------------------------------------------
  function signInView(message) {
    const input = el("input", { type: "email", autocomplete: "email", placeholder: "you@example.com", "aria-label": "Email" });
    const btn = el("button", { class: "primary", text: "Email me a sign-in link" });
    const note = el("p", { class: "muted small", text: message || "" });
    btn.addEventListener("click", async () => {
      const email = input.value.trim();
      if (!email) return;
      btn.disabled = true;
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: pageUrl(location.search) } });
      btn.disabled = false;
      note.textContent = error ? sendError(error) : `Link sent to ${email}. Open the newest email on this device.`;
    });
    show(el("section", { class: "card" }, el("h2", { text: "Sign in" }),
      el("p", { class: "muted", text: "Approvals require your sign-in." }), input, el("div", { class: "actions" }, btn), note));
  }

  function notOwnerView() {
    show(el("section", { class: "card" }, el("h2", { text: "This account can't approve" }),
      el("p", { class: "muted", text: "Sign out and sign in with the owner's email." })));
  }

  function detailRows(r) {
    const rows = [];
    const p = r.payload || {};
    if (r.type === "purchase") {
      rows.push(["Item", pretty(p.item_title ?? p.item)], ["Vendor", pretty(p.vendor)]);
      if (r.amount_cents != null) rows.push(["Landed price", money(r.amount_cents)]);
      if (p.card_type) rows.push(["Card", `${p.card_type}, limit ${money(Number(p.card_limit_cents))}`]);
      if (p.ship_to_label) rows.push(["Ship to", pretty(p.ship_to_label)]);
      if (p.caps) rows.push(["Caps", pretty(p.caps)]);
    } else if (r.type === "change") {
      rows.push(["What", pretty(p.summary ?? p.kind)], ["Before", pretty(r.before_value)], ["After", pretty(r.after_value)]);
    } else if (r.type === "retention_test") {
      rows.push(["Subscription", pretty(p.merchant)]);
    } else {
      rows.push(["Source", pretty(p.source)], ["Text found", pretty(p.quoted_text)], ["Task paused", pretty(p.task)]);
    }
    if (r.reason) rows.push(["Reason", r.reason]);
    rows.push(["Expires", `${new Date(r.expires_at).toLocaleString()} (${relTime(r.expires_at)})`]);
    return el("dl", {}, ...rows.flatMap(([k, v]) => [
      el("dt", { text: k }),
      el("dd", {}, k === "Text found" ? el("pre", { class: "quote", text: v }) : v.includes("\n") ? el("pre", { text: v }) : v),
    ]));
  }

  const TITLES = {
    purchase: "Purchase",
    change: "Change",
    retention_test: "Retention test",
    injection_alert: "Security alert",
  };

  async function requestView(id) {
    const { request: r } = await api(`/requests/${encodeURIComponent(id)}`);
    if (!r) return show(el("section", { class: "card" }, el("h2", { text: "Request not found" })));
    const result = el("p", { class: "small" });
    const card = el("section", { class: "card" },
      el("h2", { text: `${TITLES[r.type]}${r.amount_cents != null ? ` · ${money(r.amount_cents)}` : ""}` }),
      el("p", { class: `small status-${r.status}`, text: `Status: ${r.status}` }),
      detailRows(r));

    const pending = r.status === "pending" && new Date(r.expires_at) > new Date();
    if (pending && r.type !== "injection_alert") {
      const approve = el("button", { class: "primary", text: "Approve" });
      const reject = el("button", { text: "Reject" });
      const decide = async (decision) => {
        if (decision === "approve" && r.type !== "purchase" && !confirm("Approve this change?")) return;
        approve.disabled = reject.disabled = true;
        try {
          const out = await api(`/requests/${encodeURIComponent(r.id)}/decision`, { decision });
          result.textContent = out.ok ? `Done: ${out.status}.` : `Not applied: ${out.reason}`;
          if (out.ok) setTimeout(() => requestView(id), 800);
          else approve.disabled = reject.disabled = false;
        } catch (e) {
          result.textContent = e.message;
          approve.disabled = reject.disabled = false;
        }
      };
      approve.addEventListener("click", () => decide("approve"));
      reject.addEventListener("click", () => decide("reject"));
      card.append(el("div", { class: "actions" }, reject, approve));
    } else if (pending) {
      const dismiss = el("button", { text: "Mark reviewed" });
      dismiss.addEventListener("click", async () => {
        dismiss.disabled = true;
        const out = await api(`/requests/${encodeURIComponent(r.id)}/decision`, { decision: "reject" });
        result.textContent = out.ok ? "Marked reviewed. The task stays stopped." : out.reason;
      });
      card.append(el("p", { class: "muted small", text: "The agent stopped this task and won't follow the text above. Clearing the domain's higher-risk flag is a separate change request." }),
        el("div", { class: "actions" }, dismiss));
    }
    card.append(result);
    show(card, el("p", {}, el("a", { href: pageUrl(), text: "All pending requests" })));
  }

  async function killSwitchCard() {
    const { kill_switch, kill_reason } = await api("/kill-switch");
    const out = el("p", { class: "small" });
    const btn = kill_switch
      ? el("button", { class: "primary", text: "Resume" })
      : el("button", { class: "danger", text: "Pause everything" });
    btn.addEventListener("click", async () => {
      const engaging = !kill_switch;
      if (!confirm(engaging ? "Pause all cards, purchases and checkouts?" : "Resume the agent?")) return;
      btn.disabled = true;
      await api("/kill-switch", { engaged: engaging, reason: engaging ? "Paused from the approval page" : undefined });
      out.textContent = engaging ? "Paused." : "Resumed.";
      setTimeout(homeView, 600);
    });
    return el("section", { class: `card${kill_switch ? " banner" : ""}` },
      el("h2", { text: kill_switch ? "Agent is paused" : "Kill switch" }),
      el("p", { class: "muted small", text: kill_switch ? (kill_reason || "") : "Pauses every agent card, stops checkouts and turns watches to notify-only." }),
      el("div", { class: "actions" }, btn), out);
  }

  async function homeView() {
    const [{ requests }, ks] = await Promise.all([api("/requests?status=pending"), killSwitchCard()]);
    const list = el("section", { class: "card" }, el("h2", { text: "Pending" }));
    if (!requests.length) list.append(el("p", { class: "muted", text: "Nothing waiting for you." }));
    for (const r of requests) {
      list.append(el("a", { class: "row card", href: pageUrl(`?request=${encodeURIComponent(r.id)}`) },
        el("strong", { text: `${TITLES[r.type]}${r.amount_cents != null ? ` · ${money(r.amount_cents)}` : ""}` }),
        el("div", { class: "muted small", text: `${pretty(r.payload?.summary ?? r.payload?.item_title ?? r.payload?.merchant ?? "")} · expires ${relTime(r.expires_at)}` })));
    }
    show(action === "pause-all" ? ks : list, action === "pause-all" ? list : ks);
  }

  // ---- boot -----------------------------------------------------------------
  async function route() {
    const { data } = await sb.auth.getSession();
    signOutBtn.hidden = !data.session;
    if (!data.session) return signInView(linkError);
    try {
      if (requestId) await requestView(requestId);
      else await homeView();
    } catch (e) {
      if (e.code === 401) return notOwnerView();
      show(el("section", { class: "card" }, el("h2", { text: "Something went wrong" }), el("p", { class: "muted", text: e.message })));
    }
  }

  signOutBtn.addEventListener("click", async () => { await sb.auth.signOut(); route(); });
  sb.auth.onAuthStateChange((event) => { if (event === "SIGNED_IN" || event === "SIGNED_OUT") route(); });
  route();
})();
