export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { route } from "@/lib/server/http.mjs"
import { adminContext, fileResponse } from "@/lib/server/context.mjs"
import { COLLECTIONS } from "@/lib/server/db/index.mjs"
import { badRequest } from "@/lib/server/errors.mjs"
import { certificatesPdf } from "@/lib/server/services/documents.mjs"

// All issued certificates of the event in one PDF, one per page. Revoked ones are left out.
export const GET = route(async (_request, { eventId }) => {
  const { db, event } = await adminContext(eventId)
  const certificates = await db.listAll(COLLECTIONS.certificates)
  if (!certificates.some((c) => c.status === "issued")) throw badRequest("No certificates have been issued yet.")
  return fileResponse(await certificatesPdf(event, certificates), { type: "application/pdf", filename: `${event.code}-certificates.pdf` })
})
