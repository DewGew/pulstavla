import { useEffect, useState, useCallback, useRef } from "react";
import { API_URL } from "../config";
import { socket } from "../socket";
import "./ClockWidget.css";

// Enkel mappning från Open-Meteo weathercode till ikon + text
const WEATHER_CODES = {
  0: { icon: "☀️", label: "Klart" },
  1: { icon: "🌤️", label: "Mest klart" },
  2: { icon: "⛅", label: "Molnigt" },
  3: { icon: "☁️", label: "Mulet" },
  45: { icon: "🌫️", label: "Dimma" },
  48: { icon: "🌫️", label: "Rimfrost" },
  51: { icon: "🌦️", label: "Lätt duggregn" },
  53: { icon: "🌦️", label: "Duggregn" },
  55: { icon: "🌧️", label: "Tätt duggregn" },
  61: { icon: "🌦️", label: "Lätt regn" },
  63: { icon: "🌧️", label: "Regn" },
  65: { icon: "🌧️", label: "Kraftigt regn" },
  71: { icon: "🌨️", label: "Lätt snö" },
  73: { icon: "🌨️", label: "Snö" },
  75: { icon: "❄️", label: "Kraftig snö" },
  77: { icon: "❄️", label: "Snöby" },
  80: { icon: "🌦️", label: "Regnskurar" },
  81: { icon: "🌧️", label: "Skurar" },
  82: { icon: "⛈️", label: "Kraftiga skurar" },
  85: { icon: "🌨️", label: "Snöbyar" },
  86: { icon: "❄️", label: "Kraftiga snöbyar" },
  95: { icon: "⛈️", label: "Åska" },
  96: { icon: "⛈️", label: "Åska med hagel" },
  99: { icon: "⛈️", label: "Kraftig åska" },
};

function describeWeather(code) {
  return WEATHER_CODES[code] || { icon: "🌡️", label: "Okänt" };
}

// Egen widget-id i den redan befintliga /widgets-databasen — ingen
// serverändring behövs, det är samma endpoint som EditableTextWidget använder.
const VISITOR_WIDGET_ID = "besok_idag";

