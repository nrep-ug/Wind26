import "server-only"
import crypto from "node:crypto"
import { env } from "./env.mjs"
import { formatScannerCode } from "../shared/ids.mjs"

// With the shared admin password, each scanner helper signs in with a personal code instead.
// It is derived from their account and SESSION_SECRET, so nothing secret is stored, and
// disabling the account turns the code off at once.
export function scannerCode(staffId) {
  return formatScannerCode(crypto.createHmac("sha256", env().sessionSecret).update(`scanner-code:${staffId}`).digest())
}

// Extra admins get a personal code the same way, from a different seed, so a scanner's
// code can never open the admin side. Each code goes only with its own role.
export function adminCode(staffId) {
  return formatScannerCode(crypto.createHmac("sha256", env().sessionSecret).update(`admin-code:${staffId}`).digest())
}

export const staffCode = (staff) => (staff.role === "admin" ? adminCode(staff.$id) : scannerCode(staff.$id))
