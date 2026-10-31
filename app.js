// Owner page. Everything here is public; every action is checked server-side
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
  async function authHeaders() {
    const { data } = await sb.auth.getSession();
    return { authorization: `Bearer ${data.session?.access_token}`, apikey: PUBLISHABLE_KEY, "content-type": "application/json" };
  }

  async function api(path, body) {
    const res = await fetch(API + path, {
      method: body ? "POST" : "GET",
      headers: await authHeaders(),
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
      el("p", { class: "muted", text: "This page requires your sign-in." }), input, el("div", { class: "actions" }, btn), note));
  }

  function notOwnerView() {
    show(el("section", { class: "card" }, el("h2", { text: "This account can't open this page" }),
      el("p", { class: "muted", text: "Sign out and sign in with the owner's email." })));
  }

  async function alertView(id) {
    const { request: r } = await api(`/requests/${encodeURIComponent(id)}`);
    if (!r) return show(el("section", { class: "card" }, el("h2", { text: "Alert not found" })));
    const p = r.payload || {};
    const result = el("p", { class: "small" });
    const rows = [["Source", pretty(p.source)], ["Text found", pretty(p.quoted_text)], ["Task stopped", pretty(p.task)]];
    if (r.reason) rows.push(["Reason", r.reason]);
    const card = el("section", { class: "card" }, el("h2", { text: "Security alert" }),
      el("p", { class: `small status-${r.status}`, text: `Status: ${r.status}` }),
      el("dl", {}, ...rows.flatMap(([k, v]) => [
        el("dt", { text: k }),
        el("dd", {}, k === "Text found" ? el("pre", { class: "quote", text: v }) : v.includes("\n") ? el("pre", { text: v }) : v),
      ])));
    if (r.status === "pending" && new Date(r.expires_at) > new Date()) {
      const dismiss = el("button", { text: "Mark reviewed" });
      dismiss.addEventListener("click", async () => {
        dismiss.disabled = true;
        const out = await api(`/requests/${encodeURIComponent(r.id)}/decision`, {});
        result.textContent = out.ok ? "Marked reviewed. The task stays stopped." : out.reason;
      });
      card.append(el("p", { class: "muted small", text: "The agent stopped this task and won't follow the text above." }),
        el("div", { class: "actions" }, dismiss));
    }
    card.append(result);
    show(card, el("p", {}, el("a", { href: pageUrl(), text: "All alerts" })));
  }

  async function killSwitchCard() {
    const { kill_switch, kill_reason } = await api("/kill-switch");
    const out = el("p", { class: "small" });
    const btn = kill_switch
      ? el("button", { class: "primary", text: "Resume" })
      : el("button", { class: "danger", text: "Pause everything" });
    btn.addEventListener("click", async () => {
      const engaging = !kill_switch;
      if (!confirm(engaging ? "Pause the agent?" : "Resume the agent?")) return;
      btn.disabled = true;
      await api("/kill-switch", { engaged: engaging, reason: engaging ? "Paused from the page" : undefined });
      out.textContent = engaging ? "Paused." : "Resumed.";
      setTimeout(homeView, 600);
    });
    return el("section", { class: `card${kill_switch ? " banner" : ""}` },
      el("h2", { text: kill_switch ? "Agent is paused" : "Kill switch" }),
      el("p", { class: "muted small", text: kill_switch ? (kill_reason || "") : "Stops the agent's searches, carts and watch alerts." }),
      el("div", { class: "actions" }, btn), out);
  }

  async function areaCard() {
    const { postal_code: zip, region } = await api("/settings");
    const zipInput = el("input", { type: "text", inputmode: "numeric", maxlength: "5", autocomplete: "postal-code", "aria-label": "ZIP code", placeholder: "ZIP code" });
    const stateInput = el("input", { type: "text", maxlength: "2", autocomplete: "address-level1", "aria-label": "State", placeholder: "State, like NC" });
    zipInput.value = zip ?? "";
    stateInput.value = region ?? "";
    const save = el("button", { class: "primary", text: "Save" });
    const out = el("p", { class: "small" });
    save.addEventListener("click", async () => {
      save.disabled = true;
      const res = await api("/settings", { postal_code: zipInput.value.trim(), region: stateInput.value.trim().toUpperCase() });
      out.textContent = res.ok ? "Saved." : res.reason;
      save.disabled = false;
    });
    return el("section", { class: "card" }, el("h2", { text: "Delivery area" }),
      el("p", { class: "muted small", text: "Used to estimate tax on your carts. You enter your full address at checkout." }),
      zipInput, stateInput, el("div", { class: "actions" }, save), out);
  }

  async function storesCard() {
    const { kroger, walmart } = await api("/retailers");
    const line = (name, on) => el("p", { class: "small", text: `${name}: ${on ? "On" : "Waiting for keys"}` });
    const card = el("section", { class: "card" }, el("h2", { text: "Stores" }), line("Shopify stores", true), line("Walmart", walmart.available), line("Kroger and Harris Teeter", kroger.available));
    if (kroger.available) {
      const out = el("p", { class: "small" });
      const connect = el("button", { class: "primary", text: kroger.linked ? "Reconnect Harris Teeter account" : "Connect Harris Teeter account" });
      connect.addEventListener("click", async () => {
        connect.disabled = true;
        const res = await api("/kroger/connect", {});
        if (res.ok && res.url.startsWith("https://api.kroger.com/")) { location.href = res.url; return; }
        out.textContent = res.reason || "That didn't work.";
        connect.disabled = false;
      });
      card.append(el("p", { class: "muted small", text: kroger.linked ? "Connected. The agent can add items to your cart, but can't remove them or pay." : "Lets the agent add items to your cart. It can't remove them or pay. Without this, you get product links." }),
        el("div", { class: "actions" }, connect), out);
    }
    return card;
  }

  async function homeView() {
    const [{ requests }, ks, area, stores] = await Promise.all([api("/requests?status=pending"), killSwitchCard(), areaCard(), storesCard()]);
    const list = el("section", { class: "card" }, el("h2", { text: "Security alerts" }));
    if (!requests.length) list.append(el("p", { class: "muted", text: "Nothing waiting for you." }));
    for (const r of requests) {
      list.append(el("a", { class: "row card", href: pageUrl(`?request=${encodeURIComponent(r.id)}`) },
        el("strong", { text: "Security alert" }),
        el("div", { class: "muted small", text: `${pretty(r.payload?.source ?? "")} · expires ${relTime(r.expires_at)}` })));
    }
    show(...(action === "pause-all" ? [ks, list, area, stores] : [list, area, stores, ks]));
  }

  // ---- boot -----------------------------------------------------------------
  async function route() {
    const { data } = await sb.auth.getSession();
    signOutBtn.hidden = !data.session;
    if (!data.session) return signInView(linkError);
    try {
      if (requestId) await alertView(requestId);
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
