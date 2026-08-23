import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3?bundle";

const projectURL = "https://winxqiisqwkoxvusrame.supabase.co";
const publishableKey = "sb_publishable_Zk0perIlTk9g8Ryk5Gt72Q_29XdesuQ";
const siteBase = "https://kshsu412.github.io/mnemesh-auth";
const consentURL = `${siteBase}/oauth/consent/`;
const callbackURL = `${siteBase}/auth/callback/`;
const storageKey = "mnemesh.oauth.authorization_id";

const supabase = createClient(projectURL, publishableKey, {
  auth: {
    flowType: "pkce",
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

const login = document.querySelector("#login");
const consent = document.querySelector("#consent");
const status = document.querySelector("#status");
const params = new URLSearchParams(location.search);
const incomingAuthorizationID = params.get("authorization_id");
if (incomingAuthorizationID) localStorage.setItem(storageKey, incomingAuthorizationID);
const authorizationID = incomingAuthorizationID || localStorage.getItem(storageKey);

const showError = (error) => {
  status.classList.add("error");
  status.textContent = error?.message || String(error);
};

const redirect = (data) => {
  const target = data?.redirect_url || data?.redirectUrl;
  if (!target) throw new Error("Supabase 沒有回傳重新導向網址。");
  localStorage.removeItem(storageKey);
  location.assign(target);
};

const initialize = async () => {
  const code = params.get("code");
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    location.replace(`${consentURL}?authorization_id=${encodeURIComponent(authorizationID || "")}`);
    return;
  }

  if (!authorizationID) throw new Error("缺少 authorization_id，請從 ChatGPT 重新連接。");
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    login.classList.remove("hidden");
    status.textContent = "先用 MNEMESH 帳號登入，再決定是否授權。";
    return;
  }

  const { data: details, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationID);
  if (error) throw error;
  document.querySelector("#client").textContent = details?.client?.name || details?.client_name || "ChatGPT";
  document.querySelector("#account").textContent = sessionData.session.user.email || "已登入 MNEMESH";
  consent.classList.remove("hidden");
  status.textContent = "確認後，ChatGPT 只會存取你的 MNEMESH 資料。";
};

document.querySelector("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  status.classList.remove("error");
  status.textContent = "正在寄送登入連結…";
  const email = document.querySelector("#email").value.trim();
  const target = `${callbackURL}?authorization_id=${encodeURIComponent(authorizationID || "")}`;
  const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: target } });
  button.disabled = false;
  if (error) showError(error);
  else status.textContent = "登入連結已寄出，請在同一個瀏覽器開啟。";
});

document.querySelector("#approve").addEventListener("click", async (event) => {
  event.currentTarget.disabled = true;
  status.textContent = "正在連接…";
  const { data, error } = await supabase.auth.oauth.approveAuthorization(authorizationID);
  if (error) {
    event.currentTarget.disabled = false;
    showError(error);
    return;
  }
  try { redirect(data); } catch (error) { showError(error); }
});

document.querySelector("#deny").addEventListener("click", async (event) => {
  event.currentTarget.disabled = true;
  const { data, error } = await supabase.auth.oauth.denyAuthorization(authorizationID);
  if (error) {
    event.currentTarget.disabled = false;
    showError(error);
    return;
  }
  try { redirect(data); } catch (error) { showError(error); }
});

initialize().catch(showError);
