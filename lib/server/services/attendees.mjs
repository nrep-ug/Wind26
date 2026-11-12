import "server-only"
import { COLLECTIONS, Query } from "../db/index.mjs"
import { badRequest, conflict, notFound } from "../errors.mjs"
import { newDocId } from "./events.mjs"
import { newUuid } from "../../shared/ids.mjs"
import { attendeeIdentity, prepareImport } from "../../shared/csv.mjs"
import { maskEmail, searchText, validateAttendee } from "../../shared/validation.mjs"

export function adminAttendee(a) {
  return {
    id: a.$id, fullName: a.fullName, organization: a.organization || "", email: a.email || "", phone: a.phone || "",
    role: a.role, gender: a.gender || "", tagId: a.tagId, tagIssuedAt: a.tagIssuedAt, tagEmailedAt: a.tagEmailedAt || null,
  }
}

function toDocument(value) {
  return {
    fullName: value.fullName,
    organization: value.organization,
    email: value.email || null,
    phone: value.phone,
    role: value.role,
    gender: value.gender || null,
    searchText: searchText(value),
  }
}

export async function createAttendee(db, input, audit) {
  const result = validateAttendee(input)
  if (!result.ok) throw badRequest("Check the highlighted fields.", "invalid_input", { fields: result.errors })
  const existing = await db.listAll(COLLECTIONS.attendees)
  if (existing.some((a) => attendeeIdentity({ ...a, email: a.email || "" }) === attendeeIdentity(result.value))) {
    throw conflict("This person is already registered for this event.", "duplicate_attendee")
  }
  const doc = await db.create(COLLECTIONS.attendees, newDocId(), {
    ...toDocument(result.value),
    tagId: newUuid(),
    tagIssuedAt: new Date().toISOString(),
  })
  await audit({ action: "attendee.create", targetId: doc.$id, details: { fullName: doc.fullName } })
  return doc
}

export async function updateAttendee(db, attendeeId, input, audit) {
  const current = await db.get(COLLECTIONS.attendees, attendeeId)
  if (!current) throw notFound("Attendee not found.")
  const result = validateAttendee({ ...adminAttendee(current), ...input })
  if (!result.ok) throw badRequest("Check the highlighted fields.", "invalid_input", { fields: result.errors })
  const updated = await db.update(COLLECTIONS.attendees, attendeeId, toDocument(result.value))
  await audit({
    action: "attendee.update",
    targetId: attendeeId,
    details: { before: { fullName: current.fullName, organization: current.organization }, after: { fullName: updated.fullName, organization: updated.organization } },
  })
  return updated
}

// A new UUID makes the old QR code stop working everywhere at once.
export async function reissueTag(db, attendeeId, audit) {
  const current = await db.get(COLLECTIONS.attendees, attendeeId)
  if (!current) throw notFound("Attendee not found.")
  const updated = await db.update(COLLECTIONS.attendees, attendeeId, { tagId: newUuid(), tagIssuedAt: new Date().toISOString(), tagEmailedAt: null })
  await audit({ action: "tag.reissue", targetId: attendeeId, details: { fullName: current.fullName } })
  return updated
}

export async function deleteAttendee(db, attendeeId, audit) {
  const current = await db.get(COLLECTIONS.attendees, attendeeId)
  if (!current) throw notFound("Attendee not found.")
  const [checkins, certificate] = await Promise.all([
    db.count(COLLECTIONS.checkins, [Query.equal("attendeeId", attendeeId)]),
    db.findOne(COLLECTIONS.certificates, [Query.equal("attendeeId", attendeeId)]),
  ])
  if (checkins || certificate) {
    throw conflict("This person has attendance or a certificate recorded, so they can't be deleted. Reissue their tag instead if it was shared by mistake.")
  }
  await db.remove(COLLECTIONS.attendees, attendeeId)
  await audit({ action: "attendee.delete", targetId: attendeeId, details: { fullName: current.fullName } })
}

export async function importAttendees(db, csvText, { commit }, audit) {
  const existing = (await db.listAll(COLLECTIONS.attendees)).map((a) => ({ ...a, email: a.email || "", organization: a.organization || "" }))
  const prepared = prepareImport(csvText, existing)
  if (!prepared.ok) throw badRequest(prepared.message)
  if (!commit) return { preview: prepared.rows, valid: prepared.valid, invalid: prepared.invalid }
  if (prepared.invalid) throw badRequest("Fix or remove the rows with problems before importing.", "invalid_rows", { invalid: prepared.invalid })

  let created = 0
  for (const row of prepared.rows) {
    await db.create(COLLECTIONS.attendees, newDocId(), { ...toDocument(row.value), tagId: newUuid(), tagIssuedAt: new Date().toISOString() })
    created += 1
  }
  await audit({ action: "attendee.import", details: { created } })
  return { created }
}

// Desk search: this event only, and only what an operator needs to confirm who it is.
export async function searchAttendees(db, query) {
  const q = String(query || "").trim().toLowerCase()
  if (q.length < 2) return []
  const words = q.split(/\s+/).filter(Boolean).slice(0, 5)
  const all = await db.listAll(COLLECTIONS.attendees)
  return all
    .filter((a) => words.every((w) => (a.searchText || "").includes(w)))
    .slice(0, 10)
    .map((a) => ({ id: a.$id, fullName: a.fullName, organization: a.organization || "", email: maskEmail(a.email) }))
}
