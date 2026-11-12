import "server-only"
import { COLLECTIONS, globalStore } from "../db/index.mjs"
import { env } from "../env.mjs"
import { renderPdf, renderPng } from "../render/index.mjs"
import { assertEmailEnabled, emailSupportsAttachments, sendEmail } from "../email.mjs"
import { certificateEmail, tagEmail } from "../emails/templates.mjs"
import { attendanceCode, isUuidV4, quizUrl, tagUrl, verifyUrl } from "../../shared/ids.mjs"
import { cleanText } from "../../shared/validation.mjs"

// Builds tag and certificate files, and handles the public pages behind each QR code.

export const fileSafe = (name) => cleanText(name, 80).replace(/[^A-Za-z0-9 _-]/g, "").replace(/\s+/g, "-") || "attendee"

export function tagData(event, attendee) {
  return { fullName: attendee.fullName, organization: attendee.organization || "", eventName: event.name,
    tagUrl: tagUrl(env().appUrl, attendee.tagId), tagCode: attendanceCode(event.code, attendee.tagId) }
}

export function certificateData(event, certificate) {
  const appUrl = env().appUrl
  return {
    fullName: certificate.nameOnCertificate,
    eventName: event.name,
    verifyUrl: verifyUrl(appUrl, certificate.$id),
    verifyHost: `${new URL(appUrl).host}/verify`,
    certificateId: certificate.$id,
    issuedDate: String(certificate.issuedAt || "").slice(0, 10),
    daysAttended: String(certificate.daysAttended),
  }
}

export const tagPng = (event, attendee) => renderPng({ designKey: event.designKey, kind: "tag", data: tagData(event, attendee) })

export function tagsPdf(event, attendees, sheet = "a4-2x2") {
  return renderPdf({ designKey: event.designKey, kind: "tag", sheet, title: `${event.code} tags`, records: attendees.map((a) => tagData(event, a)) })
}

export function certificatePdf(event, certificate) {
  return renderPdf({ designKey: event.designKey, kind: "certificate", title: `${event.code} certificate`, records: [certificateData(event, certificate)] })
}

// Every issued certificate in one file, one per page, sorted by name, for printing.
export function certificatesPdf(event, certificates) {
  const records = certificates
    .filter((c) => c.status === "issued")
    .sort((a, b) => a.nameOnCertificate.localeCompare(b.nameOnCertificate))
    .map((c) => certificateData(event, c))
  return renderPdf({ designKey: event.designKey, kind: "certificate", title: `${event.code} certificates`, records })
}

export async function emailTags(db, event, attendeeIds, { resend = false } = {}, audit) {
  assertEmailEnabled()
  const results = []
  for (const id of (attendeeIds || []).slice(0, 10)) {
    const attendee = await db.get(COLLECTIONS.attendees, cleanText(id, 36))
    if (!attendee) { results.push({ id, status: "not_found" }); continue }
    if (!attendee.email) { results.push({ id, status: "no_email" }); continue }
    if (attendee.tagEmailedAt && !resend) { results.push({ id, status: "already_sent" }); continue }
    try {
      const attach = emailSupportsAttachments()
      await sendEmail({
        to: attendee.email,
        ...tagEmail({ event, attendee, link: tagUrl(env().appUrl, attendee.tagId), quizLink: quizUrl(env().appUrl, attendee.tagId), attached: attach }),
        attachments: attach ? [{ filename: `${fileSafe(attendee.fullName)}-tag.png`, content: Buffer.from(tagPng(event, attendee)) }] : [],
      })
      await db.update(COLLECTIONS.attendees, attendee.$id, { tagEmailedAt: new Date().toISOString() })
      results.push({ id, status: "sent" })
    } catch (error) {
      console.error("Tag email failed", attendee.$id, error)
      results.push({ id, status: "failed" })
    }
  }
  await audit({ action: "tag.email", details: { sent: results.filter((r) => r.status === "sent").length, resend } })
  return results
}

export async function emailCertificates(db, event, certificateIds, { resend = false } = {}, audit) {
  assertEmailEnabled()
  const results = []
  for (const id of (certificateIds || []).slice(0, 10)) {
    const certificate = await db.get(COLLECTIONS.certificates, cleanText(id, 36))
    if (!certificate || certificate.status !== "issued") { results.push({ id, status: "not_issued" }); continue }
    if (certificate.emailedAt && !resend) { results.push({ id, status: "already_sent" }); continue }
    const attendee = await db.get(COLLECTIONS.attendees, certificate.attendeeId)
    if (!attendee?.email) { results.push({ id, status: "no_email" }); continue }
    try {
      const attach = emailSupportsAttachments()
      await sendEmail({
        to: attendee.email,
        ...certificateEmail({ event, certificate, link: verifyUrl(env().appUrl, certificate.$id), attached: attach }),
        attachments: attach ? [{ filename: `${fileSafe(certificate.nameOnCertificate)}-certificate.pdf`, content: Buffer.from(await certificatePdf(event, certificate)) }] : [],
      })
      await db.update(COLLECTIONS.certificates, certificate.$id, { emailedAt: new Date().toISOString() })
      results.push({ id, status: "sent" })
    } catch (error) {
      console.error("Certificate email failed", certificate.$id, error)
      results.push({ id, status: "failed" })
    }
  }
  await audit({ action: "certificate.email", details: { sent: results.filter((r) => r.status === "sent").length, resend } })
  return results
}

// Public lookups by UUID. They return only what's printed on the tag or certificate.
export async function findPublicTag(tagId) {
  if (!isUuidV4(tagId)) return null
  const store = globalStore()
  const attendee = await store.findAttendeeByTagIdAnyEvent(tagId.toLowerCase())
  if (!attendee) return null
  const event = await store.get(COLLECTIONS.events, attendee.eventId)
  if (!event || event.status === "archived") return null
  return { event, attendee }
}

export async function findPublicCertificate(certificateId) {
  if (!isUuidV4(certificateId)) return null
  const store = globalStore()
  const certificate = await store.getCertificateAnyEvent(certificateId.toLowerCase())
  if (!certificate) return null
  const event = await store.get(COLLECTIONS.events, certificate.eventId)
  if (!event) return null
  return { event, certificate }
}

