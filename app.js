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
  const wantsSetup = params.has("setup");

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
      el("p", { class: "muted", text: "Approvals require your sign-in." }), input, el("div", { class: "actions" }, btn), note));
  }

  function notOwnerView() {
    show(el("section", { class: "card" }, el("h2", { text: "This account can't approve" }),
      el("p", { class: "muted", text: "Sign out and sign in with the owner's email." })));
  }

  // ---- setup questionnaire ----------------------------------------------------
  const DRAFT_KEY = "concierge-setup-draft";
  const STARTER = {
    categories: ["Pet", "Household", "Electronics", "Groceries", "Personal care"].map((name) => ({ name })),
    vendors: ["Amazon", "Walmart", "Costco"].map((name) => ({ name, tier: "trusted" })),
    runTimes: { morning: "07:00", afternoon: "12:00", evening: "17:00", night: "22:00" },
  };
  const TIERS = [["trusted", "Trusted"], ["subscription", "Subscription"], ["higher_risk", "Higher-risk"]];

  function readDraft() {
    try { return JSON.parse(localStorage.getItem(DRAFT_KEY)) || {}; } catch { return {}; }
  }
  function writeDraft(draft) {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { /* the form works without a draft */ }
  }
  function clearDraft() {
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* nothing to clear */ }
  }

  // Dollars as typed → cents. Blank is null; anything else unreadable is NaN.
  function toCents(value) {
    const s = String(value ?? "").trim().replace(/[$,]/g, "");
    if (!s) return null;
    return /^\d+(\.\d{1,2})?$/.test(s) ? Math.round(Number(s) * 100) : NaN;
  }

  function moneyInput(label, value, hint, help) {
    const input = el("input", { type: "text", inputmode: "decimal", autocomplete: "off", "aria-label": label, placeholder: hint || "$" });
    input.value = value ?? "";
    return { input, field: el("label", { class: "field" }, el("span", { class: "small", text: label }), input,
      help ? el("span", { class: "muted small help", text: help }) : null) };
  }

  function capRow(row, list, kind, redraw) {
    const name = el("input", { type: "text", autocomplete: "off", "aria-label": `${kind} name`, placeholder: `${kind} name` });
    name.value = row.name ?? "";
    const monthly = moneyInput("Monthly limit", row.monthly, "None");
    const each = moneyInput("Limit per purchase", row.each, "None");
    const remove = el("button", { class: "link", type: "button", text: "Remove" });
    const sync = () => Object.assign(row, { name: name.value, monthly: monthly.input.value, each: each.input.value });
    remove.addEventListener("click", () => { list.forEach((r) => r.sync()); list.splice(list.indexOf(row), 1); redraw(); });
    const box = el("div", { class: "cap-row" }, name, el("div", { class: "pair" }, monthly.field, each.field));
    row.sync = sync;
    if (kind === "Vendor") {
      const tier = el("select", { "aria-label": "Trust tier" }, ...TIERS.map(([v, t]) => el("option", { value: v, text: t })));
      tier.value = row.tier ?? "trusted";
      row.sync = () => { sync(); row.tier = tier.value; };
      box.append(tier);
    }
    box.append(remove);
    return box;
  }

  function capList(rows, kind) {
    const holder = el("div");
    const redraw = () => holder.replaceChildren(...rows.map((r) => capRow(r, rows, kind, redraw)));
    redraw();
    const add = el("button", { type: "button", text: `Add ${kind.toLowerCase()}` });
    add.addEventListener("click", () => { rows.forEach((r) => r.sync()); rows.push({}); redraw(); });
    return el("div", {}, holder, el("div", { class: "actions" }, add));
  }

  function setupView() {
    const draft = readDraft();
    const g = draft.general || {};
    const monthly = moneyInput("Monthly limit", g.monthly, "$400", "The most the agent can spend in a calendar month.");
    const each = moneyInput("Limit per purchase", g.each, "$150", "The most it can spend on any one purchase.");
    const threshold = moneyInput("Email approval above", g.threshold, "$75", "At or below this amount, you approve in the Claude chat. Above it, you get an email and approve on this page, which Claude can't reach.");
    const retry = moneyInput("Retry budget per task", g.retry, "$5", "When something fails, the agent tries another way, and those tries can cost a little, such as paid price lookups. Past this amount on one task, it stops and asks you. This isn't money for the item itself.");
    const categories = (draft.categories || STARTER.categories).map((r) => ({ ...r }));
    const vendors = (draft.vendors || STARTER.vendors).map((r) => ({ ...r }));
    const exclusions = el("textarea", { rows: "3", "aria-label": "Subscriptions never to test", placeholder: "One per line" });
    exclusions.value = draft.exclusions ?? "";
    const balance = moneyInput("Apple Cash balance now", draft.balance, "$0", "All the money the agent can reach. It can't spend past this, even if a limit above is higher.");
    const times = { ...STARTER.runTimes, ...draft.runTimes };
    const timeInputs = Object.keys(STARTER.runTimes).map((run) => {
      const input = el("input", { type: "time", "aria-label": `${run} run` });
      input.value = times[run];
      return { run, input, field: el("label", { class: "field" }, el("span", { class: "small", text: run[0].toUpperCase() + run.slice(1) }), input) };
    });
    const errorList = el("ul", { class: "errors small" });
    const send = el("button", { class: "primary", text: "Review for approval" });

    const collect = () => {
      [...categories, ...vendors].forEach((r) => r.sync());
      const strip = ({ sync, ...r }) => r;
      return {
        general: { monthly: monthly.input.value, each: each.input.value, threshold: threshold.input.value, retry: retry.input.value },
        categories: categories.map(strip),
        vendors: vendors.map(strip),
        exclusions: exclusions.value,
        balance: balance.input.value,
        runTimes: Object.fromEntries(timeInputs.map((t) => [t.run, t.input.value])),
      };
    };

    const showErrors = (errors) => errorList.replaceChildren(...errors.map((e) => el("li", { text: e })));

    send.addEventListener("click", async () => {
      const d = collect();
      writeDraft(d);
      const row = ({ name, monthly, each, tier }) => ({ name, monthlyCents: toCents(monthly), perPurchaseCents: toCents(each), ...(tier ? { tier } : {}) });
      const answers = {
        general: {
          monthlyCents: toCents(d.general.monthly),
          perPurchaseCents: toCents(d.general.each),
          approvalPageThresholdCents: toCents(d.general.threshold),
          retryCostThresholdCents: toCents(d.general.retry),
        },
        categories: d.categories.map(row),
        vendors: d.vendors.map(row),
        retentionExclusions: d.exclusions.split("\n").map((m) => m.trim()).filter(Boolean),
        startingBalanceCents: toCents(d.balance) ?? 0,
        runTimes: d.runTimes,
      };
      const required = [["Monthly limit", d.general.monthly], ["Limit per purchase", d.general.each],
        ["Email approval above", d.general.threshold], ["Retry budget per task", d.general.retry]];
      const errors = required.filter(([, v]) => toCents(v) === null).map(([k]) => `${k} is required.`);
      const amounts = [...Object.values(d.general), d.balance, ...[...d.categories, ...d.vendors].flatMap((r) => [r.monthly, r.each])];
      if (amounts.some((v) => Number.isNaN(toCents(v)))) errors.push("Amounts must be dollars, like 150 or 12.50.");
      if (errors.length) return showErrors(errors);

      send.disabled = true;
      try {
        const out = await api("/setup", answers);
        if (out.ok) { location.href = pageUrl(`?request=${encodeURIComponent(out.id)}`); return; }
        showErrors(out.errors || ["Setup wasn't saved."]);
      } catch (e) {
        showErrors([e.message]);
      }
      send.disabled = false;
    });

    show(
      el("section", { class: "card" }, el("h2", { text: "1. Overall limits" }),
        el("p", { class: "muted small", text: "Required. These apply to everything the agent buys." }),
        monthly.field, each.field, threshold.field, retry.field),
      el("section", { class: "card" }, el("h2", { text: "2. Categories" }),
        el("p", { class: "muted small", text: "Optional extra limits for a type of purchase. Leave a box blank and only the overall limits apply. When several limits apply, the lowest one wins. Remove any type you don't need." }), capList(categories, "Category")),
      el("section", { class: "card" }, el("h2", { text: "3. Vendors" }),
        el("p", { class: "muted small", text: "Stores you know, with optional limits for each. Trusted: one card that works only at that store and is reused. Subscription: the same kind of card, for one recurring charge. Higher-risk: a new one-time card for each purchase. Stores not listed here also get one-time cards." }), capList(vendors, "Vendor")),
      el("section", { class: "card" }, el("h2", { text: "4. Subscriptions to leave alone" }),
        el("p", { class: "muted small", text: "A retention test starts cancelling a subscription to see if the company offers a better deal, then stops before the final step. List any the agent should never try this on, one per line." }), exclusions),
      el("section", { class: "card" }, el("h2", { text: "5. Wallet and daily checks" }),
        balance.field,
        el("p", { class: "muted small", text: "The agent checks prices, restocks and new email four times a day, at these Eastern times." }),
        el("div", { class: "pair" }, ...timeInputs.map((t) => t.field))),
      el("section", { class: "card" }, el("h2", { text: "6. Review" }),
        el("p", { class: "muted small", text: "Next you'll see everything you entered. Nothing takes effect until you approve it." }),
        errorList, el("div", { class: "actions" }, send)),
    );
  }

  async function setupCard() {
    const { configured, pending_request_id: pending } = await api("/setup");
    if (configured) { clearDraft(); return null; }
    return el("section", { class: "card banner" }, el("h2", { text: "Finish setup" }),
      el("p", { class: "muted small", text: "Set your caps and vendors so the agent has an approved config." }),
      el("p", {}, el("a", { href: pageUrl(pending ? `?request=${encodeURIComponent(pending)}` : "?setup=1"), text: pending ? "Review your setup" : "Start setup" })));
  }

  function detailRows(r) {
    const rows = [];
    const p = r.payload || {};
    if (r.type === "change" && p.kind === "setup") {
      rows.push(["Setup", pretty(p.summary)]);
    } else if (r.type === "purchase") {
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

  async function walletCard() {
    const { balance_cents: balance } = await api("/wallet");
    const amount = moneyInput("Amount you just added", "", "$20", "Add money to Apple Cash first, then enter only the amount you added, not your new balance. The agent can't do this for you.");
    const save = el("button", { class: "primary", text: "Add to total" });
    const out = el("p", { class: "small" });
    save.addEventListener("click", async () => {
      const cents = toCents(amount.input.value);
      if (!cents) { out.textContent = "Enter an amount in dollars, like 50 or 12.50."; return; }
      if (!confirm(`Record a ${money(cents)} top-up?`)) return;
      save.disabled = true;
      try {
        const res = await api("/wallet/top-up", { amount_cents: cents });
        if (res.ok) return homeView();
        out.textContent = res.reason;
      } catch (e) {
        out.textContent = e.message;
      }
      save.disabled = false;
    });
    return el("section", { class: "card" }, el("h2", { text: "Apple Cash wallet" }),
      el("p", { class: "total", text: money(balance) }),
      el("p", { class: "muted small", text: "Total balance. Read-only: it changes only when you add money below or a charge settles." }),
      amount.field, el("div", { class: "actions" }, save), out);
  }

  async function homeView() {
    const [{ requests }, ks, setup, wallet] = await Promise.all([api("/requests?status=pending"), killSwitchCard(), setupCard(), walletCard()]);
    const list = el("section", { class: "card" }, el("h2", { text: "Pending" }));
    if (!requests.length) list.append(el("p", { class: "muted", text: "Nothing waiting for you." }));
    for (const r of requests) {
      list.append(el("a", { class: "row card", href: pageUrl(`?request=${encodeURIComponent(r.id)}`) },
        el("strong", { text: `${TITLES[r.type]}${r.amount_cents != null ? ` · ${money(r.amount_cents)}` : ""}` }),
        el("div", { class: "muted small", text: `${pretty(r.payload?.summary ?? r.payload?.item_title ?? r.payload?.merchant ?? "")} · expires ${relTime(r.expires_at)}` })));
    }
    show(...[setup, ...(action === "pause-all" ? [ks, list, wallet] : [list, wallet, ks])].filter(Boolean));
  }

  // ---- boot -----------------------------------------------------------------
  async function route() {
    const { data } = await sb.auth.getSession();
    signOutBtn.hidden = !data.session;
    if (!data.session) return signInView(linkError);
    try {
      if (requestId) await requestView(requestId);
      else if (wantsSetup) setupView();
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
