// Consent screen for adding the Steward connector to an AI assistant. Supabase Auth sends each
// family member here during sign-in. Client names come from outside, so they are rendered as text.

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

  // Approved assistants' callbacks. Nothing else may be allowed from this screen. ChatGPT gives each
  // connector its own path, and Supabase Auth still requires the exact address to be registered.
  const CLAUDE_CALLBACK = "https://claude.ai/api/mcp/auth_callback";
  const CHATGPT_CALLBACK = /^https:\/\/chatgpt\.com\/connector\/oauth\/[A-Za-z0-9_-]+$/;
  const approvedCallback = (uri) => uri === CLAUDE_CALLBACK || CHATGPT_CALLBACK.test(uri);

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
    card(line("h2", "", "Sign in"), line("p", "muted", "Sign in with the email address your invite was sent to."), input, actions, note);
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
    if (!id) return fail("This link is missing its details. Start again from your AI assistant.");
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

    if (!approvedCallback(data.redirect_uri)) {
      actions.append(deny);
      return card(
        line("h2", "", "This app isn't approved"),
        line("p", "muted small", `An app calling itself ${data.client?.name || "unknown"} tried to connect, but it returns to ${new URL(data.redirect_uri).hostname}. It can't be allowed. If you didn't expect this, someone may have sent you a fake link.`),
        actions,
      );
    }
    actions.append(deny, allow);

    const list = document.createElement("ul");
    list.className = "small";
    for (const item of [
      "Read every profile in your household",
      "Save changes you confirm, if your role allows it",
      "Suggest gift ideas",
    ]) list.append(line("li", "", item));

    card(
      line("h2", "", `Connect ${data.client?.name || "this app"}?`),
      line("p", "muted small", `It will return to ${new URL(data.redirect_uri).hostname}. Only continue if you started this from your AI assistant.`),
      line("p", "small", "It will be able to:"),
      list,
      line("p", "muted small", "Your access can be ended by the household's owner at any time."),
      actions,
    );
  }

  start().catch((e) => fail(e.message));
})();
