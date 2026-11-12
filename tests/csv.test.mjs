import test from "node:test"
import assert from "node:assert/strict"
import { parseCsv, prepareImport } from "../lib/shared/csv.mjs"

test("parses quoted fields, escaped quotes and CRLF", () => {
  assert.deepEqual(parseCsv('Name,Org\r\n"Achieng, Grace","Say ""hi"""\r\n\r\n'), [["Name", "Org"], ["Achieng, Grace", 'Say "hi"']])
  assert.deepEqual(parseCsv("﻿Name\nA"), [["Name"], ["A"]])
})

test("import maps common headers and validates rows", () => {
  const csv = "Full Name,Organisation,E-mail,Mobile\nGrace Achieng,NREP,grace@example.org,0772000000\nX,,bad,\n"
  const result = prepareImport(csv, [])
  assert.equal(result.valid, 1)
  assert.equal(result.invalid, 1)
  assert.equal(result.rows[0].value.organization, "NREP")
  assert.equal(result.rows[1].line, 3)
})

test("import reads an optional Gender column", () => {
  const result = prepareImport("Name,Sex\nGrace Achieng,F\nPeter Okello,Male\nJo Nambi,\n", [])
  assert.deepEqual(result.rows.map((r) => r.value.gender), ["female", "male", ""])
})

test("import rejects duplicates in the file and against existing attendees", () => {
  const existing = [{ fullName: "Peter Okello", organization: "", email: "peter@example.org" }]
  const csv = "Name,Email\nPeter O,peter@example.org\nAnn,ann@example.org\nAnn K,ANN@example.org\n"
  const result = prepareImport(csv, existing)
  assert.match(result.rows[0].errors.join(), /Already registered/)
  assert.equal(result.rows[1].errors.length, 0)
  assert.match(result.rows[2].errors.join(), /Duplicate of row 3/)
})

test("import needs a name column", () => {
  assert.equal(prepareImport("Email\na@b.co", []).ok, false)
})
