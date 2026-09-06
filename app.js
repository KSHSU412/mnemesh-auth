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
const setBusy = value => { busy = value; controls.forEach(button => { button.disabled = value; }); };
const returnToConsent = () => location.replace(`${consentURL}?authorization_id=${encodeURIComponent(authorizationID || "")}`);

const showError = (error) => {
  status.classList.add("error");
  // Provider errors can contain auth codes or other sensitive details.
  status.textContent = "無法完成操作，請再試一次；若仍失敗，請從 ChatGPT 重新連接 MNEMESH。";
};

const redirect = (data) => {
  const target = data?.redirect_url || data?.redirectUrl;
  if (!target || new URL(target).protocol !== "https:") throw new Error("Invalid redirect");
  location.assign(target);
};

const initialize = async () => {
  if (!authorizationID) {
    status.classList.add("error");
    status.textContent = "這不是完整的授權連結，請從 ChatGPT 重新連接 MNEMESH。";
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
    try {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) throw error;
      returnToConsent();
    } catch {
      status.classList.add("error");
      status.textContent = "登入連結已失效，或不是在發起登入的瀏覽器開啟。請重新登入。";
      retry.classList.remove("hidden");
    }
    return;
  }
  if (location.pathname.includes("/auth/callback")) { returnToConsent(); return; }
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (!sessionData.session) {
    login.classList.remove("hidden");
    status.textContent = "請使用與手機 App 相同的登入方式。";
    return;
  }

  const { data: details, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationID);
  if (error) throw error;
  if (details?.redirect_url || details?.redirectUrl) { redirect(details); return; }
  document.querySelector("#client").textContent = details?.client?.name || details?.client_name || "AI 應用程式";
  document.querySelector("#account").textContent = sessionData.session.user.email || "已登入 MNEMESH";
  consent.classList.remove("hidden");
  consentReady = true;
  status.textContent = "確認上方帳號是你在手機使用的帳號，再允許連接。";
};

const action = (selector, fn) => document.querySelector(selector)?.addEventListener("click", async () => {
  if (busy || !authorizationID) return;
  setBusy(true);
  status.classList.remove("error");
  try { await fn(); } catch (error) { showError(error); } finally { setBusy(false); }
});
action("#apple", async () => {
  status.textContent = "正在前往 Apple…";
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "apple", options: { redirectTo: `${callbackURL}?authorization_id=${encodeURIComponent(authorizationID)}` },
  });
  if (error) throw error;
});
action("#retry", async () => returnToConsent());
action("#switch-account", async () => {
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) throw error;
  consentReady = false;
  consent.classList.add("hidden");
  login.classList.remove("hidden");
  status.textContent = "請使用與手機 App 相同的登入方式。";
});
document.querySelector("#login-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy || !authorizationID) return;
  setBusy(true);
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
  status.textContent = "正在連接…";
  const { data, error } = await supabase.auth.oauth.approveAuthorization(authorizationID);
  if (error) throw error;
  redirect(data);
});

action("#deny", async () => {
  if (!consentReady) return;
  const { data, error } = await supabase.auth.oauth.denyAuthorization(authorizationID);
  if (error) throw error;
  redirect(data);
});

initialize().catch(showError);
