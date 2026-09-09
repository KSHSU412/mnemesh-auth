import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3?bundle";

const projectURL = "https://winxqiisqwkoxvusrame.supabase.co";
const publishableKey = "sb_publishable_Zk0perIlTk9g8Ryk5Gt72Q_29XdesuQ";
const siteBase = "https://kshsu412.github.io/mnemesh-auth";
const consentURL = `${siteBase}/oauth/consent/`;
const callbackURL = `${siteBase}/auth/callback/`;

const supabase = createClient(projectURL, publishableKey, {
  auth: {
    flowType: "pkce",
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

const login = document.querySelector("#login");
const consent = document.querySelector("#consent");
const status = document.querySelector("#status");
const params = new URLSearchParams(location.search);
// Never reuse an authorization request from another browser tab.
const authorizationID = params.get("authorization_id");
const retry = document.querySelector("#retry");
const controls = document.querySelectorAll("button[data-auth]");
let busy = false;
let consentReady = false;
let displayedUserID = null;
let existingRedirect = null;
let phase = "initialize";
// Tab-local, bounded diagnostics. Never record URLs, codes, tokens, emails,
// user IDs, request IDs, provider messages, or workout data.
const diagnosticKey = "mnemesh.oauth.diagnostics.v1";
const safeCategory = error => {
  if (error?.code === "account_changed") return "account_changed";
  if (["session_not_found", "refresh_token_not_found", "refresh_token_already_used", "bad_jwt", "user_not_found"].includes(error?.code)
      || error?.status === 401) return "session_expired";
  if (["authorization_not_found", "oauth_authorization_not_found", "authorization_expired"].includes(error?.code)
      || error?.status === 404 || error?.status === 410) return "request_expired";
  if (error?.status === 429) return "rate_limited";
  return "retryable";
};
const record = category => {
  try {
    const previous = JSON.parse(sessionStorage.getItem(diagnosticKey) || "[]");
    const entries = Array.isArray(previous) ? previous.filter(e =>
      e && typeof e.at === "string" && ["initialize", "exchange", "session", "details", "apple", "email", "switch", "approve", "deny"].includes(e.phase)
      && ["started", "ready", "session_expired", "request_expired", "account_changed", "rate_limited", "retryable"].includes(e.category)
    ).map(e => ({ at: e.at, phase: e.phase, category: e.category })) : [];
    sessionStorage.setItem(diagnosticKey, JSON.stringify([...entries, { at: new Date().toISOString(), phase, category }].slice(-30)));
  } catch { /* Private browsing/storage failures must not block sign-in. */ }
};
const setBusy = value => { busy = value; controls.forEach(button => { button.disabled = value; }); };
const returnToConsent = () => location.replace(`${consentURL}?authorization_id=${encodeURIComponent(authorizationID || "")}`);

const showError = (error) => {
  const category = safeCategory(error);
  record(category);
  status.classList.add("error");
  const messages = {
    session_expired: "登入已失效。請重新使用與手機相同的 Apple 帳號登入，再允許連接。",
    request_expired: "這次授權連結已過期。請回到 ChatGPT 的 MuMesh 設定重新連接，不要重複使用舊網址。",
    account_changed: "瀏覽器帳號已變更，尚未授權。請重新載入並核對帳號識別碼。",
    rate_limited: "嘗試次數較多，請稍候再試。不要連續重複登入。",
    retryable: "暫時無法完成操作，請再試一次；若仍失敗，請從 ChatGPT 重新連接 MuMesh。",
  };
  status.textContent = `${messages[category]}（${phase} / ${category}）`;
  if (["session_expired", "account_changed", "request_expired"].includes(category)) {
    consentReady = false;
    consent?.classList.add("hidden");
  }
  if (category === "session_expired" && login) login.classList.remove("hidden");
  if (category !== "request_expired") retry?.classList.remove("hidden");
};

const redirect = (data) => {
  const target = data?.redirect_url || data?.redirectUrl;
  if (!target || new URL(target).protocol !== "https:") throw new Error("Invalid redirect");
  location.assign(target);
};

const initialize = async () => {
  record("started");
  if (!authorizationID) {
    status.classList.add("error");
    status.textContent = "這不是完整的授權連結，請從 ChatGPT 重新連接 MuMesh。";
    return;
  }
  const code = params.get("code");
  const providerError = params.get("error") || new URLSearchParams(location.hash.slice(1)).get("error");
  if (code || providerError) {
    history.replaceState(null, "", `${location.pathname}?authorization_id=${encodeURIComponent(authorizationID)}`);
  }
  if (providerError) {
    status.classList.add("error");
    status.textContent = providerError === "access_denied" ? "登入已取消，你可以重新嘗試。" : "登入未完成，請重新嘗試。";
    retry.classList.remove("hidden");
    return;
  }
  if (code) {
    phase = "exchange";
    try {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) throw error;
      returnToConsent();
    } catch {
      record("session_expired");
      status.classList.add("error");
      status.textContent = "登入連結已失效，或不是在發起登入的瀏覽器開啟。請重新登入。";
      retry.classList.remove("hidden");
    }
    return;
  }
  if (location.pathname.includes("/auth/callback")) { returnToConsent(); return; }
  phase = "session";
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (!sessionData.session) {
    login.classList.remove("hidden");
    status.textContent = "請使用與手機 App 相同的登入方式。";
    return;
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!userData?.user?.id) throw { code: "session_not_found" };
  displayedUserID = userData.user.id;
  phase = "details";
  const { data: details, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationID);
  if (error) throw error;
  // Even a previously approved grant must not silently connect the wrong
  // browser account after the phone switches identity.
  existingRedirect = details?.redirect_url || details?.redirectUrl ? details : null;
  document.querySelector("#client").textContent = details?.client?.name || details?.client_name || "AI 應用程式";
  document.querySelector("#account").textContent = userData.user.email || "已登入 MuMesh";
  document.querySelector("#account-reference").textContent = displayedUserID.toLowerCase();
  consent.classList.remove("hidden");
  consentReady = true;
  status.textContent = "請與手機「設定 → 連接 ChatGPT」的帳號識別碼核對，再允許連接。";
  record("ready");
};

const action = (selector, fn) => document.querySelector(selector)?.addEventListener("click", async () => {
  if (busy || !authorizationID) return;
  setBusy(true);
  status.classList.remove("error");
  try { await fn(); } catch (error) { showError(error); } finally { setBusy(false); }
});
action("#apple", async () => {
  phase = "apple";
  status.textContent = "正在前往 Apple…";
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "apple", options: { redirectTo: `${callbackURL}?authorization_id=${encodeURIComponent(authorizationID)}` },
  });
  if (error) throw error;
});
action("#retry", async () => returnToConsent());
action("#switch-account", async () => {
  phase = "switch";
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) throw error;
  consentReady = false;
  displayedUserID = null;
  existingRedirect = null;
  consent.classList.add("hidden");
  login.classList.remove("hidden");
  status.textContent = "請使用與手機 App 相同的登入方式。";
});
document.querySelector("#login-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy || !authorizationID) return;
  setBusy(true);
  phase = "email";
  status.classList.remove("error");
  status.textContent = "正在寄送登入連結…";
  const email = document.querySelector("#email").value.trim();
  const target = `${callbackURL}?authorization_id=${encodeURIComponent(authorizationID || "")}`;
  try {
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: target, shouldCreateUser: false } });
    if (error) throw error;
    status.textContent = "登入連結已寄出，請在同一個瀏覽器開啟。";
  } catch (error) { showError(error); } finally { setBusy(false); }
});

action("#approve", async () => {
  if (!consentReady) return;
  phase = "approve";
  status.textContent = "正在連接…";
  await verifyDisplayedAccount();
  if (existingRedirect) { redirect(existingRedirect); return; }
  const { data, error } = await supabase.auth.oauth.approveAuthorization(authorizationID);
  if (error) throw error;
  redirect(data);
});

action("#deny", async () => {
  if (!consentReady) return;
  phase = "deny";
  await verifyDisplayedAccount();
  const { data, error } = await supabase.auth.oauth.denyAuthorization(authorizationID);
  if (error) throw error;
  redirect(data);
});

const verifyDisplayedAccount = async () => {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data?.user?.id) throw { code: "session_not_found" };
  if (data.user.id !== displayedUserID) throw { code: "account_changed" };
};

initialize().catch(showError);
