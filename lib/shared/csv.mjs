import { validateAttendee } from "./validation.mjs"

export const IMPORT_MAX_ROWS = 1000

// RFC 4180 parser: quoted fields, escaped quotes, commas and newlines inside quotes.
export function parseCsv(text) {
  const input = String(text || "").replace(/^﻿/, "")
  const rows = []
  let row = []
  let field = ""
  let quoted = false
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') { field += '"'; i += 1 }
      else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"' && field === "") quoted = true
    else if (ch === ",") { row.push(field); field = "" }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i += 1
      row.push(field); rows.push(row); row = []; field = ""
    } else field += ch
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""))
}

const HEADER_ALIASES = {
  fullName: ["full name", "fullname", "name", "participant", "participant name"],
  organization: ["organisation", "organization", "org", "company", "institution"],
  email: ["email", "email address", "e-mail"],
  phone: ["phone", "phone number", "telephone", "mobile", "tel"],
  role: ["role", "category", "type"],
  gender: ["gender", "sex"],
}

function mapHeader(cells) {
  const map = {}
  cells.forEach((cell, index) => {
    const key = cell.trim().toLowerCase().replace(/[_]+/g, " ")
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.includes(key) && map[field] === undefined) map[field] = index
    }
  })
  return map
}

export function attendeeIdentity(a) {
  if (a.email) return `email:${a.email}`
  return `name:${a.fullName.toLowerCase()}|${(a.organization || "").toLowerCase()}`
}

// Validates an import against itself and the attendees already registered.
export function prepareImport(text, existing = []) {
  const rows = parseCsv(text)
  if (!rows.length) return { ok: false, message: "The file is empty.", rows: [] }
  const header = mapHeader(rows[0])
  if (header.fullName === undefined) {
    return { ok: false, message: "Add a header row with a 'Name' column (Organisation, Email, Phone and Role are optional).", rows: [] }
  }
  const body = rows.slice(1)
  if (body.length > IMPORT_MAX_ROWS) return { ok: false, message: `Import at most ${IMPORT_MAX_ROWS} rows at a time.`, rows: [] }

  const known = new Set(existing.map(attendeeIdentity))
  const seen = new Map()
  const out = body.map((cells, i) => {
    const pick = (field) => (header[field] === undefined ? "" : cells[header[field]] ?? "")
    const result = validateAttendee({
      fullName: pick("fullName"), organization: pick("organization"), email: pick("email"), phone: pick("phone"),
      role: pick("role").trim().toLowerCase() || "participant", gender: pick("gender"),
    })
    const line = i + 2
    const errors = Object.values(result.errors)
    if (result.ok) {
      const id = attendeeIdentity(result.value)
      if (known.has(id)) errors.push("Already registered for this event.")
      else if (seen.has(id)) errors.push(`Duplicate of row ${seen.get(id)}.`)
      else seen.set(id, line)
    }
    return { line, value: result.value, errors }
  })
  return {
    ok: true,
    rows: out,
    valid: out.filter((r) => !r.errors.length).length,
    invalid: out.filter((r) => r.errors.length).length,
  }
}
