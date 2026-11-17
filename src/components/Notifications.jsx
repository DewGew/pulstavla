import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../api";
import "./Notifications.css";

const priorityLabels = { info: "Information", important: "Viktig", urgent: "Brådskande" };
const formatDate = (value) => value ? new Date(value).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" }) : "";

export default function Notifications({ currentUser }) {
  const isAdmin = ["admin", "suAdmin"].includes(currentUser?.role);
  const [messages, setMessages] = useState([]);
  const [users, setUsers] = useState([]);
  const [showComposer, setShowComposer] = useState(false);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [priority, setPriority] = useState("info");
  const [recipientIds, setRecipientIds] = useState([]);
  const [sendToAll, setSendToAll] = useState(false);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const token = localStorage.getItem("token");

  const loadMessages = useCallback(async () => {
    try {
      const response = await apiFetch("/notifications", { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error("Kunde inte läsa inkorgen.");
      setMessages(await response.json());
    } catch (error) { setStatus(error.message); }
  }, [token]);

  useEffect(() => { loadMessages(); }, [loadMessages]);
  useEffect(() => {
    if (!isAdmin) return;
    apiFetch("/notifications/users", { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => response.ok ? response.json() : [])
      .then((data) => setUsers(Array.isArray(data) ? data : []))
      .catch(() => setUsers([]));
  }, [isAdmin, token]);

  const markRead = async (id) => {
    try {
      const response = await apiFetch(`/notifications/${id}/read`, { method: "PATCH", headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error("Kunde inte markera meddelandet som läst.");
      setMessages((items) => items.map((item) => item._id === id ? { ...item, readAt: Date.now() } : item));
      window.dispatchEvent(new Event("notificationsUpdated"));
    } catch (error) { setStatus(error.message); }
  };

  const markAllRead = async () => {
    try {
      const response = await apiFetch("/notifications/read-all", { method: "PATCH", headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error("Kunde inte markera meddelandena som lästa.");
      setMessages((items) => items.map((item) => ({ ...item, readAt: item.readAt || Date.now() })));
      window.dispatchEvent(new Event("notificationsUpdated"));
    } catch (error) { setStatus(error.message); }
  };

  const sendMessage = async (event) => {
    event.preventDefault(); setBusy(true); setStatus("");
    try {
      const response = await apiFetch("/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ title, message, priority, recipientIds, sendToAll }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Kunde inte skicka meddelandet.");
      setStatus(`Meddelandet skickades till ${result.count} användare.`);
      setTitle(""); setMessage(""); setRecipientIds([]); setSendToAll(false); setPriority("info"); setShowComposer(false);
    } catch (error) { setStatus(error.message); }
    finally { setBusy(false); }
  };

  return <section className="notifications-page">
    <div className="notifications-header">
      <div><h2>Meddelanden</h2><p>Din inkorg för interna meddelanden och aviseringar.</p></div>
      <div className="notifications-actions">
        {messages.some((item) => !item.readAt) && <button type="button" className="notifications-secondary" onClick={markAllRead}>Markera alla som lästa</button>}
        {isAdmin && <button type="button" onClick={() => setShowComposer((value) => !value)}>{showComposer ? "Stäng" : "Nytt meddelande"}</button>}
      </div>
    </div>
    {status && <div className="notifications-feedback" role="status">{status}</div>}
    {showComposer && isAdmin && <form className="notifications-composer" onSubmit={sendMessage}>
      <h3>Skicka meddelande</h3>
      <label>Rubrik<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} required /></label>
      <label>Meddelande<textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength={4000} rows={4} required /></label>
      <label>Prioritet<select value={priority} onChange={(event) => setPriority(event.target.value)}><option value="info">Information</option><option value="important">Viktig</option><option value="urgent">Brådskande</option></select></label>
      <label className="notifications-check"><input type="checkbox" checked={sendToAll} onChange={(event) => { setSendToAll(event.target.checked); setRecipientIds([]); }} /> Skicka till alla användare</label>
      {!sendToAll && <fieldset className="notifications-recipients"><legend>Mottagare</legend>
        {users.map((user) => <label key={user._id} className="notifications-check"><input type="checkbox" checked={recipientIds.includes(user._id)} onChange={(event) => setRecipientIds((items) => event.target.checked ? [...items, user._id] : items.filter((id) => id !== user._id))} /> {user.name || user.username}</label>)}
      </fieldset>}
      <button type="submit" disabled={busy}>{busy ? "Skickar…" : "Skicka meddelande"}</button>
    </form>}
    <div className="notifications-list">
      {messages.length === 0 ? <div className="notifications-empty">Du har inga meddelanden.</div> : messages.map((item) => <article key={item._id} className={`notification-item ${item.readAt ? "is-read" : "is-unread"} priority-${item.priority}`}>
        <div className="notification-item-top"><span className="notification-priority">{priorityLabels[item.priority] || "Information"}</span><time>{formatDate(item.createdAt)}</time></div>
        <h3>{item.title}</h3><p>{item.message}</p>
        <div className="notification-item-footer"><span>Från: {item.senderName || "Pulstavlan"}</span>{!item.readAt && <button type="button" className="notifications-secondary" onClick={() => markRead(item._id)}>Markera som läst</button>}</div>
      </article>)}
    </div>
  </section>;
}
