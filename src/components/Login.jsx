import { useState, useEffect } from "react";
import { API_URL } from "../config";

export default function Login({ onLogin }) {
  const [users, setUsers] = useState([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    async function fetchUsers() {
      try {
        const res = await fetch(`${API_URL}/users`);
        const data = await res.json();
        setUsers(data);
      } catch (err) {
        console.error(err);
        setError("Kunde inte hämta användare");
      }
    }
    fetchUsers();
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (!username || !password) {
      setError("Fyll i alla fält");
      return;
    }

    try {
      const res = await fetch(`${API_URL}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();

      if (!data.success) {
        setError(data.error || "Fel användarnamn eller lösenord");
        return;
      }
			
			// ✅ Spara token + användare
			localStorage.setItem("token", data.token);
			localStorage.setItem("user", JSON.stringify(data.user));

      // Skicka tillbaka användaren till App
      onLogin(data.user);

    } catch (err) {
      console.error(err);
      setError("Kunde inte ansluta till servern");
    }
  }
	

  return (
    <div className="login-wrapper">
      <form className="login-box" onSubmit={handleSubmit}>
        <h2>Logga in</h2>

        {error && <div className="login-error">{error}</div>}

				<select
					value={username}
					select required
					onChange={(e) => setUsername(e.target.value)}
				>
					<option value="">Välj användare</option>
					{users.map(u => (
						<option key={u._id} value={u.username}>
							{u.name || u.username}
						</option>
					))}
				</select>

        <input
          type="password"
          placeholder="Lösenord"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <button className="login-button" type="submit">
          Logga in
        </button>
      </form>
    </div>
  );
}
