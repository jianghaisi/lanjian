const key = 'lanjian-login-destination'
function allowed(value: string | null) { return value === '/admin' || value === '/app/reference' || /^\/app\?book=[a-f0-9-]{36}$/i.test(value ?? '') ? value! : '/app' }
export function loginDestination() { return allowed(new URLSearchParams(location.search).get('next')) }
export function rememberLoginDestination() { sessionStorage.setItem(key, loginDestination()) }
export function consumeLoginDestination() { const value = sessionStorage.getItem(key); sessionStorage.removeItem(key); return allowed(value) }
