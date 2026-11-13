import "server-only"
import crypto from "node:crypto"
import { cookies, headers } from "next/headers"
import { COLLECTIONS, Query, globalStore } from "./db/index.mjs"
import { env } from "./env.mjs"
import { badRequest, forbidden, tooMany, unauthorized } from "./errors.mjs"
import { sendEmail } from "./email.mjs"
import { signInCodeEmail } from "./emails/templates.mjs"
import { isEmail, normalizeEmail } from "../shared/validation.mjs"
import { normalizeScannerCode } from "../shared/ids.mjs"
import { staffCode } from "./scanner-codes.mjs"

// Staff sign in with an emailed one-time code (ADMIN_ACCESS=signin) or one shared
// admin password (ADMIN_ACCESS=password). Attendees never sign in.
const CODE_TTL_MS = 10 * 60 * 1000
const CODES_PER_WINDOW = 3
const CODE_WINDOW_MS = 15 * 60 * 1000
const MAX_ATTEMPTS = 5
const PASSWORD_FAILS_PER_IP = 10
const PASSWORD_FAILS_TOTAL = 100
const SESSION_TTL_MS = { admin: 12 * 3600 * 1000, scanner: 14 * 3600 * 1000 }

export const cookieName = () => (env().production ? "__Host-event_session" : "event_session")

const hmac = (value) => crypto.createHmac("sha256", env().sessionSecret).update(value).digest("hex")
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex")
const sessionDocId = (token) => sha256(token).slice(0, 32)

function sameHex(a, b) {
  const left = Buffer.from(String(a), "hex")
  const right = Buffer.from(String(b), "hex")
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right)
}

// Built-in admins that have no staff record. `builtin` lets them use the scanner as well.
export const LOCAL_ADMIN = Object.freeze({ id: "local-admin", email: "admin@localhost", name: "Admin", role: "admin", eventId: "", local: true, builtin: true })
const SHARED_ADMIN = Object.freeze({ id: "shared-admin", email: "admin", name: "Admin", role: "admin", eventId: "", builtin: true })
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"])

// Shared-admin sessions carry a fingerprint of the password, so changing ADMIN_PASSWORD signs everyone out.
const sharedSessionId = () => `${SHARED_ADMIN.id}:${hmac(`admin-password:${env().adminPassword}`).slice(0, 16)}`

async function startSession(staffId, role, userAgent) {
  const token = crypto.randomBytes(32).toString("base64url")
  const expiresAt = new Date(Date.now() + (SESSION_TTL_MS[role] || SESSION_TTL_MS.admin))
  await globalStore().create(COLLECTIONS.sessions, sessionDocId(token), {
    staffId,
    expiresAt: expiresAt.toISOString(),
    userAgent: String(userAgent).slice(0, 200),
  })
  const jar = await cookies()
  jar.set(cookieName(), token, { httpOnly: true, secure: env().production, sameSite: "strict", path: "/", expires: expiresAt })
}

// Always answers the same way so the form can't be used to discover staff emails.
export async function requestSignInCode(emailInput) {
  if (env().adminAccess !== "signin") throw forbidden("Sign in with the admin password.")
  const email = normalizeEmail(emailInput)
  if (!isEmail(email)) throw badRequest("Enter a valid email address.")
  const db = globalStore()
  const staff = await db.findOne(COLLECTIONS.staff, [Query.equal("email", email)])
  if (!staff || staff.status !== "active") return

  const since = new Date(Date.now() - CODE_WINDOW_MS).toISOString()
  const recent = await db.list(COLLECTIONS.otps, [Query.equal("email", email), Query.greaterThan("$createdAt", since), Query.limit(1)])
  if (Number(recent?.total || 0) >= CODES_PER_WINDOW) throw tooMany("Too many codes requested. Wait 15 minutes and try again.")

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0")
  await db.create(COLLECTIONS.otps, crypto.randomUUID().replaceAll("-", ""), {
    email,
    codeHash: hmac(`${email}:${code}`),
    expiresAt: new Date(Date.now() + CODE_TTL_MS).toISOString(),
    attempts: 0,
  })
  await sendEmail({ to: email, ...signInCodeEmail({ name: staff.name, code }) })
}

export async function verifySignInCode(emailInput, codeInput, userAgent = "") {
  if (env().adminAccess !== "signin") throw forbidden("Sign in with the admin password.")
  const email = normalizeEmail(emailInput)
  const code = String(codeInput || "").replace(/\D/g, "")
  const invalid = () => badRequest("That code is wrong or has expired. Request a new one.", "invalid_code")
  if (!isEmail(email) || code.length !== 6) throw invalid()

  const db = globalStore()
  const otp = await db.findOne(COLLECTIONS.otps, [Query.equal("email", email), Query.orderDesc("$createdAt")])
  if (!otp || otp.consumedAt || Date.parse(otp.expiresAt) < Date.now()) throw invalid()
  if (otp.attempts >= MAX_ATTEMPTS) throw tooMany("Too many wrong codes. Request a new code.")
  // Count the attempt before comparing, so parallel guesses can't skip the limit.
  await db.update(COLLECTIONS.otps, otp.$id, { attempts: otp.attempts + 1 })
  if (!sameHex(otp.codeHash, hmac(`${email}:${code}`))) throw invalid()
  await db.update(COLLECTIONS.otps, otp.$id, { consumedAt: new Date().toISOString() })

  const staff = await db.findOne(COLLECTIONS.staff, [Query.equal("email", email)])
  if (!staff || staff.status !== "active") throw invalid()
  await startSession(staff.$id, staff.role, userAgent)
  return { role: staff.role }
}

