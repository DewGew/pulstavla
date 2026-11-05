import { useEffect, useState } from "react";
import { io } from "socket.io-client";
import { API_URL, WS_URL } from "../config";
import "./PresenceWidget.css";

const socket = io(WS_URL, { transports: ["websocket"] 
  auth: (cb) => cb({ token: localStorage.getItem("token") }),
});

export default function PresenceWidget({ currentUser }) {
  const [users, setUsers] = useState([]);
  const [presence, setPresence] = useState({}); // { username: true/false }
  const user = JSON.parse(localStorage.getItem("user") || "{}");
	const canEdit = user.role === "admin" || user.role === "suAdmin" || user.role === "user";
	const adminEdit = user.role === "admin" || user.role === "suAdmin";

  /* ---------------- Hämta användare och närvaro ---------------- */
  useEffect(() => {
    const loadUsers = async () => {
      try {
        const token = localStorage.getItem("token");
        const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};
        const resUsers = await fetch(`${API_URL}/presence/users`, { headers: authHeaders });
        if (!resUsers.ok) throw new Error(`HTTP ${resUsers.status}`);
        const allUsers = await resUsers.json();
        const filteredUsers = allUsers.filter(
          (u) => u.role === "user" || u.role === "admin" || u.role === "suAdmin"
        );
        setUsers(filteredUsers);

        const resPresence = await fetch(`${API_URL}/presence`, { headers: authHeaders });
        const presenceData = await resPresence.json();
        setPresence(presenceData);
      } catch {
        console.error("Kunde inte hämta användare eller närvaro");
      }
    };

    loadUsers();
  }, []);

  /* ---------------- WebSocket för realtidsuppdatering ---------------- */
  useEffect(() => {
		socket.on("presenceUpdated", ({ username, present }) => {
			setPresence(prev => ({
				...prev,
				[username]: {
					...prev[username],
					present
				}
			}));
		});

    return () => {
      socket.off("presenceUpdated");
    };
  }, []);

  /* ---------------- Toggle närvaro ---------------- */
	const togglePresence = async (username) => {
		const current = presence[username]?.present || false;
		const newState = !current;

		// uppdatera lokalt korrekt struktur
		setPresence(prev => ({
			...prev,
			[username]: {
				...prev[username],
				present: newState
			}
		}));

		try {
			await fetch(`${API_URL}/presence`, {
				method: "POST",
				headers: {
          "Content-Type": "application/json",
          ...(localStorage.getItem("token") ? { Authorization: `Bearer ${localStorage.getItem("token")}` } : {}),
        },
				body: JSON.stringify({ username, present: newState })
			});
		} catch {
			console.error("Kunde inte uppdatera närvaro på servern");
		}
	};

  return (
    <div className="widget presence-widget">
      <h3>Närvaro</h3>
			<h4 style={{ color: "var(--header-text)" }}>Produktion</h4>
      <div className="presence-list">
        {users
					.filter(u => u.role === "user")
					.map(u => (
          <div
            key={u._id || u.username}
            className={`presence-item ${presence[u.username]?.present ? "here" : "away"}`}
            onClick={canEdit ? () => togglePresence(u.username): undefined}
          >
            <span className="presence-name">{u.username}</span>
            <span className="presence-status">
              {presence[u.username]?.present ? "🟢" : "🔴"}
            </span>
          </div>
        ))}
				</div>
				<h4 style={{ color: "var(--header-text)" }}>Kontor</h4>
				<div className="presence-list">
				{users
					.filter(u => u.role === "admin" || u.role === "suAdmin")
					.map(u => (
          <div
            key={u._id || u.username}
            className={`presence-item ${presence[u.username]?.present ? "here" : "away"}`}
            onClick={adminEdit ? () => togglePresence(u.username): undefined}
          >
            <span className="presence-name">{u.username}</span>
            <span className="presence-status">
              {presence[u.username]?.present ? "🟢" : "🔴"}
            </span>
          </div>
        ))}
      </div>
			<div className="gc-legend-row">
					<div><span>🟢</span>= Närvarande</div>
					<div><span>🔴</span>= Frånvarande</div>
			</div>
    </div>
  );
}
