// Email bodies. Every value is escaped; nothing from attendees reaches HTML raw.

export const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#039;")

const MUTED = "#5b6770"

function frame(title, bodyHtml, footer = "") {
  return `<!doctype html><html><body style="margin:0;background:#f2f6f6;font-family:Arial,Helvetica,sans-serif;color:#1f2933">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:#ffffff;border-radius:10px;overflow:hidden">
<tr><td style="background:#0f5e63;color:#ffffff;padding:18px 28px;font-size:17px;font-weight:bold">${escapeHtml(title)}</td></tr>
<tr><td style="padding:28px;font-size:15px;line-height:1.6">${bodyHtml}</td></tr>
${footer ? `<tr><td style="padding:16px 28px;border-top:1px solid #e3e8ea;color:${MUTED};font-size:12px;line-height:1.5">${footer}</td></tr>` : ""}
</table></td></tr></table></body></html>`
}

const button = (href, label, secondary = false) =>
  `<p style="margin:24px 0"><a href="${escapeHtml(href)}" style="${secondary ? "background:#ffffff;color:#0f5e63;border:2px solid #0f5e63" : "background:#0f5e63;color:#ffffff"};text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:bold;display:inline-block">${escapeHtml(label)}</a></p>`

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
const dateParts = (date) => {
  const d = new Date(`${date}T12:00:00Z`)
  return { weekday: WEEKDAYS[d.getUTCDay()], day: d.getUTCDate(), month: MONTHS[d.getUTCMonth()], year: d.getUTCFullYear() }
}

// "Tuesday 10 to Thursday 12 November 2026", or a single date for a one-day event.
export function dateRange(event) {
  const a = dateParts(event.startDate)
  const b = dateParts(event.endDate)
  const end = `${b.weekday} ${b.day} ${b.month} ${b.year}`
  if (event.startDate === event.endDate) return end
  if (a.year !== b.year) return `${a.weekday} ${a.day} ${a.month} ${a.year} to ${end}`
  if (a.month !== b.month) return `${a.weekday} ${a.day} ${a.month} to ${end}`
  return `${a.weekday} ${a.day} to ${end}`
}

const where = (event) => `from ${dateRange(event)}${event.venue ? ` at ${event.venue}` : ""}`
const signer = (event) => event.organiser || ""
const contactText = (event) => event.contactEmail ? `please contact us at ${event.contactEmail}` : "please reply to this email"
const contactHtml = (event) => event.contactEmail
  ? `please contact us at <a href="mailto:${escapeHtml(event.contactEmail)}" style="color:#0f5e63">${escapeHtml(event.contactEmail)}</a>`
  : "please reply to this email"

function signOff(event) {
  return {
    text: `Kind regards,\n\nThe Organising Team${signer(event) ? `\n${signer(event)}` : ""}`,
    html: `<p style="margin-top:28px">Kind regards,</p><p style="margin:0"><strong>The Organising Team</strong>${signer(event) ? `<br>${escapeHtml(signer(event))}` : ""}</p>`,
  }
}

const footer = (event) => `${escapeHtml(event.name)}<br>${escapeHtml(where(event).replace(/^from /, ""))}`

export function signInCodeEmail({ name, code }) {
  const text = `Hello ${name},\n\nYour sign-in code is ${code}. It expires in 10 minutes.\n\nIf you didn't ask for this code, you can ignore this email.`
  const html = frame("Your sign-in code", `<p>Hello ${escapeHtml(name)},</p>
<p>Your sign-in code is:</p><p style="font-size:30px;letter-spacing:6px;font-weight:bold;margin:8px 0 16px">${escapeHtml(code)}</p>
<p>It expires in 10 minutes. If you didn't ask for this code, you can ignore this email.</p>`)
  return { subject: `Sign-in code: ${code}`, text, html }
}

// The quiz paragraph: when it opens, and that the same personal link works throughout.
function quizNote(event) {
  const time = event.quizOpens || event.checkinOpens
  const d = dateParts(event.startDate)
  const when = time ? ` It opens at ${time} on ${d.weekday} ${d.day} ${d.month}.` : ""
  return `During the training you will be asked to complete a short quiz.${when} Use the quiz link below.`
}

