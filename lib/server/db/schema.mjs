// Single source of truth for the database layout.
// Used by scripts/setup-appwrite.mjs, the data layer and the CI checks.
//
// Rules (checked by tests/schema.test.mjs and scripts/check-architecture.mjs):
// - No collection grants any client permission. Only the server's API key reads or writes.
// - Every collection marked `eventScoped` has a required `eventId` attribute and an index on it.

export const COLLECTIONS = Object.freeze({
  events: "events",
  staff: "staff",
  otps: "auth_codes",
  sessions: "sessions",
  attendees: "attendees",
  checkins: "checkins",
  certificates: "certificates",
  quizzes: "quizzes",
  quizResponses: "quiz_responses",
  audit: "audit_log",
})

const str = (key, size, required = false, extra = {}) => ({ type: "string", key, size, required, ...extra })
const int = (key, required = false, extra = {}) => ({ type: "integer", key, required, ...extra })
const dt = (key, required = false) => ({ type: "datetime", key, required })
const en = (key, elements, required = false) => ({ type: "enum", key, elements, required })

export const SCHEMA = Object.freeze([
  {
    id: COLLECTIONS.events,
    name: "Events",
    eventScoped: false,
    attributes: [
      str("code", 32, true),
      str("name", 200, true),
      str("shortName", 80),
      str("venue", 200),
      str("startDate", 10, true), // YYYY-MM-DD, event-local
      str("endDate", 10, true),
      str("timezone", 64, true),
      str("checkinOpens", 5, true), // HH:MM event-local
      str("checkinCloses", 5, true),
      int("certificateMinDays", true, { min: 0, max: 30 }),
      str("designKey", 64, true), // folder under events/
      en("status", ["draft", "live", "closed", "archived"], true),
      str("contactEmail", 200),
      str("quizOpens", 5), // HH:MM event-local, on the first day
      str("organiser", 200), // signs the emails
    ],
    indexes: [{ key: "code_unique", type: "unique", attributes: ["code"] }],
  },
  {
    id: COLLECTIONS.staff,
    name: "Staff",
    eventScoped: false,
    attributes: [
      str("email", 200, true),
      str("name", 120, true),
      en("role", ["admin", "scanner"], true),
      str("eventId", 36), // required for scanners, empty for admins
      en("status", ["active", "disabled"], true),
      str("createdBy", 200),
    ],
    indexes: [
      { key: "email_unique", type: "unique", attributes: ["email"] },
      { key: "event_idx", type: "key", attributes: ["eventId"] },
    ],
  },
  {
    id: COLLECTIONS.otps,
    name: "Sign-in codes",
    eventScoped: false,
    attributes: [
      str("email", 200, true),
      str("codeHash", 64, true),
      dt("expiresAt", true),
      int("attempts", true, { min: 0, max: 100 }),
      dt("consumedAt"),
    ],
    indexes: [
      { key: "email_idx", type: "key", attributes: ["email"] },
      { key: "kind_idx", type: "key", attributes: ["codeHash"] }, // counts failed admin-password attempts
    ],
  },
  {
    id: COLLECTIONS.sessions,
    name: "Sessions",
    eventScoped: false,
    attributes: [
      str("staffId", 36, true),
      dt("expiresAt", true),
      str("userAgent", 200),
    ],
    indexes: [{ key: "staff_idx", type: "key", attributes: ["staffId"] }],
  },
  {
    id: COLLECTIONS.attendees,
    name: "Attendees",
    eventScoped: true,
    attributes: [
      str("eventId", 36, true),
      str("fullName", 120, true),
      str("organization", 160),
      str("email", 200),
      str("phone", 32),
      en("role", ["participant", "facilitator", "organiser", "guest"], true),
      en("gender", ["female", "male"]), // optional; used for attendance and quiz results by gender
      str("tagId", 36, true), // UUID v4 printed in the QR code
      dt("tagIssuedAt", true),
      dt("tagEmailedAt"),
      str("searchText", 600), // lower-cased name/org/email/phone for desk search
    ],
    indexes: [
      { key: "event_idx", type: "key", attributes: ["eventId"] },
      { key: "tag_unique", type: "unique", attributes: ["tagId"] },
      { key: "event_email", type: "key", attributes: ["eventId", "email"] },
    ],
  },
  {
    id: COLLECTIONS.checkins,
    name: "Check-ins",
    eventScoped: true,
    attributes: [
      str("eventId", 36, true),
      str("attendeeId", 36, true),
      int("day", true, { min: 1, max: 60 }),
      str("date", 10, true),
      en("source", ["qr", "manual", "admin"], true),
      str("operatorId", 36, true),
      str("reason", 60),
      str("note", 200),
      dt("checkedInAt", true),
    ],
    indexes: [
      { key: "event_idx", type: "key", attributes: ["eventId"] },
      { key: "event_date", type: "key", attributes: ["eventId", "date"] },
      { key: "event_attendee", type: "key", attributes: ["eventId", "attendeeId"] },
      { key: "operator_source", type: "key", attributes: ["operatorId", "source", "checkedInAt"] },
    ],
  },
  {
    id: COLLECTIONS.certificates,
    name: "Certificates",
    eventScoped: true,
    attributes: [
      str("eventId", 36, true),
      str("attendeeId", 36, true),
      str("nameOnCertificate", 120, true),
      int("daysAttended", true, { min: 0, max: 60 }),
      en("status", ["issued", "revoked"], true),
      dt("issuedAt", true),
      str("issuedBy", 36, true),
      dt("emailedAt"),
      dt("revokedAt"),
      str("revokedReason", 200),
    ],
    indexes: [
      { key: "event_idx", type: "key", attributes: ["eventId"] },
      { key: "event_attendee_unique", type: "unique", attributes: ["eventId", "attendeeId"] },
    ],
  },
  {
    id: COLLECTIONS.quizzes,
    name: "Quizzes",
    eventScoped: true,
    attributes: [
      str("eventId", 36, true),
      str("title", 120, true),
      en("status", ["draft", "open", "closed"], true),
      en("kind", ["pre", "post", "other"]), // missing means other
      str("questions", 100000, true), // JSON: [{ text, options: [..], answer }]
      int("questionCount", true, { min: 1, max: 100 }),
      int("passMark", true, { min: 0, max: 100 }), // percent
      dt("openedAt"),
      dt("closedAt"),
    ],
    indexes: [{ key: "event_idx", type: "key", attributes: ["eventId"] }],
  },
  {
    // One response per attendee per quiz: the document ID is derived from both.
    id: COLLECTIONS.quizResponses,
    name: "Quiz responses",
    eventScoped: true,
    attributes: [
      str("eventId", 36, true),
      str("quizId", 36, true),
      str("attendeeId", 36, true),
      str("answers", 1000, true), // JSON: option index per question
      int("score", true, { min: 0, max: 100 }),
      int("total", true, { min: 1, max: 100 }),
      dt("submittedAt", true),
    ],
    indexes: [
      { key: "event_idx", type: "key", attributes: ["eventId"] },
      { key: "event_quiz", type: "key", attributes: ["eventId", "quizId"] },
    ],
  },
  {
    id: COLLECTIONS.audit,
    name: "Audit log",
    eventScoped: true,
    attributes: [
      str("eventId", 36, true),
      str("actorId", 36, true),
      str("action", 60, true),
      str("targetId", 36),
      str("details", 2000),
      dt("at", true),
    ],
    indexes: [{ key: "event_at", type: "key", attributes: ["eventId", "at"] }],
  },
])

export const EVENT_SCOPED = Object.freeze(new Set(SCHEMA.filter((c) => c.eventScoped).map((c) => c.id)))
export const GLOBAL = Object.freeze(new Set(SCHEMA.filter((c) => !c.eventScoped).map((c) => c.id)))
