import { useEffect, useState } from "react";
import { io } from "socket.io-client";
import { API_URL, WS_URL } from "../config";

import "./ResourceWidget.css";

const socket = io(WS_URL, { transports: ["websocket"], 
  auth: (cb) => cb({ token: localStorage.getItem("token") }),
});

export default function ResourceWidget({ currentUser }) {
  const [status, setStatus] = useState({}); // { machineName: {status, operator} }
  const user = JSON.parse(localStorage.getItem("user") || "{}");
  const canEdit = user.role === "admin" || user.role === "suAdmin" || user.role === "user";
  const [activeMachine, setActiveMachine] = useState(null);
  const [selectedUser, setSelectedUser] = useState("");
  const [users, setUsers] = useState([]);
	const [machines, setMachines] = useState([]);
	const token = localStorage.getItem("token");

  useEffect(() => {
    fetch(`${API_URL}/presence/users`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(data => setUsers(data))
      .catch(() => console.error("Kunde inte hämta användare"));
  }, []);

  /* ---------------- Hämta maskinstatus ---------------- */
	useEffect(() => {
		const loadMachines = async () => {
			try {
				const res = await fetch(`${API_URL}/settings`, {
					headers: {
						Authorization: `Bearer ${token}`,
					},
				});

				if (!res.ok) throw new Error("Unauthorized");

				const data = await res.json();

				const visibleMachines =
					data.machines?.list?.filter(m => m.visible !== false) || [];

				setMachines(visibleMachines);
			} catch (err) {
				console.error("Kunde inte hämta resurser:", err.message);
			}
		};

		loadMachines();
	}, []);


	useEffect(() => {
		if (!machines.length) return;

		const loadStatus = async () => {
			try {
				const res = await fetch(`${API_URL}/presence`);
				const data = await res.json();

				const normalized = {};
				machines.forEach(m => {
					normalized[m.name] = data[m.name] || {
						status: "green",
						operator: ""
					};
				});

				setStatus(normalized);
			} catch {
				console.error("Kunde inte hämta maskinstatus");
			}
		};

		loadStatus();
	}, [machines]);


  /* ---------------- WebSocket uppdatering ---------------- */
  useEffect(() => {
    if (!socket.connected) socket.connect();
    socket.on("presenceUpdated", ({ username, status: s, operator }) => {
      setStatus((prev) => ({
        ...prev,
        [username]: { status: s, operator: operator || "" }
      }));
    });

    return () => socket.off("presenceUpdated");
  }, []);

  /* ---------------- Toggle maskinstatus ---------------- */
  const NEXT_STATUS = {
    green: "yellow",
    yellow: "red",
    red: "green"
  };

  const toggleStatus = async (machine) => {
    const current = status[machine]?.status || "green";
    const next = NEXT_STATUS[current];

    if (next === "green") {
      setActiveMachine(machine);
      return;
    }

    updateMachine(machine, { status: next });
  };

	const updateMachine = async (machine, payload) => {
		const body = {
			username: machine,
			present: payload.status === "green" ? true : false, // true = grön, false = röd/gul
			operator: payload.operator || ""
		};

		setStatus(prev => ({
			...prev,
			[machine]: {
				status: payload.status,
				operator: payload.operator || ""
			}
		}));

		try {
		await fetch(`${API_URL}/presence`, {
			method: "POST",
			headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
			body: JSON.stringify({
				username: machine,
				status: payload.status,
				operator: payload.operator || ""
			})
		});
		} catch {
			console.error("Kunde inte uppdatera maskin");
		}
	};


  return (
    <>
      <div className="widget resource-widget">
        <h3>Resursstatus</h3>

        <div className="resource-list">
				{machines.map(m => {
					const machineName = m.name;
					const machineNumber = m.number;

					return (
						<div
							key={machineName}
							className={`resource-item ${status[machineName]?.status || "green"}`}
							onClick={canEdit ? () => toggleStatus(machineName) : undefined}
						>
							<span className="resource-name">
								{machineName} {machineNumber ? ` (${machineNumber})` : ""}
								{status[machineName]?.operator && (
									<small> ({status[machineName].operator})</small>
								)}
							</span>
						</div>
					);
				})}
        </div>
        <div className="gc-legend-row">
            <div><span>🟢</span>= Ok</div>
            <div><span>🟡</span>= Obemannad</div>
            <div><span>🔴</span>= Ur funktion</div>
        </div>
      </div>

      {activeMachine && (
        <div className="modal" onClick={() => setActiveMachine(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h4 style={{ color: "var(--header-text)" }}>Välj operatör – {activeMachine}</h4>

            <select
              value={selectedUser}
              onChange={e => setSelectedUser(e.target.value)}
            >
              <option value="">-- välj användare --</option>
							<option value="Praktikant">Praktikant</option>
							{users
								.filter(u => u.role === "user")
								.map(u => (
									<option key={u._id} value={u.username}>
										{u.name}
									</option>
								))}
            </select>

            <div className="modal-actions">
              <button
                className="btn-primary"
                disabled={!selectedUser}
                onClick={() => {
                  updateMachine(activeMachine, {
                    status: "green",
                    operator: selectedUser
                  });
                  setActiveMachine(null);
                  setSelectedUser("");
                }}
              >
                Bekräfta
              </button>

              <button
								className="btn-danger"
								onClick={() => {
                  updateMachine(activeMachine, {
                    status: "yellow",
                    operator: null
                  });
                  setActiveMachine(null);
                  setSelectedUser("");
                }}
								style={{ marginLeft: "5px" }}
							>
							  Avbryt
							</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