export function tagEmail({ event, attendee, link, quizLink, attached }) {
  const name = event.shortName || event.name
  const sign = signOff(event)
  const privacy = quizLink
    ? "These links are unique to you. Please do not share them, as they confirm your attendance, your quiz results and your eligibility for a certificate."
    : "This link is unique to you. Please do not share it, as it confirms your attendance and your eligibility for a certificate."
  const opens = event.checkinOpens ? ` Registration opens at ${event.checkinOpens} each day.` : ""
  const text = [
    `Dear ${attendee.fullName},`,
    `Thank you for confirming your participation in the ${event.name}, taking place ${where(event)}.`,
    `Your personal delegate badge is ready. Please present the QR code on your badge at the registration desk each morning to record your attendance.${opens}`,
    `View your badge: ${link}`,
    attached ? "Your badge is also attached to this email. You may show it on your phone or bring a printed copy." : "You may show your badge on your phone or bring a printed copy.",
    ...(quizLink ? [quizNote(event), `Take the quiz: ${quizLink}`] : []),
    privacy,
    `If any of the details on your badge are incorrect, ${contactText(event)}.`,
    "We look forward to welcoming you.",
    sign.text,
  ].join("\n\n")
  const html = frame(name, `<p>Dear ${escapeHtml(attendee.fullName)},</p>
<p>Thank you for confirming your participation in the <strong>${escapeHtml(event.name)}</strong>, taking place ${escapeHtml(where(event))}.</p>
<p>Your personal delegate badge is ready. Please present the QR code on your badge at the registration desk each morning to record your attendance.${escapeHtml(opens)}</p>
${button(link, "View my badge")}
<p>${attached ? "Your badge is also attached to this email. You may show it on your phone or bring a printed copy." : "You may show your badge on your phone or bring a printed copy."}</p>
${quizLink ? `<p>${escapeHtml(quizNote(event))}</p>
${button(quizLink, "Take the quiz", true)}` : ""}
<p style="color:${MUTED};font-size:13px">${privacy}</p>
<p>If any of the details on your badge are incorrect, ${contactHtml(event)}.</p>
<p>We look forward to welcoming you.</p>
${sign.html}`, footer(event))
  return { subject: `Your delegate badge: ${name}`, text, html }
}

// A short reminder with only the quiz link, for when the badge email's link is hard to find.
export function quizLinkEmail({ event, attendee, quizLink, title }) {
  const name = event.shortName || event.name
  const sign = signOff(event)
  const quizName = title || "The quiz"
  const text = [
    `Dear ${attendee.fullName},`,
    `${quizName} for the ${event.name} is now open.`,
    `Open your quiz here: ${quizLink}`,
    "Please use this link rather than links in earlier emails. It opens on your phone or laptop and works on mobile data or Wi-Fi.",
    "This link is unique to you. Please do not share it, as your answers are recorded under your name. You can submit once.",
    sign.text,
  ].join("\n\n")
  const html = frame(name, `<p>Dear ${escapeHtml(attendee.fullName)},</p>
<p><strong>${escapeHtml(quizName)}</strong> for the ${escapeHtml(event.name)} is now open.</p>
${button(quizLink, "Open my quiz")}
<p>Please use this link rather than links in earlier emails. It opens on your phone or laptop and works on mobile data or Wi-Fi.</p>
<p style="color:${MUTED};font-size:13px">If the button does not work, copy this address into your browser:<br><a href="${escapeHtml(quizLink)}">${escapeHtml(quizLink)}</a></p>
<p style="color:${MUTED};font-size:13px">This link is unique to you. Please do not share it, as your answers are recorded under your name. You can submit once.</p>
${sign.html}`, footer(event))
  return { subject: `Your quiz link: ${name}`, text, html }
}

export function certificateEmail({ event, certificate, link, attached }) {
  const name = event.shortName || event.name
  const sign = signOff(event)
  const text = [
    `Dear ${certificate.nameOnCertificate},`,
    `Thank you for your participation in the ${event.name}, held ${where(event)}.`,
    `We are pleased to share your certificate in recognition of your attendance.${attached ? " It is attached to this email as a PDF." : ""}`,
    `You can view and download your certificate at any time: ${link}`,
    `If the name on your certificate needs correcting, ${contactText(event)}.`,
    "Congratulations, and thank you for being part of the programme.",
    sign.text,
  ].join("\n\n")
  const html = frame(name, `<p>Dear ${escapeHtml(certificate.nameOnCertificate)},</p>
<p>Thank you for your participation in the <strong>${escapeHtml(event.name)}</strong>, held ${escapeHtml(where(event))}.</p>
<p>We are pleased to share your certificate in recognition of your attendance.${attached ? " It is attached to this email as a PDF." : ""}</p>
${button(link, "View and download certificate")}
<p>If the name on your certificate needs correcting, ${contactHtml(event)}.</p>
<p>Congratulations, and thank you for being part of the programme.</p>
${sign.html}`, footer(event))
  return { subject: `Your certificate: ${name}`, text, html }
}
