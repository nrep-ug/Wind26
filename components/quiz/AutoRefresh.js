"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

// Reloads the server-rendered page every few seconds, so a results screen stays current.
export default function AutoRefresh({ seconds = 15 }) {
  const router = useRouter()
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), seconds * 1000)
    return () => clearInterval(timer)
  }, [router, seconds])
  return null
}
