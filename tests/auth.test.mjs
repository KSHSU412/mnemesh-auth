import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8').replace(/^import .*;\n/, '');
async function setup({ search = '?authorization_id=request-A', path = '/mnemesh-auth/oauth/consent/', hash = '', signedIn = false, overrides = {} } = {}) {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) {
      const classes = new Set(['#login', '#consent', '#retry'].includes(id) ? ['hidden'] : []);
      nodes.set(id, { textContent: '', value: 'old@example.com', disabled: false, listeners: {},
        classList: { add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x) },
        addEventListener(kind, fn) { this.listeners[kind] = fn; } });
    }
    return nodes.get(id);
  };
  const calls = [];
  const record = (name, result) => async arg => { calls.push([name, arg]); return result; };
  const auth = {
    getSession: record('session', { data: { session: signedIn ? { user: { email: 'owner@example.com' } } : null } }),
    signInWithOAuth: record('apple', {}), signInWithOtp: record('email', {}), signOut: record('signout', {}),
    exchangeCodeForSession: record('exchange', {}),
    oauth: {
      getAuthorizationDetails: record('details', { data: { client: { name: 'ChatGPT' } } }),
      approveAuthorization: record('approve', { data: { redirect_url: 'https://chatgpt.com/callback' } }),
      denyAuthorization: record('deny', { data: { redirect_url: 'https://chatgpt.com/callback' } }),
    }, ...overrides,
  };
  const context = { URL, URLSearchParams, createClient: (_, __, config) => {
    assert.equal(config.auth.flowType, 'pkce'); assert.equal(config.auth.detectSessionInUrl, false); return { auth };
  }, document: {
    querySelector: id => path.includes('/auth/callback') && !['#status', '#retry'].includes(id) ? null : node(id),
    querySelectorAll: () => ['#apple', '#send', '#approve', '#deny', '#retry', '#switch-account'].map(node),
  }, location: { search, pathname: path, hash, assign: x => calls.push(['redirect', x]), replace: x => calls.push(['replace', x]) },
  history: { replaceState: (...args) => calls.push(['cleanURL', args[2]]) } };
  vm.runInNewContext(source, context);
  await new Promise(resolve => setImmediate(resolve));
  return { node, calls, click: async id => node(id).listeners.click(), submit: async () => node('#login-form').listeners.submit({ preventDefault() {} }) };
}

test('anonymous flow shows login; Apple receives the request-specific PKCE callback', async () => {
  const s = await setup();
  assert.equal(s.node('#login').classList.contains('hidden'), false);
  await s.click('#apple');
  const arg = s.calls.find(x => x[0] === 'apple')[1];
  assert.equal(arg.provider, 'apple');
  assert.equal(arg.options.redirectTo, 'https://kshsu412.github.io/mnemesh-auth/auth/callback/?authorization_id=request-A');
  assert.equal(s.calls.some(x => x[0] === 'approve'), false);
});
test('missing authorization fails closed without stale storage or login requests', async () => {
  const s = await setup({ search: '' }); await s.click('#apple');
  assert.equal(s.calls.length, 0); assert.match(s.node('#status').textContent, /完整/);
});
test('email is recovery only, never creates a new account', async () => {
  const s = await setup(); await s.submit();
  assert.equal(s.calls.find(x => x[0] === 'email')[1].options.shouldCreateUser, false);
});
test('OAuth network failure is retryable and never exposes provider secrets', async () => {
  const s = await setup({ overrides: { signInWithOAuth: async () => { throw new Error('secret=not-for-display'); } } });
  await s.click('#apple');
  assert.equal(s.node('#apple').disabled, false); assert.doesNotMatch(s.node('#status').textContent, /not-for-display/);
});
test('callback removes code from address before exchange and returns to exact consent', async () => {
  const s = await setup({ path: '/mnemesh-auth/auth/callback/', search: '?authorization_id=request-B&code=one-time' });
  assert.equal(s.calls[0][0], 'cleanURL'); assert.doesNotMatch(s.calls[0][1], /code=/);
  assert.deepEqual(s.calls.find(x => x[0] === 'exchange'), ['exchange', 'one-time']);
  assert.match(s.calls.find(x => x[0] === 'replace')[1], /request-B$/);
});
test('cancelled OAuth never exchanges a code or approves; retry preserves request', async () => {
  const s = await setup({ path: '/mnemesh-auth/auth/callback/', hash: '#error=access_denied' });
  assert.equal(s.node('#retry').classList.contains('hidden'), false);
  assert.match(s.node('#status').textContent, /取消/); await s.click('#retry');
  assert.equal(s.calls.some(x => ['exchange', 'approve'].includes(x[0])), false);
  assert.match(s.calls.at(-1)[1], /request-A$/);
});
test('expired or wrong-browser callback offers a fresh login', async () => {
  const s = await setup({ path: '/mnemesh-auth/auth/callback/', search: '?authorization_id=request-A&code=expired',
    overrides: { exchangeCodeForSession: async () => ({ error: new Error('verifier missing') }) } });
  assert.equal(s.node('#retry').classList.contains('hidden'), false);
  assert.match(s.node('#status').textContent, /重新登入/);
});
test('signed-in flow shows exact account and waits for explicit consent', async () => {
  const s = await setup({ signedIn: true });
  assert.equal(s.node('#account').textContent, 'owner@example.com');
  assert.equal(s.calls.some(x => x[0] === 'approve'), false);
  await s.click('#approve'); assert.equal(s.calls.filter(x => x[0] === 'approve').length, 1);
});
test('switch account signs out only this browser session', async () => {
  const s = await setup({ signedIn: true }); await s.click('#switch-account');
  assert.equal(s.calls.find(x => x[0] === 'signout')[1].scope, 'local');
  assert.equal(s.node('#login').classList.contains('hidden'), false);
  await s.click('#approve'); assert.equal(s.calls.some(x => x[0] === 'approve'), false);
});
test('unauthenticated consent cannot be invoked', async () => {
  const s = await setup(); await s.click('#approve'); await s.click('#deny');
  assert.equal(s.calls.some(x => ['approve', 'deny'].includes(x[0])), false);
});
test('consent failure restores both buttons', async () => {
  const s = await setup({ signedIn: true, overrides: { oauth: {
    getAuthorizationDetails: async () => ({ data: { client: { name: 'ChatGPT' } } }),
    approveAuthorization: async () => ({ error: new Error('offline') }),
  } } });
  await s.click('#approve'); assert.equal(s.node('#approve').disabled, false); assert.equal(s.node('#deny').disabled, false);
});
