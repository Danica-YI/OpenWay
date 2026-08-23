/**
 * Accounts and sessions.
 *
 * Self-contained on purpose: no external identity provider, so a teammate can
 * clone the repo and sign up without configuring anything. Passwords are
 * PBKDF2-SHA256 with a per-user salt; sessions are opaque random tokens stored
 * server-side, so the cookie carries no claims of its own.
 */

import { and, eq, gt } from "drizzle-orm";
import { getDb } from "../db";
import { sessions, users } from "../db/schema";

export type SessionUser = { id: number; email: string; displayName: string };

const SESSION_COOKIE = "ow_session";
const SESSION_DAYS = 30;
const PBKDF2_ITERATIONS = 100_000;

function toHex(bytes: Uint8Array | ArrayBuffer): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(view, (b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(Math.floor(hex.length / 2));
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function derive(password: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    key,
    256,
  );
  return toHex(bits);
}

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { hash: await derive(password, salt), salt: toHex(salt) };
}

/** Compares in constant time so a wrong password cannot be probed byte by byte. */
export async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  const candidate = await derive(password, fromHex(salt));
  if (candidate.length !== hash.length) return false;
  let difference = 0;
  for (let i = 0; i < candidate.length; i += 1) difference |= candidate.charCodeAt(i) ^ hash.charCodeAt(i);
  return difference === 0;
}

/**
 * What the public sees: first name plus a last initial. Someone reading a
 * report learns who stands behind it without the author publishing their full
 * name next to a place they visit.
 */
export function publicName(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "Community member";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

export async function createSession(userId: number): Promise<string> {
  const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
  await (await getDb()).insert(sessions).values({ token, userId, expiresAt });
  return token;
}

export async function destroySession(token: string): Promise<void> {
  await (await getDb()).delete(sessions).where(eq(sessions.token, token));
}

export function readSessionToken(request: Request): string | null {
  const header = request.headers.get("cookie") ?? "";
  const match = header.match(/(?:^|;\s*)ow_session=([^;]+)/);
  return match ? match[1] : null;
}

export async function currentUser(request: Request): Promise<SessionUser | null> {
  const token = readSessionToken(request);
  if (!token) return null;
  const rows = await (await getDb())
    .select({ id: users.id, email: users.email, displayName: users.displayName })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.token, token), gt(sessions.expiresAt, new Date().toISOString())))
    .limit(1);
  return rows[0] ?? null;
}

function isSecure(request: Request): boolean {
  return new URL(request.url).protocol === "https:";
}

export function sessionCookie(request: Request, token: string): string {
  const flags = ["HttpOnly", "SameSite=Lax", "Path=/", `Max-Age=${SESSION_DAYS * 86_400}`];
  if (isSecure(request)) flags.push("Secure");
  return `${SESSION_COOKIE}=${token}; ${flags.join("; ")}`;
}

export function clearedCookie(request: Request): string {
  const flags = ["HttpOnly", "SameSite=Lax", "Path=/", "Max-Age=0"];
  if (isSecure(request)) flags.push("Secure");
  return `${SESSION_COOKIE}=; ${flags.join("; ")}`;
}

export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) && value.length <= 160;
}
