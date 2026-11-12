import test from "node:test"
import assert from "node:assert/strict"
import { attendanceCode, extractTagId, formatScannerCode, isUuidV4, newUuid, normalizeScannerCode } from "../lib/shared/ids.mjs"
import { backfillDay, checkinWindow, eventDays, validateEventProfile } from "../lib/shared/event-days.mjs"
import { attendanceCsv, certificateEligibility, csvCell } from "../lib/shared/attendance.mjs"
import { maskEmail, validateAttendee, validateManualReason } from "../lib/shared/validation.mjs"

const event = {
  code: "TEST26", name: "Test", startDate: "2026-11-10", endDate: "2026-11-12", timezone: "Africa/Kampala",
  checkinOpens: "07:00", checkinCloses: "18:00", certificateMinDays: 3, designKey: "test", status: "live",
}
// 08:30 in Kampala (UTC+3) on day 2.
const day2Morning = new Date("2026-11-11T05:30:00Z")

test("tag ids are random v4 UUIDs, and only v4 is accepted", () => {
  const id = newUuid()
  assert.ok(isUuidV4(id))
  assert.equal(isUuidV4("6ba7b810-9dad-11d1-80b4-00c04fd430c8"), false, "v1 rejected")
  assert.notEqual(newUuid(), newUuid())
})

test("extractTagId reads links and bare UUIDs, and nothing else", () => {
  const id = "3f1c2b9a-8d7e-4c6b-9a5f-1e2d3c4b5a69"
  assert.equal(extractTagId(`https://events.example.org/t/${id}`), id)
  assert.equal(extractTagId(id.toUpperCase()), id)
  assert.equal(extractTagId(`https://x.org/t/${id}?utm=1`), id)
  assert.equal(extractTagId(`WIND26:${id}`), id)
  assert.equal(extractTagId(attendanceCode("wind26", id)), id)
  assert.equal(extractTagId(`WIND26:${id}:x`), null)
  assert.equal(extractTagId("rec:v1:abcdef"), null)
  assert.equal(extractTagId(`https://x.org/t/${id}extra`), null)
  assert.equal(extractTagId(""), null)
})

test("scanner codes are easy to read out and forgiving to type", () => {
  const code = formatScannerCode(Buffer.from("00112233445566778899aabbccddeeff", "hex"))
  assert.match(code, /^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/, "no 0, 1, I or O")
  assert.equal(normalizeScannerCode(code.toLowerCase().replaceAll("-", " ")), code.replaceAll("-", ""))
  assert.equal(normalizeScannerCode(` ${code} `), code.replaceAll("-", ""))
  assert.equal(normalizeScannerCode("K7QM-4RXP-2WT"), "", "too short")
  assert.equal(normalizeScannerCode("K7QM-4RXP-2WT0"), "", "0 is never in a code")
  assert.equal(normalizeScannerCode("my admin password"), "")
})

test("event days and check-in window follow the event's timezone", () => {
  assert.deepEqual(eventDays(event).map((d) => d.date), ["2026-11-10", "2026-11-11", "2026-11-12"])
  assert.deepEqual(checkinWindow(event, day2Morning), { ok: true, date: "2026-11-11", day: 2 })
  // 23:30 UTC on the 9th is 02:30 on the 10th in Kampala: day 1, but before opening.
  assert.equal(checkinWindow(event, new Date("2026-11-09T23:30:00Z")).code, "outside_hours")
  assert.equal(checkinWindow(event, new Date("2026-11-13T06:00:00Z")).code, "not_event_day")
  assert.equal(checkinWindow({ ...event, status: "closed" }, day2Morning).code, "event_not_live")
})

test("admins can't record attendance for future days", () => {
  assert.equal(backfillDay(event, 1, day2Morning).ok, true)
  assert.equal(backfillDay(event, 3, day2Morning).ok, false)
  assert.equal(backfillDay(event, 9, day2Morning).ok, false)
})

test("event profile validation", () => {
  assert.deepEqual(validateEventProfile(event), [])
  assert.ok(validateEventProfile({ ...event, endDate: "2026-11-01" }).length)
  assert.ok(validateEventProfile({ ...event, timezone: "Mars/Base" }).length)
  assert.ok(validateEventProfile({ ...event, certificateMinDays: 4 }).length)
  assert.ok(validateEventProfile({ ...event, designKey: "../x" }).length)
})

test("certificate eligibility uses the minimum days rule", () => {
  assert.equal(certificateEligibility(event, new Set([1, 2, 3])).eligible, true)
  assert.equal(certificateEligibility(event, new Set([1, 2])).eligible, false)
  assert.equal(certificateEligibility({ ...event, certificateMinDays: 2 }, new Set([1, 3])).eligible, true)
  assert.equal(certificateEligibility({ ...event, certificateMinDays: 0 }, new Set()).eligible, false, "needs at least one day")
  assert.equal(certificateEligibility(event, new Set([1, 2, 9])).daysAttended, 2, "ignores days outside the event")
})

test("CSV export blocks spreadsheet formulas", () => {
  assert.equal(csvCell("=HYPERLINK(\"x\")"), "\"'=HYPERLINK(\"\"x\"\")\"")
  assert.equal(csvCell("+256772"), "'+256772")
  const csv = attendanceCsv(event, [{ $id: "a", fullName: "Grace, A", organization: "", email: "", phone: "", role: "participant" }], [{ attendeeId: "a", day: 1 }])
  assert.match(csv, /"Grace, A"/)
  assert.match(csv, /Day 1 \(2026-11-10\)/)
})

test("attendee validation and manual reasons", () => {
  assert.equal(validateAttendee({ fullName: "  Grace   Achieng " }).value.fullName, "Grace Achieng")
  assert.equal(validateAttendee({ fullName: "G" }).ok, false)
  assert.equal(validateAttendee({ fullName: "Grace", email: "nope" }).ok, false)
  assert.equal(validateAttendee({ fullName: "Grace", phone: "0772 123 456" }).value.phone, "0772123456")
  assert.equal(validateAttendee({ fullName: "Grace", gender: " Female " }).value.gender, "female")
  assert.equal(validateAttendee({ fullName: "Grace", gender: "M" }).value.gender, "male")
  assert.equal(validateAttendee({ fullName: "Grace" }).value.gender, "")
  assert.equal(validateAttendee({ fullName: "Grace", gender: "unknown" }).ok, false)
  assert.equal(validateManualReason("forgot_tag").ok, true)
  assert.equal(validateManualReason("").ok, false)
  assert.equal(validateManualReason("other", "").ok, false)
  assert.equal(validateManualReason("other", "Badge printed wrong").ok, true)
  assert.equal(maskEmail("grace@example.org"), "g••••@example.org")
})
