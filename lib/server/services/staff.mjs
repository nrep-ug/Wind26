import "server-only"
import { COLLECTIONS, Query, globalStore } from "../db/index.mjs"
import { badRequest, conflict, forbidden, notFound } from "../errors.mjs"
import { newDocId } from "./events.mjs"
import { cleanText, isEmail, normalizeEmail } from "../../shared/validation.mjs"
import { env } from "../env.mjs"
import { staffCode } from "../scanner-codes.mjs"

// Admins manage the helpers for one event from the Check-in page: scanner helpers, and,
// with the shared admin password, extra admins who sign in with their own code.
// Admin accounts for sign-in by emailed code are created only with scripts/add-staff.mjs.

// Helpers added without an email get a placeholder address, because each account needs one.
const NO_EMAIL = "@no-email.invalid"
const usesCodes = () => env().adminAccess === "password"
const ROLES = ["scanner", "admin"]

const publicStaff = (s) => ({
  id: s.$id, email: s.email.endsWith(NO_EMAIL) ? "" : s.email, name: s.name, status: s.status, role: s.role,
  // With the shared admin password, helpers sign in with this code. Only admins see it.
  ...(usesCodes() ? { code: staffCode(s) } : {}),
})

export async function listScanners(eventId) {
  const rows = await globalStore().listAll(COLLECTIONS.staff, [Query.equal("eventId", eventId)])
  // Extra admins appear only with the shared password; with emailed codes, admins are managed by script.
  return rows.filter((s) => s.role === "scanner" || (usesCodes() && s.role === "admin")).map(publicStaff)
}

export async function addScanner(eventId, input, admin, audit) {
  const given = normalizeEmail(input?.email)
  const name = cleanText(input?.name, 120)
  const role = input?.role === "admin" ? "admin" : "scanner"
  if (role === "admin" && !usesCodes()) throw badRequest("Add admins with scripts/add-staff.mjs when staff sign in by email.")
  // Sign-in codes are emailed, so that setup needs a real address. Scanner codes don't.
  const email = !given && usesCodes() ? `${role}-${newDocId().slice(0, 12)}${NO_EMAIL}` : given
  if (!isEmail(email)) throw badRequest("Enter a valid email address.")
  if (name.length < 2) throw badRequest(`Enter the ${role === "admin" ? "admin" : "scanner"}'s name.`)
  const store = globalStore()
  const existing = await store.findOne(COLLECTIONS.staff, [Query.equal("email", email)])
  // An admin set up by script (no event) stays as it is.
  if (existing?.role === "admin" && !existing.eventId) throw conflict("This email belongs to an admin. Use a different email.")
  if (existing) {
    // One account per email: moving it to this event ends access to the previous one immediately.
    const updated = await store.update(COLLECTIONS.staff, existing.$id, { name, eventId, role, status: "active" })
    await audit({ action: `${role}.assign`, targetId: existing.$id, details: { email, previousEventId: existing.eventId, previousRole: existing.role } })
    return publicStaff(updated)
  }
  const doc = await store.create(COLLECTIONS.staff, newDocId(), { email, name, role, eventId, status: "active", createdBy: admin.email })
  await audit({ action: `${role}.add`, targetId: doc.$id, details: { email } })
  return publicStaff(doc)
}

export async function setScannerStatus(eventId, staffId, status, audit, admin = null) {
  if (!["active", "disabled"].includes(status)) throw badRequest("Choose active or disabled.")
  const store = globalStore()
  const staff = await store.get(COLLECTIONS.staff, staffId)
  if (!staff) throw notFound("Helper not found.")
  if (!ROLES.includes(staff.role) || staff.eventId !== eventId) throw forbidden("This helper isn't assigned to this event.")
  if (admin && admin.id === staffId && status === "disabled") throw badRequest("You can't disable your own access.")
  const updated = await store.update(COLLECTIONS.staff, staffId, { status })
  await audit({ action: `${staff.role}.${status === "active" ? "enable" : "disable"}`, targetId: staffId, details: { email: staff.email } })
  return publicStaff(updated)
}
