const AUTH_TOKEN_KEY = "magicteams-auth-token";
const AUTH_USER_KEY = "magicteams-auth-user";

export interface BetterAuthUser {
  id?: string;
  email?: string;
  name?: string;
  [key: string]: unknown;
}

export interface BetterAuthLoginResponse {
  token: string;
  user?: BetterAuthUser;
}

export interface PasswordResetResponse {
  success?: boolean;
  emailSent?: boolean;
  resetUrl?: string | null;
}

function apiBaseUrl(): string {
  return (import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");
}

async function authRequest<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof result.error === "string" ? result.error : "Request failed");
  }
  return result as T;
}

export async function signInWithBetterAuth(email: string, password: string): Promise<BetterAuthLoginResponse> {
  const result = await authRequest<BetterAuthLoginResponse>("/api/auth/better/login", { email, password });
  if (!result.token || typeof result.token !== "string") {
    throw new Error("Login response did not include a token");
  }
  return result;
}

export async function signUpWithBetterAuth(
  fullName: string,
  email: string,
  password: string,
): Promise<BetterAuthLoginResponse> {
  const result = await authRequest<BetterAuthLoginResponse>("/api/auth/better/signup", { fullName, email, password });
  if (!result.token || typeof result.token !== "string") {
    throw new Error("Sign up response did not include a token");
  }
  return result;
}

export function requestPasswordReset(email: string): Promise<PasswordResetResponse> {
  return authRequest<PasswordResetResponse>("/api/auth/better/password-reset/request", {
    email,
    redirectOrigin: window.location.origin,
  });
}

export function confirmPasswordReset(token: string, password: string): Promise<{ success?: boolean }> {
  return authRequest<{ success?: boolean }>("/api/auth/better/password-reset/confirm", { token, password });
}

export function saveBetterAuthSession(session: BetterAuthLoginResponse) {
  localStorage.setItem(AUTH_TOKEN_KEY, session.token);
  if (session.user) localStorage.setItem(AUTH_USER_KEY, JSON.stringify(session.user));
}

export function clearBetterAuthSession() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
}

export function signOutBetterAuth() {
  clearBetterAuthSession();
  window.location.reload();
}

export function betterAuthToken(): string | null {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}
