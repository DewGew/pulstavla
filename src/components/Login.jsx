import { useState } from "react";
import { API_URL } from "../config";

export default function Login({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (pending) return;
    setError("");

    if (!username || !password) {
      setError("Fyll i användarnamn och lösenord");
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 15000);
    setPending(true);

    try {
      const res = await fetch(`${API_URL}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
        signal: controller.signal,
      });

      let data = {};
      try {
        data = await res.json();
      } catch {
        // Servern kan svara med ett tomt eller ogiltigt JSON-svar.
      }

      if (!res.ok || !data.success) {
        setError(data.error || (res.status >= 500
          ? "Serverfel. Försök igen om en stund."
          : "Fel användarnamn eller lösenord"));
        return;
      }

      if (!data.token || !data.user) {
        setError("Servern returnerade ett ogiltigt inloggningssvar.");
        return;
      }

      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      onLogin(data.user);
    } catch (err) {
      if (err?.name === "AbortError") {
        setError("Inloggningen tog för lång tid. Försök igen.");
      } else {
        console.error("Inloggning misslyckades:", err);
        setError("Kunde inte nå servern. Kontrollera nätverksanslutningen.");
      }
    } finally {
      window.clearTimeout(timeoutId);
      setPending(false);
    }
  }

  return (
    <div className="login-wrapper">
      <form className="login-box" onSubmit={handleSubmit}>
        <h2>Logga in</h2>

        {error && <div className="login-error">{error}</div>}

        <input
          type="text"
          placeholder="Användarnamn"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          required
        />

        <input
          type="password"
          placeholder="Lösenord"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />

        <button className="login-button" type="submit" disabled={pending}>
          {pending ? "Loggar in…" : "Logga in"}
        </button>
      </form>
    </div>
  );
}