export default function ClockWidget({
  lat = 56.1612, 
  lon = 15.5869,
  canEdit = false,
  onEditingChange,
}) {
  const [now, setNow] = useState(new Date());
  const [weather, setWeather] = useState(null);
  const [weatherError, setWeatherError] = useState(null);

  /* ---------------- KLOCKA ---------------- */
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  /* ---------------- VÄDER ---------------- */
  useEffect(() => {
    let cancelled = false;

    async function loadWeather() {
      try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weathercode&daily=temperature_2m_max,temperature_2m_min&timezone=auto`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setWeather({
            temp: Math.round(data.current.temperature_2m),
            code: data.current.weathercode,
            max: Math.round(data.daily.temperature_2m_max[0]),
            min: Math.round(data.daily.temperature_2m_min[0]),
          });
          setWeatherError(null);
        }
      } catch {
        if (!cancelled) setWeatherError("Väder ej tillgängligt");
      }
    }

    loadWeather();
    // FIX: uppdatera var 30:e minut — väderdata behöver inte pollas per sekund
    const interval = setInterval(loadWeather, 30 * 60 * 1000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [lat, lon]);

  /* ---------------- BESÖK IDAG ---------------- */
  const [visitorText, setVisitorText] = useState("");
  const [visitorDraft, setVisitorDraft] = useState("");
  const [isEditingVisitor, setIsEditingVisitor] = useState(false);
  const [isSavingVisitor, setIsSavingVisitor] = useState(false);
  const [visitorError, setVisitorError] = useState(null);

  const initialVisitorRef = useRef(""); // ingen förvald text — tomt = inget besök

  const fetchVisitor = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/widgets/${VISITOR_WIDGET_ID}`);

      if (res.ok) {
        const data = await res.json();
        setVisitorText(data.text || initialVisitorRef.current);
        return;
      }

      // Widgeten finns inte än — skapa den tom
      if (res.status === 404) {
        const createRes = await fetch(`${API_URL}/widgets`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            textwidgetid: VISITOR_WIDGET_ID,
            title: "Besök",
            text: initialVisitorRef.current,
          }),
        });
        if (!createRes.ok) throw new Error();
        const doc = await createRes.json();
        setVisitorText(doc.text || initialVisitorRef.current);
        return;
      }

      throw new Error(`HTTP ${res.status}`);
    } catch {
      // Tyst: klockan/vädret fungerar oavsett, besökstexten visas bara tom
      console.warn("Kunde inte hämta besöksinfo");
    }
  }, []);

  useEffect(() => {
    fetchVisitor();
  }, [fetchVisitor]);

  // Live-sync mellan skärmar — samma mönster som EditableTextWidget
  useEffect(() => {
    
    const handler = (payload) => {
      if (payload.textwidgetid === VISITOR_WIDGET_ID) {
        setVisitorText(payload.text || "");
      }
    };

    socket.on("widgetUpdated", handler);
    return () => {
      socket.off("widgetUpdated", handler);
    };
  }, []);

  const startEditVisitor = () => {
    setVisitorDraft(visitorText);
    setVisitorError(null);
    setIsEditingVisitor(true);
    onEditingChange?.(true);
  };

  const cancelEditVisitor = () => {
    setIsEditingVisitor(false);
    setVisitorError(null);
    onEditingChange?.(false);
  };

  const saveVisitor = async () => {
    const token = localStorage.getItem("token");

    setIsSavingVisitor(true);
    setVisitorError(null);

    try {
      const res = await fetch(`${API_URL}/widgets/${VISITOR_WIDGET_ID}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ title: "Besök", text: visitorDraft.trim() }),
      });

      if (!res.ok) throw new Error();

      setVisitorText(visitorDraft.trim());
      setIsEditingVisitor(false);
      onEditingChange?.(false);
    } catch {
      setVisitorError("Kunde inte spara besöksinfo");
    } finally {
      setIsSavingVisitor(false);
    }
  };

  const seconds = now.getSeconds();
  const minutes = now.getMinutes();
  const hours = now.getHours() % 12;

  const secondDeg = seconds * 6;
  const minuteDeg = minutes * 6 + seconds * 0.1;
  const hourDeg = hours * 30 + minutes * 0.5;

  const dateLabel = now.toLocaleDateString("sv-SE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const handStyle = (deg) => ({
    transform: `rotate(${deg}deg)`,
    transformOrigin: "100px 100px",
  });

  const weatherInfo = weather ? describeWeather(weather.code) : null;

  return (
    <div className="widget analog-clock-widget">
      <svg viewBox="0 0 200 200" className="analog-clock-face">
        <circle cx="100" cy="100" r="96" className="clock-rim" />

        {Array.from({ length: 12 }).map((_, i) => {
          const angle = (i * 30 * Math.PI) / 180;
          const x1 = 100 + 82 * Math.sin(angle);
          const y1 = 100 - 82 * Math.cos(angle);
          const x2 = 100 + 92 * Math.sin(angle);
          const y2 = 100 - 92 * Math.cos(angle);
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              className={i % 3 === 0 ? "tick tick-major" : "tick"}
            />
          );
        })}

        {Array.from({ length: 60 }).map((_, i) => {
          if (i % 5 === 0) return null;
          const angle = (i * 6 * Math.PI) / 180;
          const x1 = 100 + 88 * Math.sin(angle);
          const y1 = 100 - 88 * Math.cos(angle);
          const x2 = 100 + 92 * Math.sin(angle);
          const y2 = 100 - 92 * Math.cos(angle);
          return (
            <line key={`m${i}`} x1={x1} y1={y1} x2={x2} y2={y2} className="tick tick-minor" />
          );
        })}

        <line x1="100" y1="100" x2="100" y2="55" className="hand hour-hand" style={handStyle(hourDeg)} />
        <line x1="100" y1="100" x2="100" y2="30" className="hand minute-hand" style={handStyle(minuteDeg)} />
        <line x1="100" y1="112" x2="100" y2="22" className="hand second-hand" style={handStyle(secondDeg)} />

        <circle cx="100" cy="100" r="4" className="clock-center" />
      </svg>

      <div className="analog-clock-date">{dateLabel}</div>

      {/* ---------------- VÄDER ---------------- */}
      <div className="clock-weather">
        {weatherError ? (
          <span className="weather-error">{weatherError}</span>
        ) : weather ? (
          <>
            <span className="weather-icon">{weatherInfo.icon}</span>
            <span className="weather-temp">{weather.temp}°C</span>
            <span className="weather-range">{weatherInfo.label}</span>
          </>
        ) : (
          <span className="weather-loading">Laddar väder…</span>
        )}
      </div>

	  {/* ---------------- BESÖK IDAG ---------------- */}
	  <div className="clock-visitor">
	  	
		  {isEditingVisitor ? (
		    <div style={{ width: "100%" }}>
		      <textarea
		        value={visitorDraft}
		        onChange={(e) => setVisitorDraft(e.target.value)}
		        placeholder="t.ex. Från bolaget kommer han på besök kl. 10"
		        rows={2}
		        autoFocus
		        style={{
		          width: "100%",
		          boxSizing: "border-box",
		          fontFamily: "inherit",
		          fontSize: "inherit",
		          resize: "vertical",
		          padding: "6px",
		        }}
		      />

		      {visitorError && (
		        <p style={{ color: "#dc2626", fontSize: "0.85rem", margin: "4px 0 0" }}>
		          {visitorError}
		        </p>
		      )}

		      <div style={{ display: "flex", justifyContent: "center", gap: "8px", marginTop: "8px" }}>
		        <button
		          className="btn-danger"
		          onClick={cancelEditVisitor}
		          disabled={isSavingVisitor}
		        >
		          Avbryt
		        </button>
		        <button
		          className="btn-primary"
		          onClick={saveVisitor}
		          disabled={isSavingVisitor}
		        >
		          {isSavingVisitor ? "Sparar…" : "Spara"}
		        </button>
		      </div>
		    </div>
		  ) : (
		    <>
		      {visitorText?.trim() ? (
		        <p style={{ color: "var(--header-text)", margin: 0 }}>{visitorText}</p>
		      ) : (
		        <p style={{ margin: 0, opacity: 0.6, fontStyle: "italic" }}>
		          Inget besök idag
		        </p>
		      )}

		      {canEdit && (
		        <button
		          className="edit-btn"
		          onClick={startEditVisitor}
		          style={{ marginTop: "6px" }}
		        >
		          Redigera
		        </button>
		      )}
		    </>
		  )}
	  </div>
    </div>
  );
}