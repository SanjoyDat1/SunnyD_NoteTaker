import { useState } from "react";
import { loginSyncAccount, registerSyncAccount } from "./syncAuth.js";

export function SyncLoginScreen({ onAuthenticated }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [exiting, setExiting] = useState(false);

  const submit = async () => {
    const e = email.trim();
    if (!e) {
      setErr("Email is required.");
      return;
    }
    if (!password || password.length < 8) {
      setErr("Password must be at least 8 characters.");
      return;
    }
    if (mode === "register" && password !== confirm) {
      setErr("Passwords do not match.");
      return;
    }

    setLoading(true);
    setErr("");
    try {
      const fn = mode === "register" ? registerSyncAccount : loginSyncAccount;
      const body = await fn(e, password);
      setExiting(true);
      setTimeout(() => onAuthenticated(body.user), 480);
    } catch (error) {
      setErr(error.message?.slice(0, 160) || "Could not sign in.");
      setLoading(false);
    }
  };

  return (
    <div className={`key-screen${exiting ? " key-screen--exiting" : ""}`}>
      <div className="key-bg-deco" aria-hidden />
      <div className={`key-card${exiting ? " key-card--exit" : ""}`}>
        <div className="key-brand">
          <div className="key-brand-mark">
            <img src="/sunnyd-logo.png" alt="" className="key-brand-img" />
          </div>
          <div className="key-brand-text">
            <span className="key-brand-name">SunnyD</span>
            <span className="key-brand-tag">Cloud sync</span>
          </div>
        </div>

        <div className="key-divider" />

        <h1 className="key-heading">{mode === "login" ? "Sign in to sync" : "Create sync account"}</h1>
        <p className="key-sub">
          Notes sync to your SunnyD server. API keys and Google tokens stay in your browser — never on the sync server.
        </p>

        <div className="key-field-label">Email</div>
        <div className="key-inp-wrap">
          <input
            className="key-inp"
            type="email"
            autoComplete="email"
            placeholder="you@school.edu"
            value={email}
            onChange={ev => { setEmail(ev.target.value); setErr(""); }}
            onKeyDown={ev => ev.key === "Enter" && !loading && submit()}
            autoFocus
          />
        </div>

        <div className="key-field-label">Password</div>
        <div className="key-inp-wrap">
          <input
            className="key-inp"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            placeholder="At least 8 characters"
            value={password}
            onChange={ev => { setPassword(ev.target.value); setErr(""); }}
            onKeyDown={ev => ev.key === "Enter" && !loading && submit()}
          />
        </div>

        {mode === "register" && (
          <>
            <div className="key-field-label">Confirm password</div>
            <div className="key-inp-wrap">
              <input
                className="key-inp"
                type="password"
                autoComplete="new-password"
                placeholder="Repeat password"
                value={confirm}
                onChange={ev => { setConfirm(ev.target.value); setErr(""); }}
                onKeyDown={ev => ev.key === "Enter" && !loading && submit()}
              />
            </div>
          </>
        )}

        {err && (
          <div className="key-err" role="alert">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            {err}
          </div>
        )}

        <button className="key-btn" onClick={submit} disabled={loading || !email.trim() || !password}>
          {loading ? (
            <><span className="key-btn-spinner" aria-hidden /><span>{mode === "login" ? "Signing in…" : "Creating account…"}</span></>
          ) : (
            <span>{mode === "login" ? "Sign in" : "Create account"}</span>
          )}
        </button>

        <div className="key-footer">
          <button
            type="button"
            className="key-footer-link"
            style={{ background: "none", border: "none", cursor: "pointer", padding: 0, font: "inherit" }}
            onClick={() => { setMode(m => (m === "login" ? "register" : "login")); setErr(""); setConfirm(""); }}
          >
            {mode === "login" ? "Need an account? Register" : "Already have an account? Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}
