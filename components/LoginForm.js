"use client"

import { useState } from "react"
import { api } from "@/components/api"
import Icon from "@/components/admin/Icon"

// mode "password": one shared admin password. mode "signin": an emailed 6-digit code.
export default function LoginForm({ mode = "signin" }) {
  const [step, setStep] = useState(mode === "password" ? "password" : "email")
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [password, setPassword] = useState("")
  const [show, setShow] = useState(false)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError("")
    try {
      if (step === "email") {
        await api("/api/auth/request-code", { method: "POST", body: { email } })
        setStep("code")
        setBusy(false)
        return
      }
      const result = step === "password"
        ? await api("/api/auth/password", { method: "POST", body: { password } })
        : await api("/api/auth/verify-code", { method: "POST", body: { email, code } })
      window.location.href = result.redirectTo
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  return (
    <main className="auth">
      <form className="auth-card stack" onSubmit={submit}>
        <span className="logo">NREP<span>Events</span></span>
        <h1>Sign in</h1>
        {error && <p className="notice bad" role="alert">{error}</p>}
        {step === "password" && (
          <label htmlFor="password">
            Admin password or scanner code
            <span className="password-field">
              {/* Phones must not capitalise or "correct" a password or code while it is visible. */}
              <input id="password" type={show ? "text" : "password"} autoComplete="current-password" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                required autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
              <button type="button" className="ghost icon-btn" aria-label={show ? "Hide password" : "Show password"} aria-pressed={show}
                title={show ? "Hide password" : "Show password"} onClick={() => setShow((v) => !v)}>
                <Icon name={show ? "eye-off" : "eye"} />
              </button>
            </span>
            <span className="muted small">Scanner helpers: enter the code the organiser gave you, e.g. K7QM-4RXP-2WTN.</span>
          </label>
        )}
        {step === "email" && (
          <label htmlFor="email">
            Email
            <input id="email" type="email" autoComplete="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
        )}
        {step === "code" && (
          <label htmlFor="code">
            Code sent to {email}
            <input id="code" className="code-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6}
              required autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
          </label>
        )}
        <button type="submit" disabled={busy || (step === "code" && code.length !== 6)}>
          {busy ? "Please wait…" : step === "email" ? "Continue" : "Sign in"}
        </button>
        {step === "code" && (
          <button type="button" className="link" onClick={() => { setStep("email"); setCode(""); setError("") }}>Use another email</button>
        )}
      </form>
    </main>
  )
}
