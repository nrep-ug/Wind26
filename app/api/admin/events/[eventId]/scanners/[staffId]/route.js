export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { route, json, readJson } from "@/lib/server/http.mjs"
import { adminContext } from "@/lib/server/context.mjs"
import { setScannerStatus } from "@/lib/server/services/staff.mjs"

export const PATCH = route(async (request, { eventId, staffId }) => {
  const { event, admin, audit } = await adminContext(eventId)
  const body = await readJson(request)
  return json({ scanner: await setScannerStatus(event.$id, staffId, String(body.status || ""), audit, admin) })
})
