import { useEffect, useState, useMemo } from "react";
import { io } from "socket.io-client";
import { API_URL, WS_URL } from "../config";
import "./OrderWidget.css";

const socket = io(WS_URL, { transports: ["websocket"], 
  auth: (cb) => cb({ token: localStorage.getItem("token") }),
});

export default function OrderWidget() {
  const [orders, setOrders] = useState([]);

  const getWeekRange = () => {
    const now = new Date();
    const day = now.getDay();
    const diffToMonday = (day === 0 ? -6 : 1) - day;

    const monday = new Date(now);
    monday.setDate(now.getDate() + diffToMonday);
    monday.setHours(0, 0, 0, 0);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);

    return { monday, sunday };
  };

  useEffect(() => {
    fetch(`${API_URL}/orders`, {
      headers: localStorage.getItem("token")
        ? { Authorization: `Bearer ${localStorage.getItem("token")}` }
        : {},
    })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(setOrders)
      .catch(console.error);

    if (!socket.connected) socket.connect();
    socket.on("ordersUpdated", (data) => {
      setOrders(data);
    });

    return () => socket.disconnect();
  }, []);

  const stats = useMemo(() => {
		const { monday, sunday } = getWeekRange();
		const today = new Date();
		today.setHours(0, 0, 0, 0);

		let weekOrders = 0;
		let late = 0;
		let soon = 0;
		let future = 0;

		orders.forEach(order => {
				if (!order.Leveransdatum) return;

				const date = new Date(order.Leveransdatum);
				date.setHours(0,0,0,0);

				const diffDays = (date - today) / (1000 * 60 * 60 * 24);

				// 🔴 Alla sena (oavsett vecka)
				if (diffDays < 0) {
						late++;
						weekOrders++;   // <-- Lägg till denna
						return;         // Viktigt så den inte räknas igen
				}

				// 📅 Denna vecka
				if (date >= monday && date <= sunday) {
						weekOrders++;

						if (diffDays <= 3) soon++;
						else future++;
				}
		});

		return { weekOrders, late, soon, future };
	}, [orders]);

  return (
    <div className="widget order-widget">
      <h3>Veckans Leveranser</h3>

      <div className="widget-stats">
        <div className="stat total">
          <span>{stats.weekOrders}</span>
          <p>Totalt</p>
        </div>

        <div className="stat red">
          <span>{stats.late}</span>
          <p>Sena</p>
        </div>

        <div className="stat yellow">
          <span>{stats.soon}</span>
          <p>≤ 3 dagar</p>
        </div>

        <div className="stat green">
          <span>{stats.future}</span>
          <p>Senare</p>
        </div>
      </div>
			<div className="widget-meta">
				Uppdaterad{" "}
				{orders.length > 0
					? new Date(
							Math.max(...orders.map((o) => new Date(o.importedAt).getTime()))
						).toLocaleString("sv-SE",{ 
							year: "numeric", 
							month: "2-digit", 
							day: "2-digit", 
							hour: "2-digit", 
							minute: "2-digit" 
						})
					: "2026-02-25 00:00"}
			</div>
    </div>
  );
}