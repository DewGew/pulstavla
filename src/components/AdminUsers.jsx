import { useEffect, useState, useCallback, useRef } from "react";
import { io } from "socket.io-client";
import { API_URL, WS_URL } from "../config";
import "./AdminUsers.css";

export default function AdminUsers({ currentUser, hideTitle = false, flat = false }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [presence, setPresence] = useState({});

  // FIX: inline confirm state instead of blocking confirm()
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const [newUser, setNewUser] = useState({
    username: "",
    password: "",
    role: "user",
    email: "",
    name: "",
  });

  const [editUser, setEditUser] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);

  // FIX: read token once with stable useState initializer
  const [token] = useState(() => localStorage.getItem("token"));

  // FIX: use a ref for the auto-clear timer so it can be cancelled on unmount
  const msgTimerRef = useRef(null);

  // FIX: messages auto-clear after 4 seconds
  const showMsg = useCallback((text) => {
    setMsg(text);
    if (msgTimerRef.current) clearTimeout(msgTimerRef.current);
    msgTimerRef.current = setTimeout(() => setMsg(""), 4000);
  }, []);

  useEffect(() => {
    return () => {
      if (msgTimerRef.current) clearTimeout(msgTimerRef.current);
    };
  }, []);

  /* ---------------- FETCH USERS ---------------- */
  // FIX: wrapped in useCallback for stable reference + auth header added
  const loadUsers = useCallback(async () => {
    setMsg("");
    try {
      setLoading(true);
      const res = await fetch(`${API_URL}/users`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setUsers(await res.json());
    } catch {
      showMsg("❌ Kunde inte hämta användare.");
    } finally {
      setLoading(false);
    }
  }, [token, showMsg]);

  // FIX: loadUsers in dependency array now that it's stable
  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  /* ---------------- PRESENCE ---------------- */
  // FIX: auth header added, error handled
  useEffect(() => {
    fetch(`${API_URL}/presence`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((res) => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then((data) => setPresence(data))
      .catch(() => console.warn("Kunde inte hämta närvaro"));
  }, [token]);

  /* ---------------- WEBSOCKET ---------------- */
  // FIX: socket created inside useEffect so it's tied to component lifecycle
  // and properly cleaned up on unmount. Named handler passed to both
  // socket.on and socket.off so only THIS listener is removed.
  useEffect(() => {
    const socket = io(WS_URL, { transports: ["websocket"] });

    const handleOnlineUpdated = ({ username, online }) => {
      setPresence((prev) => ({
        ...prev,
        [username]: { ...prev[username], online },
      }));
    };

    socket.on("onlineUpdated", handleOnlineUpdated);

    // FIX: pass the named handler so only this listener is removed
    return () => {
      socket.off("onlineUpdated", handleOnlineUpdated);
      socket.disconnect();
    };
  }, []);

  /* ---------------- ADD USER ---------------- */
  const addUser = async () => {
    setMsg("");
    if (!newUser.username || !newUser.password || !newUser.email || !newUser.name) {
      showMsg("⚠️ Du måste ange namn, användarnamn, lösenord och e-post.");
      return false; // FIX: return success flag so caller can decide to close modal
    }

    try {
      const res = await fetch(`${API_URL}/users/add`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`, // FIX: auth header
        },
        body: JSON.stringify(newUser),
      });

      if (!res.ok) throw new Error();

      showMsg("✔️ Ny användare skapad!");
      setNewUser({ username: "", password: "", role: "user", email: "", name: "" });
      loadUsers();
      return true;
    } catch {
      showMsg("❌ Kunde inte skapa användaren.");
      return false;
    }
  };

  /* ---------------- REMOVE USER ---------------- */
  // FIX: no confirm() — uses confirmDeleteId state for inline confirm
  const deleteUser = async (id) => {
    try {
      await fetch(`${API_URL}/users/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }, // FIX: auth header
      });
      showMsg("🗑️ Användare borttagen.");
      setConfirmDeleteId(null);
      loadUsers();
    } catch {
      showMsg("❌ Kunde inte ta bort användaren.");
    }
  };

  /* ---------------- UPDATE ROLE ---------------- */
  const updateRole = async (id, role) => {
    try {
      await fetch(`${API_URL}/users/${id}/role`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`, // FIX: auth header
        },
        body: JSON.stringify({ role }),
      });
      showMsg("✔️ Roll uppdaterad.");
      loadUsers();
    } catch {
      showMsg("❌ Kunde inte ändra roll.");
    }
  };

  /* ---------------- OPEN EDIT MODAL ---------------- */
  const openEditModal = (user) => {
    setEditUser({ ...user, password: "" });
    setModalOpen(true);
  };

  /* ---------------- SAVE EDITS ---------------- */
  const saveEditUser = async () => {
    if (!editUser.name || !editUser.username || !editUser.email) {
      showMsg("⚠️ Namn, användarnamn och e-post krävs.");
      return;
    }

    try {
      const res = await fetch(`${API_URL}/users/${editUser._id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`, // FIX: auth header
        },
        body: JSON.stringify(editUser),
      });

      if (!res.ok) throw new Error();

      showMsg("✔️ Användare uppdaterad.");
      setModalOpen(false);
      loadUsers();
    } catch {
      showMsg("❌ Kunde inte uppdatera användaren.");
    }
  };

  /* ---------------- AUTO-LOGIN (IP -> användare) ---------------- */
  const [autoLoginList, setAutoLoginList] = useState([]);
  const [autoLoginLoading, setAutoLoginLoading] = useState(true);
  const [autoLoginSaving, setAutoLoginSaving] = useState(false);
  const [showAutoLoginSection, setShowAutoLoginSection] = useState(false);

  const [newAutoLogin, setNewAutoLogin] = useState({
    ip: "",
    username: "",
    password: "",
  });

  const [editAutoLoginIndex, setEditAutoLoginIndex] = useState(null);
  const [editAutoLoginEntry, setEditAutoLoginEntry] = useState(null);
  const [confirmDeleteAutoLoginIndex, setConfirmDeleteAutoLoginIndex] = useState(null);
  const [visiblePasswords, setVisiblePasswords] = useState({});

  const loadAutoLogin = useCallback(async () => {
    try {
      setAutoLoginLoading(true);
      const res = await fetch(`${API_URL}/settings/autoLogin`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      // FIX: 404 betyder bara att inställningen inte skapats än — inte ett fel
      if (res.status === 404) {
        setAutoLoginList([]);
        return;
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setAutoLoginList(await res.json());
    } catch {
      showMsg("❌ Kunde inte hämta auto-login-listan.");
    } finally {
      setAutoLoginLoading(false);
    }
  }, [token, showMsg]);

  useEffect(() => {
    loadAutoLogin();
  }, [loadAutoLogin]);

  // FIX: enda stället som faktiskt sparar mot servern — alla knappar
  // nedan bygger den nya listan och skickar den hit.
  const saveAutoLoginList = async (list) => {
    setAutoLoginSaving(true);
    try {
      const res = await fetch(`${API_URL}/settings/autoLogin`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ value: list }),
      });

      if (!res.ok) throw new Error();

      setAutoLoginList(list);
      showMsg("✔️ Auto-login sparad.");
    } catch {
      showMsg("❌ Kunde inte spara auto-login.");
    } finally {
      setAutoLoginSaving(false);
    }
  };

  const addAutoLogin = () => {
    if (!newAutoLogin.ip.trim() || !newAutoLogin.username.trim() || !newAutoLogin.password) {
      showMsg("⚠️ IP, användarnamn och lösenord krävs för auto-login.");
      return;
    }

    if (autoLoginList.some((e) => e.ip === newAutoLogin.ip.trim())) {
      showMsg("⚠️ Den IP-adressen har redan en auto-login-post.");
      return;
    }

    const entry = {
      ip: newAutoLogin.ip.trim(),
      username: newAutoLogin.username.trim(),
      password: newAutoLogin.password,
    };

    saveAutoLoginList([...autoLoginList, entry]);
    setNewAutoLogin({ ip: "", username: "", password: "" });
  };

  const startEditAutoLogin = (index) => {
    setEditAutoLoginIndex(index);
    setEditAutoLoginEntry({ ...autoLoginList[index] });
  };

  const cancelEditAutoLogin = () => {
    setEditAutoLoginIndex(null);
    setEditAutoLoginEntry(null);
  };

  const saveEditAutoLogin = () => {
    if (
      !editAutoLoginEntry.ip.trim() ||
      !editAutoLoginEntry.username.trim() ||
      !editAutoLoginEntry.password
    ) {
      showMsg("⚠️ IP, användarnamn och lösenord krävs för auto-login.");
      return;
    }

    const duplicate = autoLoginList.some(
      (e, i) => i !== editAutoLoginIndex && e.ip === editAutoLoginEntry.ip.trim()
    );
    if (duplicate) {
      showMsg("⚠️ Den IP-adressen har redan en auto-login-post.");
      return;
    }

    const updatedList = autoLoginList.map((e, i) =>
      i === editAutoLoginIndex
        ? {
            ip: editAutoLoginEntry.ip.trim(),
            username: editAutoLoginEntry.username.trim(),
            password: editAutoLoginEntry.password,
          }
        : e
    );

    saveAutoLoginList(updatedList);
    cancelEditAutoLogin();
  };

  const removeAutoLogin = (index) => {
    const updatedList = autoLoginList.filter((_, i) => i !== index);
    saveAutoLoginList(updatedList);
    setConfirmDeleteAutoLoginIndex(null);
  };

  const togglePasswordVisible = (index) => {
    setVisiblePasswords((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  /* ---------------- RENDER ---------------- */
  return (
    <div className={`admin-users ${flat ? "flat" : ""}`}>
      {!hideTitle && <h2>Hantera användare</h2>}

      {msg && <div className="admin-msg">{msg}</div>}
      {loading && <p>Laddar användare...</p>}

      <button
        className="btn-primary"
        style={{ marginBottom: "15px" }}
        onClick={() => setAddModalOpen(true)}
      >
        ➕ Lägg till användare
      </button>

      {/* -------- USER TABLE -------- */}
      <table className="user-table">
        <thead>
          <tr>
            <th>Namn</th>
            <th>Användarnamn</th>
            <th>E-post</th>
            <th>Roll</th>
            <th>Åtgärder</th>
            <th>Status</th>
            <th>Senaste inloggning</th>
          </tr>
        </thead>

        <tbody>
          {users.map((u) => (
            <tr key={u._id}>
              <td>{u.name}</td>
              <td>{u.username}</td>
              <td>{u.email}</td>

              <td>
                <select
                  value={u.role}
                  disabled={
                    u.role === "suAdmin" && currentUser.role !== "suAdmin"
                  }
                  onChange={(e) => updateRole(u._id, e.target.value)}
                >
                  <option value="view">Viewer</option>
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                  <option
                    value="suAdmin"
                    disabled={currentUser.role !== "suAdmin"}
                  >
                    Super Admin
                  </option>
                </select>
              </td>

              <td>
                {currentUser.username === u.username ? (
                  <em style={{ color: "gray" }}>Ej tillgängligt</em>
                ) : !(u.role === "suAdmin" && currentUser.role !== "suAdmin") ? (
                  <span style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
                    <button
                      className="btn-primary"
                      onClick={() => openEditModal(u)}
                    >
                      Redigera
                    </button>

                    {/* FIX: inline confirm instead of blocking confirm() */}
                    {confirmDeleteId === u._id ? (
                      <>
                        <span style={{ fontSize: "0.85rem" }}>Säker?</span>
                        <button
                          className="btn-danger"
                          onClick={() => deleteUser(u._id)}
                        >
                          Ja
                        </button>
                        <button
                          className="btn-primary"
                          onClick={() => setConfirmDeleteId(null)}
                        >
                          Nej
                        </button>
                      </>
                    ) : (
                      <button
                        className="btn-danger"
                        onClick={() => setConfirmDeleteId(u._id)}
                      >
                        Ta bort
                      </button>
                    )}
                  </span>
                ) : null}
              </td>

              <td>
                {presence[u.username]?.online ? "🟢 Online" : "⚫ Offline"}
                <br />
                {presence[u.username]?.present && "🧍 Närvarande"}
              </td>

              {/* Last login time — stored in usersDB by server on login */}
              <td style={{ whiteSpace: "nowrap", color: u.lastLogin ? "inherit" : "gray" }}>
                {u.lastLogin
                  ? new Date(u.lastLogin).toLocaleString("sv-SE", {
                      year: "numeric",
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "Aldrig"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* -------- AUTO-LOGIN SECTION -------- */}
      <div style={{ marginTop: "30px" }}>
		  {currentUser.role === "suAdmin" && (
			<button
			  className="btn-secondary"
			  onClick={() => setShowAutoLoginSection((v) => !v)}
			>
			  {showAutoLoginSection ? "▾" : "▸"} 🖥️ Automatisk inloggning (IP-baserad)
			</button>
		  )}
        {showAutoLoginSection && (
          <div className="autologin" style={{ marginTop: "12px" }}>
            <p style={{ fontSize: "0.85rem", color: "gray", maxWidth: "700px" }}>
              Enheter (t.ex. kioskdatorer) med en IP-adress i listan nedan loggas
              in automatiskt som angiven användare, utan att någon behöver skriva
              in uppgifter. Lösenordet måste stämma med användarens riktiga
              lösenord — ändra det här om användarens lösenord ändras.
            </p>

            {autoLoginLoading ? (
              <p>Laddar auto-login...</p>
            ) : (
              <table className="user-table">
                <thead>
                  <tr>
                    <th>IP-adress</th>
                    <th>Användarnamn</th>
                    <th>Lösenord</th>
                    <th>Åtgärder</th>
                  </tr>
                </thead>

                <tbody>
                  {autoLoginList.map((entry, index) =>
                    editAutoLoginIndex === index ? (
                      <tr key={index}>
                        <td>
                          <input
                            type="text"
                            value={editAutoLoginEntry.ip}
                            onChange={(e) =>
                              setEditAutoLoginEntry({
                                ...editAutoLoginEntry,
                                ip: e.target.value,
                              })
                            }
                          />
                        </td>
                        <td>
                          <input
                            type="text"
                            value={editAutoLoginEntry.username}
                            onChange={(e) =>
                              setEditAutoLoginEntry({
                                ...editAutoLoginEntry,
                                username: e.target.value,
                              })
                            }
                          />
                        </td>
                        <td>
                          <input
                            type="text"
                            value={editAutoLoginEntry.password}
                            onChange={(e) =>
                              setEditAutoLoginEntry({
                                ...editAutoLoginEntry,
                                password: e.target.value,
                              })
                            }
                          />
                        </td>
                        <td style={{ display: "flex", gap: "6px" }}>
                          <button
                            className="btn-primary"
                            onClick={saveEditAutoLogin}
                            disabled={autoLoginSaving}
                          >
                            Spara
                          </button>
                          <button
                            className="btn-danger"
                            onClick={cancelEditAutoLogin}
                          >
                            Avbryt
                          </button>
                        </td>
                      </tr>
                    ) : (
                      <tr key={index}>
                        <td>{entry.ip}</td>
                        <td>{entry.username}</td>
                        <td>
                          {visiblePasswords[index] ? entry.password : "••••••••"}{" "}
                          <button
                            type="button"
                            className="btn-secondary"
                            style={{ padding: "1px 6px", fontSize: "0.8rem" }}
                            onClick={() => togglePasswordVisible(index)}
                          >
                            {visiblePasswords[index] ? "Dölj" : "Visa"}
                          </button>
                        </td>
                        <td style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
                          <button
                            className="btn-primary"
                            onClick={() => startEditAutoLogin(index)}
                          >
                            Redigera
                          </button>

                          {confirmDeleteAutoLoginIndex === index ? (
                            <>
                              <span style={{ fontSize: "0.85rem" }}>Säker?</span>
                              <button
                                className="btn-danger"
                                onClick={() => removeAutoLogin(index)}
                              >
                                Ja
                              </button>
                              <button
                                className="btn-primary"
                                onClick={() => setConfirmDeleteAutoLoginIndex(null)}
                              >
                                Nej
                              </button>
                            </>
                          ) : (
                            <button
                              className="btn-danger"
                              onClick={() => setConfirmDeleteAutoLoginIndex(index)}
                            >
                              Ta bort
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  )}

                  {/* -------- ADD ROW -------- */}
                  <tr>
                    <td>
                      <input
                        type="text"
                        placeholder="t.ex. 192.168.1.50"
                        value={newAutoLogin.ip}
                        onChange={(e) =>
                          setNewAutoLogin({ ...newAutoLogin, ip: e.target.value })
                        }
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        placeholder="Användarnamn"
                        value={newAutoLogin.username}
                        onChange={(e) =>
                          setNewAutoLogin({ ...newAutoLogin, username: e.target.value })
                        }
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        placeholder="Lösenord"
                        value={newAutoLogin.password}
                        onChange={(e) =>
                          setNewAutoLogin({ ...newAutoLogin, password: e.target.value })
                        }
                      />
                    </td>
                    <td>
                      <button
                        className="btn-primary"
                        onClick={addAutoLogin}
                        disabled={autoLoginSaving}
                      >
                        ➕ Lägg till
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* -------- EDIT MODAL -------- */}
      {modalOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>Redigera användare</h3>

            <input
              type="text"
              placeholder="Namn"
              autoFocus
              value={editUser.name}
              onChange={(e) => setEditUser({ ...editUser, name: e.target.value })}
            />
            <input
              type="text"
              placeholder="Användarnamn"
              value={editUser.username}
              onChange={(e) => setEditUser({ ...editUser, username: e.target.value })}
            />
            <input
              type="email"
              placeholder="E-post"
              value={editUser.email}
              onChange={(e) => setEditUser({ ...editUser, email: e.target.value })}
            />
            <input
              type="password"
              placeholder="Nytt lösenord (lämna tomt om oförändrat)"
              value={editUser.password}
              onChange={(e) => setEditUser({ ...editUser, password: e.target.value })}
            />
            <p style={{ fontSize: "0.85rem", color: "gray" }}>Ändra användarens roll i rollmenyn i användarlistan.</p>

            <div className="modal-buttons" style={{ marginTop: "10px" }}>
              <button className="btn-primary" onClick={saveEditUser}>
                Spara
              </button>
              <button className="btn-danger" onClick={() => setModalOpen(false)}>
                Avbryt
              </button>
            </div>
          </div>
        </div>
      )}

      {/* -------- ADD USER MODAL -------- */}
      {addModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>➕ Lägg till ny användare</h3>

            <input
              type="text"
              placeholder="Namn"
              autoFocus
              value={newUser.name}
              onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
            />
            <input
              type="text"
              placeholder="Användarnamn"
              value={newUser.username}
              onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
            />
            <input
              type="email"
              placeholder="E-post"
              value={newUser.email}
              onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
            />
            <input
              type="password"
              placeholder="Lösenord"
              value={newUser.password}
              onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
            />
            <select
              value={newUser.role}
              onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
            >
              <option value="view">Viewer</option>
              <option value="user">User</option>
              <option value="admin">Admin</option>
              <option
                value="suAdmin"
                disabled={currentUser.role !== "suAdmin"}
              >
                Super Admin
              </option>
            </select>

            <div className="modal-buttons" style={{ marginTop: "10px" }}>
              {/* FIX: await addUser() so modal only closes on success */}
              <button
                className="btn-primary"
                onClick={async () => {
                  const ok = await addUser();
                  if (ok) setAddModalOpen(false);
                }}
              >
                Skapa
              </button>
              <button
                className="btn-danger"
                onClick={() => setAddModalOpen(false)}
              >
                Avbryt
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}