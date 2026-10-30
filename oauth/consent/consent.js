// Consent screen for adding the Concierge connector to Claude. Supabase Auth sends the owner
// here during sign-in. Client names come from outside, so they are rendered as text.

(() => {
  "use strict";

  if (window.top !== window.self) {
    document.body.textContent = "";
    return; // never run inside a frame
  }

  const sb = window.supabase.createClient(
    "https://vgywbnkdqhtftxthkbif.supabase.co",
    "sb_publishable_fenfBK9E3i_7IwfxwyXzZA_5Y0l5Ogg",
    { auth: { flowType: "implicit", detectSessionInUrl: true, persistSession: true, autoRefreshToken: true } },
  );

  // Claude's callback for web, desktop and mobile. Nothing else may be allowed from this screen.
  const CLAUDE_CALLBACK = "https://claude.ai/api/mcp/auth_callback";

  const app = document.getElementById("app");
  const id = new URLSearchParams(location.search).get("authorization_id");
  const line = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    node.textContent = text;
    return node;
  };
  const card = (...children) => {
    const section = document.createElement("section");
    section.className = "card";
    section.append(...children);
    app.replaceChildren(section);
  };
  const fail = (message) => card(line("h2", "", "Couldn't connect"), line("p", "muted", message));

  function signIn() {
    const input = document.createElement("input");
    Object.assign(input, { type: "email", autocomplete: "email", placeholder: "you@example.com" });
    const button = line("button", "primary", "Email me a sign-in link");
    const note = line("p", "muted small", "");
    button.addEventListener("click", async () => {
      button.disabled = true;
      const { error } = await sb.auth.signInWithOtp({ email: input.value.trim(), options: { emailRedirectTo: location.href } });
      button.disabled = false;
      note.textContent = error ? `Couldn't send the link: ${error.message}` : "Link sent. Open the newest email on this device.";
    });
    const actions = document.createElement("div");
    actions.className = "actions";
    actions.append(button);
    card(line("h2", "", "Sign in"), line("p", "muted", "Sign in to connect Concierge to Claude."), input, actions, note);
  }

  async function decide(approve, buttons) {
    buttons.forEach((b) => { b.disabled = true; });
    const { data, error } = approve
      ? await sb.auth.oauth.approveAuthorization(id, { skipBrowserRedirect: true })
      : await sb.auth.oauth.denyAuthorization(id, { skipBrowserRedirect: true });
    if (error) return fail(error.message);
    location.href = data.redirect_url;
  }

  async function start() {
    if (!id) return fail("This link is missing its details. Start again from Claude.");
    const { data: session } = await sb.auth.getSession();
    if (!session.session) return signIn();

    const { data, error } = await sb.auth.oauth.getAuthorizationDetails(id);
    if (error) return fail(error.message);
    if (!data.authorization_id) { location.href = data.redirect_url; return; }

    const allow = line("button", "primary", "Allow");
    const deny = line("button", "", "Deny");
    allow.addEventListener("click", () => decide(true, [allow, deny]));
    deny.addEventListener("click", () => decide(false, [allow, deny]));
    const actions = document.createElement("div");
    actions.className = "actions";

    if (data.redirect_uri !== CLAUDE_CALLBACK) {
      actions.append(deny);
      return card(
        line("h2", "", "This isn't Claude"),
        line("p", "muted small", `An app calling itself ${data.client?.name || "unknown"} tried to connect, but it returns to ${new URL(data.redirect_uri).hostname}, not Claude. It can't be allowed. If you didn't expect this, someone may have sent you a fake link.`),
        actions,
      );
    }
    actions.append(deny, allow);

    const list = document.createElement("ul");
    list.className = "small";
    for (const item of [
      "Read your limits, subscriptions and spending",
      "Add subscription details from your email",
      "Ask you to approve purchases and changes",
    ]) list.append(line("li", "", item));

    card(
      line("h2", "", `Connect ${data.client?.name || "this app"}?`),
      line("p", "muted small", `It will return to ${new URL(data.redirect_uri).hostname}. Only continue if you started this from Claude.`),
      line("p", "small", "It will be able to:"),
      list,
      line("p", "muted small", "It can't approve anything on your approval page, change your limits, or see card numbers."),
      actions,
    );
  }

  start().catch((e) => fail(e.message));
})();
