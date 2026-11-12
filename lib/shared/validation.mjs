export const ROLES = Object.freeze(["participant", "facilitator", "organiser", "guest"])
export const GENDERS = Object.freeze({ female: "Female", male: "Male" })
// Accepts what a spreadsheet usually holds: Female/Male, F/M, Woman/Man. Empty means not recorded.
const GENDER_WORDS = { f: "female", female: "female", woman: "female", w: "female", m: "male", male: "male", man: "male" }
export const normalizeGender = (value) => {
  const word = String(value ?? "").trim().toLowerCase()
  return word ? GENDER_WORDS[word] ?? null : ""
}

export const MANUAL_REASONS = Object.freeze([
  { value: "forgot_tag", label: "Forgot tag" },
  { value: "phone_dead", label: "Phone off or dead" },
  { value: "qr_unreadable", label: "QR won't scan" },
  { value: "paper_list", label: "Recorded on the paper list" },
  { value: "other", label: "Other (add a note)" },
])

const REASON_VALUES = new Set(MANUAL_REASONS.map((r) => r.value))

export function cleanText(value, max) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
}

export function normalizeEmail(value) {
  return cleanText(value, 200).toLowerCase()
}

export function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)
}

// Keeps a leading + and digits. Ugandan numbers like 0772 123456 stay as typed digits.
export function normalizePhone(value) {
  const text = cleanText(value, 32)
  if (!text) return ""
  const plus = text.startsWith("+") ? "+" : ""
  return plus + text.replace(/\D/g, "")
}

export function validateAttendee(input) {
  const fullName = cleanText(input?.fullName, 120)
  const organization = cleanText(input?.organization, 160)
  const email = normalizeEmail(input?.email)
  const phone = normalizePhone(input?.phone)
  const role = cleanText(input?.role || "participant", 20).toLowerCase()
  const gender = normalizeGender(input?.gender)
  const errors = {}
  if (fullName.length < 2) errors.fullName = "Enter the attendee's full name."
  if (email && !isEmail(email)) errors.email = "Enter a valid email address, or leave it empty."
  if (phone && (phone.replace("+", "").length < 9 || phone.length > 16)) errors.phone = "Enter a valid phone number, or leave it empty."
  if (!ROLES.includes(role)) errors.role = `Role must be one of: ${ROLES.join(", ")}.`
  if (gender === null) errors.gender = "Gender must be Female or Male, or left empty."
  const value = { fullName, organization, email, phone, role, gender: gender || "" }
  return { ok: Object.keys(errors).length === 0, value, errors }
}

export function searchText(attendee) {
  return [attendee.fullName, attendee.organization, attendee.email, attendee.phone]
    .filter(Boolean).join(" ").toLowerCase().slice(0, 600)
}

export function validateManualReason(reason, note) {
  const value = cleanText(reason, 60)
  const cleanNote = cleanText(note, 200)
  if (!REASON_VALUES.has(value)) return { ok: false, message: "Choose why the tag wasn't scanned." }
  if (value === "other" && cleanNote.length < 3) return { ok: false, message: "Add a short note explaining the reason." }
  return { ok: true, reason: value, note: cleanNote }
}

// Shows enough of an email for a desk operator to confirm identity without exposing it.
export function maskEmail(email) {
  const [user, domain] = String(email || "").split("@")
  if (!user || !domain) return ""
  return `${user.slice(0, 1)}${"•".repeat(Math.min(4, Math.max(1, user.length - 1)))}@${domain}`
}
