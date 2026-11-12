import { eventDays } from "./event-days.mjs"

// Groups check-ins by attendee: { attendeeId: Set(day numbers) }.
export function daysByAttendee(checkins) {
  const map = new Map()
  for (const c of checkins || []) {
    if (!map.has(c.attendeeId)) map.set(c.attendeeId, new Set())
    map.get(c.attendeeId).add(Number(c.day))
  }
  return map
}

export function certificateEligibility(event, attendedDays) {
  const total = eventDays(event).length
  const days = attendedDays instanceof Set ? attendedDays : new Set(attendedDays || [])
  const count = [...days].filter((d) => d >= 1 && d <= total).length
  const required = Number(event?.certificateMinDays || 0)
  return { daysAttended: count, required, totalDays: total, eligible: total > 0 && count >= required && count > 0 }
}

// Plain-text CSV cell: quotes when needed and blocks spreadsheet formula injection.
export function csvCell(value) {
  let text = String(value ?? "")
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function attendanceCsv(event, attendees, checkins) {
  const days = eventDays(event)
  const byAttendee = daysByAttendee(checkins)
  const header = ["Name", "Organisation", "Email", "Phone", "Role", "Gender", ...days.map((d) => `Day ${d.day} (${d.date})`), "Days attended", "Certificate eligible"]
  const lines = [header.map(csvCell).join(",")]
  for (const a of attendees) {
    const attended = byAttendee.get(a.$id) || new Set()
    const result = certificateEligibility(event, attended)
    lines.push([
      a.fullName, a.organization, a.email, a.phone, a.role, a.gender ? a.gender[0].toUpperCase() + a.gender.slice(1) : "",
      ...days.map((d) => (attended.has(d.day) ? "Yes" : "")),
      result.daysAttended, result.eligible ? "Yes" : "No",
    ].map(csvCell).join(","))
  }
  return lines.join("\r\n") + "\r\n"
}