// Wrong guesses are recorded in the sign-in codes table (one row each, kept 15 minutes)
// and limited per address and in total, so the password can't be guessed by trying many.
export async function signInWithPassword(passwordInput, ip, userAgent = "") {
  if (env().adminAccess !== "password") throw forbidden("Password sign-in is turned off.")
  const db = globalStore()
  const since = new Date(Date.now() - CODE_WINDOW_MS).toISOString()
  const failKey = `password-fail:${hmac(`ip:${ip}`).slice(0, 24)}`
  const [mine, all] = await Promise.all([
    db.list(COLLECTIONS.otps, [Query.equal("email", failKey), Query.greaterThan("$createdAt", since), Query.limit(1)]),
    db.list(COLLECTIONS.otps, [Query.equal("codeHash", "password-fail"), Query.greaterThan("$createdAt", since), Query.limit(1)]),
  ])
  if (Number(mine?.total || 0) >= PASSWORD_FAILS_PER_IP || Number(all?.total || 0) >= PASSWORD_FAILS_TOTAL) {
    throw tooMany("Too many wrong passwords. Wait 15 minutes and try again.")
  }
  // Spaces or a line break copied along with a shared password would otherwise make it "wrong".
  const given = String(passwordInput || "").trim().slice(0, 200)
  if (sameHex(hmac(`admin-password:${given}`), hmac(`admin-password:${env().adminPassword}`))) {
    await startSession(sharedSessionId(), "admin", userAgent)
    return { role: "admin" }
  }
  const code = normalizeScannerCode(given)
  if (code) {
    // Scanner helpers (for one event) and extra admins added from the Check-in page.
    const people = await db.listAll(COLLECTIONS.staff, [Query.equal("status", "active")])
    const match = people.find((s) => s.eventId && ["scanner", "admin"].includes(s.role)
      && sameHex(hmac(`code:${staffCode(s).replaceAll("-", "")}`), hmac(`code:${code}`)))
    if (match) {
      await startSession(match.$id, match.role, userAgent)
      return { role: match.role }
    }
  }
  await db.create(COLLECTIONS.otps, crypto.randomUUID().replaceAll("-", ""), {
    email: failKey, codeHash: "password-fail", expiresAt: new Date(Date.now() + CODE_WINDOW_MS).toISOString(), attempts: 1,
  })
  throw badRequest("That password or scanner code is wrong.", "invalid_password")
}

export async function signOut() {
  const jar = await cookies()
  const token = jar.get(cookieName())?.value
  if (token) await globalStore().remove(COLLECTIONS.sessions, sessionDocId(token)).catch(() => {})
  jar.delete(cookieName())
}

async function localAdmin() {
  const host = String((await headers()).get("host") || "").toLowerCase().replace(/:\d+$/, "")
  return LOOPBACK.has(host) ? LOCAL_ADMIN : null
}

// Loads the session and the staff record on every request, so disabling a
// staff member or moving a scanner to another event takes effect immediately.
export async function currentStaff() {
  if (env().adminOpen) return localAdmin()
  const jar = await cookies()
  const token = jar.get(cookieName())?.value
  if (!token || token.length > 100) return null
  const db = globalStore()
  const session = await db.get(COLLECTIONS.sessions, sessionDocId(token))
  if (!session || Date.parse(session.expiresAt) < Date.now()) return null
  if (session.staffId.startsWith(`${SHARED_ADMIN.id}:`)) {
    return env().adminAccess === "password" && session.staffId === sharedSessionId() ? SHARED_ADMIN : null
  }
  const staff = await db.get(COLLECTIONS.staff, session.staffId)
  if (!staff || staff.status !== "active") return null
  // With the shared admin password, the personal accounts are scanner helpers and the
  // extra admins added from the Check-in page (they carry the event they were added for).
  if (env().adminAccess !== "signin" && !(staff.role === "scanner" || (staff.role === "admin" && staff.eventId))) return null
  return { id: staff.$id, email: staff.email, name: staff.name, role: staff.role, eventId: staff.eventId || "" }
}

export async function requireAdmin() {
  const staff = await currentStaff()
  if (!staff) throw unauthorized()
  if (staff.role !== "admin") throw forbidden("Only event admins can do this.")
  return staff
}

export async function requireScanner() {
  const staff = await currentStaff()
  if (!staff) throw unauthorized()
  if (staff.role !== "scanner" || !staff.eventId) throw forbidden("This account isn't set up as a scanner for an event.")
  return staff
}
