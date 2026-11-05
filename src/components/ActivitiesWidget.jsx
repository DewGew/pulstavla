import { useEffect, useState, useCallback } from "react";
import { API_URL, WS_URL } from "../config";
import { io } from "socket.io-client";
import "./ActivitiesWidget.css";

export default function ActivitiesWidget() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // FIX: read token once — needed if /activities requires auth
  const [token] = useState(() => localStorage.getItem("token"));

  /* ---------------- LOAD TASKS ---------------- */
  // FIX: useCallback gives loadTasks a stable reference so it can be safely
  // listed in useEffect deps and passed to the socket listener without
  // capturing a stale closure.
  const loadTasks = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`${API_URL}/activities`, {
        // FIX: include auth header in case the endpoint requires it
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setTasks(await res.json());
    } catch {
      setError("Kunde inte hämta aktiviteter");
    } finally {
      setLoading(false);
    }
  }, [token]);

  /* ---------------- WEBSOCKET + INITIAL LOAD ---------------- */
  // FIX: both initial load and socket listener live in one effect.
  // loadTasks is stable (useCallback) so the listener is never stale.
  useEffect(() => {
    loadTasks();

    const socket = io(WS_URL, { transports: ["websocket"], 
  auth: (cb) => cb({ token: localStorage.getItem("token") }),
});
    socket.on("activitiesUpdated", loadTasks);
    return () => socket.disconnect();
  }, [loadTasks]);

  /* ---------------- CALCULATIONS ---------------- */
  const openTasks = tasks.filter((t) => !t.done).length;
  const completedTasks = tasks.filter((t) => t.done).length;
  const today = new Date().toISOString().slice(0, 10);
  const urgentTasks = tasks.filter(
    (t) => !t.done && t.deadline && t.deadline <= today
  ).length;

  /* ---------------- RENDER ---------------- */
  return (
    <div className="widget activities-widget">
      <h3>Aktiviteter</h3>

      {/* FIX: loading and error states instead of silent empty widget */}
      {loading ? (
        <p className="widget-loading">Laddar…</p>
      ) : error ? (
        <p className="widget-error">{error}</p>
      ) : (
        <div className="activities-stats">
          <div className="stat total">
            <span>{openTasks}</span>
            <p>Öppna</p>
          </div>

          <div className="stat green">
            <span>{completedTasks}</span>
            <p>Klara</p>
          </div>

          <div className="stat red">
            <span>{urgentTasks}</span>
            <p>Brådskande</p>
          </div>
        </div>
      )}
      {/* FIX: removed empty widget-meta div */}
    </div>
  );
}
