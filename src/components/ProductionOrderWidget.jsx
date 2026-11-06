import { useEffect, useState, useMemo } from "react";
import { io } from "socket.io-client";
import { API_URL, WS_URL } from "../config";
import "./ProductionOrderWidget.css";

const socket = io(WS_URL, { transports: ["websocket"], 
  auth: (cb) => cb({ token: localStorage.getItem("token") }),
});

export default function ProductionOrderImport() {
  const [orders, setOrders] = useState([]);
  const [showAll, setShowAll] = useState(false);

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

  const fetchOrders = () => {
    fetch(`${API_URL}/production-orders`, {
      headers: localStorage.getItem("token")
        ? { Authorization: `Bearer ${localStorage.getItem("token")}` }
        : {},
    })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(data => setOrders(Array.isArray(data) ? data : []))
      .catch(console.error);
  };

  useEffect(() => {
    fetchOrders();
    if (!socket.connected) socket.connect();
    socket.on("productionOrdersUpdated", fetchOrders);
    return () => socket.disconnect();
  }, []);

  const stats = useMemo(() => {
    const { monday, sunday } = getWeekRange();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let total = 0;
    let late = 0;
    let soon = 0;
    let future = 0;
		let outsourced = 0;

    let totalPlanTime = 0;
    const planPerResource = {};

		orders.forEach(order => {
			if (!order.Leveransdatum) return;

			const date = new Date(order.Leveransdatum);
			if (isNaN(date)) return;

			date.setHours(0, 0, 0, 0);

			const diffDays = (date - today) / (1000 * 60 * 60 * 24);

			const rawResTid = order.ResTid ?? "";
			const isOutsourced = String(rawResTid) === "0";
			const resTid = Number(order.ResTid) || 0;
			const fras3axl = Number(order.Fras3axl) || 0;
			const fras5axl = Number(order.Fras5axl) || 0;
			const frasStor = Number(order.FrasStor) || 0;
			const svarv = Number(order.Svarv) || 0;
			const man = Number(order.Man) || 0;
			const div = Number(order.Div) || 0;
	
			const addPlanTime = () => {
				totalPlanTime += resTid;

				if (fras3axl > 0) {
					planPerResource["Fräs 3axl"] =
						(planPerResource["Fräs 3axl"] || 0) + fras3axl;
				}
				
				if (fras5axl > 0) {
					planPerResource["Fräs 5axl"] =
						(planPerResource["Fräs 5axl"] || 0) + fras5axl;
				}
				
				if (frasStor > 0) {
					planPerResource["Fräs Stora"] =
						(planPerResource["Fräs Stora"] || 0) + frasStor;
				}
				
				if (svarv > 0) {
					planPerResource["Svarv"] =
						(planPerResource["Svarv"] || 0) + svarv;
				}
				
				if (man > 0) {
					planPerResource["Manuellt"] =
						(planPerResource["Manuellt"] || 0) + man;
				}
				
				if (div> 0) {
					planPerResource["Övrigt"] =
						(planPerResource["Övrigt"] || 0) + div;
				}
				
			};

			// 🔴 Sena
			if (diffDays < 0) {
				total++;
				
				if (isOutsourced) {
						outsourced++;
				} else {
					late++;   // endast interna räknas som sena
				}
				addPlanTime();
				return;
			}

			const isThisWeek = date >= monday && date <= sunday;

			if (showAll || isThisWeek) {
				total++;

				if (isOutsourced) {
					outsourced++;
				} else {
					if (diffDays <= 3) soon++;
					else future++;
				}

				addPlanTime();
			}
		});

    return {
      total,
      late,
      soon,
      future,
			outsourced,
      totalPlanTime,
      planPerResource
    };
  }, [orders, showAll]);
	
	

  return (
    <div className="widget production-widget">
      <h3>{showAll ? "Produktionsplan totalt" : "Produktionsplan denna veckan"}</h3>		

      <div className="plan-summary">
        <h4>Planerad tid</h4>
				
				<div className="plan-resources">
					{Object.entries(stats.planPerResource)
						.sort(([a], [b]) => a.localeCompare(b, "sv"))
						.map(([moment, time]) => (
							<div key={moment} className="plan-resource-row">
								<span>{moment}</span>
								<span>{time.toFixed(1)} h</span>
							</div>
						))}
				</div>
				<div className="plan-total">
          <strong>Totalt</strong>
					<strong>{stats.totalPlanTime.toFixed(1)} h</strong>
        </div>
      </div>
	  
	  <button
        className="btn-primary"
        onClick={() => setShowAll(prev => !prev)}
      >
        {showAll ? "Visa endast denna vecka" : "Visa alla ordrar"}
      </button>

      <div className="widget-meta">
        Uppdaterad{" "}
        {orders.length > 0
          ? new Date(
              Math.max(...orders.map(o =>
                new Date(o.importedAt).getTime()
              ))
            ).toLocaleString("sv-SE", {
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit"
            })
          : "-"}
      </div>
    </div>
  );
}