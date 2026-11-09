import { lazy, Suspense, useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useSettings } from "./components/SettingsContext";
import ClockWidget from "./components/ClockWidget";
import GreenCross from "./components/GreenCross";
import Login from "./components/Login";



import ActivitiesWidget from "./components/ActivitiesWidget";
import PresenceWidget from "./components/PresenceWidget";
import EditableTextWidget from "./components/EditableTextWidget";
import StructuredTextWidget from "./components/StructuredTextWidget";

import ResourceWidget from "./components/ResourceWidget";

import WidgetRotator from "./components/WidgetRotator";


import LunchWidget from "./components/LunchWidget";
import OrderWidget from "./components/OrderWidget";

import ProductionOrderWidget from "./components/ProductionOrderWidget";
import QualityCostWidget from "./components/QualityCostWidget";

import DrawingWidget from "./components/DrawingWidget";
import { API_URL } from "./config";
import { socket, connectSocket, disconnectSocket } from "./socket";
import { createApi } from "./api";
import "./App.css";

/*
 * Sekundära vyer laddas först när användaren öppnar dem.
 * Detta håller den första dashboard-laddningen mindre, särskilt på TV-enheter.
 */
const Profile = lazy(() => import("./components/Profile"));
const AdminUsers = lazy(() => import("./components/AdminUsers"));
const Activities = lazy(() => import("./components/Activities"));
const MachineChecklist = lazy(() => import("./components/MachineChecklist"));
const MachineDocuments = lazy(() => import("./components/MachineDocuments"));
const Settings = lazy(() => import("./components/Settings"));
const OrderImport = lazy(() => import("./components/OrderImport"));
const ProductionOrderImport = lazy(() => import("./components/ProductionOrderImport"));
const Matprotokoll = lazy(() => import("./components/Matprotokoll"));


const today = new Date().toLocaleDateString("sv-SE", {
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
});

const todayDate = today.charAt(0).toUpperCase() + today.slice(1);

export default function App() {
  const { settings, loading } = useSettings();
  const [openMenu, setOpenMenu] = useState(false);
  const [imageExists, setImageExists] = useState(true);
  
  /* ------------------- FULLSCREEN ------------------- */
	const [isFullscreen, setIsFullscreen] = useState(
	  !!document.fullscreenElement
	);

	const toggleFullscreen = useCallback(() => {
	  if (!document.fullscreenElement) {
		document.documentElement
		  .requestFullscreen()
		  .catch((err) =>
			console.warn("Kunde inte gå till helskärm:", err.message)
		  );
	  } else {
		document.exitFullscreen();
	  }
	}, []);

	// Håll state i synk om användaren avslutar helskärm med Esc,
	// eller om helskärm triggas/avslutas från annat håll (t.ex. F11)
	useEffect(() => {
	  const handleChange = () => setIsFullscreen(!!document.fullscreenElement);
	  document.addEventListener("fullscreenchange", handleChange);
	  return () => document.removeEventListener("fullscreenchange", handleChange);
	}, []);
  
  const [navPosition, setNavPosition] = useState(
	  localStorage.getItem("navPosition") || "top" // "top" eller "side"
	);

	useEffect(() => {
	  localStorage.setItem("navPosition", navPosition);
	}, [navPosition]);

	function toggleNavPosition() {
	  setNavPosition(prev => (prev === "top" ? "side" : "top"));
	}

  /* ------------------- THEME ------------------- */
  const [theme, setTheme] = useState(
    localStorage.getItem("theme") || "light"
  );

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((t) => (t === "light" ? "dark" : "light"));
  };

  /* ------------------- LOGIN ------------------- */
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem("user");
    if (!saved) return null;
    try {
      return JSON.parse(saved);
    } catch {
      localStorage.removeItem("user");
      localStorage.removeItem("token");
      return null;
    }
  });

  const handleLogin = (loggedInUser) => {
    setUser(loggedInUser);
    localStorage.setItem("user", JSON.stringify(loggedInUser));
    window.dispatchEvent(new Event("authChanged"));
    connectSocket();
  };

  // Rensa alltid den lokala sessionen direkt. Utloggning ska fungera
  // även om servern är nere eller token redan har gått ut.
  const clearSession = useCallback(() => {
    setActiveTab("overview");
    setUser(null);
    setOpenMenu(false);
    localStorage.removeItem("user");
    localStorage.removeItem("token");
    disconnectSocket();
    window.dispatchEvent(new Event("authChanged"));
  }, []);

  const logout = useCallback(() => {
    const token = localStorage.getItem("token");
    clearSession();

    // Serverns logout är ett extra försök; gränssnittet väntar inte på nätverket.
    if (token) {
      fetch(`${API_URL}/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }).catch((err) => console.warn("Logout API misslyckades:", err.message));
    }
  }, [clearSession]);

  /* ------------------- API ------------------- */
  const apiFetch = useMemo(() => createApi(clearSession), [clearSession]);

  useEffect(() => {
    window.addEventListener("authExpired", clearSession);
    return () => window.removeEventListener("authExpired", clearSession);
  }, [clearSession]);

  /* ------------------- TABS ------------------- */
  const [activeTab, setActiveTab] = useState("overview");

  /* ------------------- WEBSOCKET ------------------- */
  const [, setWsUpdate] = useState(0);

  useEffect(() => {
    const handleWsEvent = () => setWsUpdate((v) => v + 1);
    socket.on("greenCrossUpdate", handleWsEvent);
    return () => socket.off("greenCrossUpdate", handleWsEvent);
  }, []);

  /* ------------------- REGISTER USER ON SOCKET ------------------- */
  useEffect(() => {
    if (!user?.username) return;

    const register = () => socket.emit("registerUser");
    register();
    socket.on("connect", register);
    return () => socket.off("connect", register);
  }, [user]);

  /* ------------------- TOKEN EXPIRY CHECK ------------------- */
  // Kontrollera token efter inloggning och logga ut automatiskt när den löper ut.
  useEffect(() => {
    if (!user) return;

    const token = localStorage.getItem("token");
    if (!token) {
      clearSession();
      return;
    }

    let expiryTimer;

    try {
      const base64 = token.split(".")[1];
      if (!base64) throw new Error("Token saknar payload");

      // JWT använder base64url, som behöver normaliseras före atob.
      const normalized = base64.replace(/-/g, "+").replace(/_/g, "/");
      const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
      const payload = JSON.parse(
        decodeURIComponent(
          atob(padded)
            .split("")
            .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
            .join("")
        )
      );

      if (payload.exp) {
        const expiresInMs = payload.exp * 1000 - Date.now();
        if (expiresInMs <= 0) {
          console.warn("Token expired");
          clearSession();
        } else {
          expiryTimer = window.setTimeout(() => {
            console.warn("Token expired");
            clearSession();
          }, expiresInMs);
        }
      }
    } catch (err) {
      console.error("Invalid token:", err);
      clearSession();
    }

    return () => {
      if (expiryTimer) window.clearTimeout(expiryTimer);
    };
  }, [clearSession, user]);

  /* ------------------- WIDGET STATE ------------------- */
  const [widget, setWidget] = useState(null);
  const [pauseRotation, setPauseRotation] = useState(false);

  // FIX: removed the duplicate useEffect that also fetched /widgets.
  useEffect(() => {
    if (!user) return;

    apiFetch("/widgets")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => { if (data.length > 0) setWidget(data[0]); })
      .catch((err) => console.warn("Fetch avbruten:", err.message));
  }, [apiFetch, user]);

	/* ------------------- ORIENTATION / PAGINATION ------------------- */
	const [isPortrait, setIsPortrait] = useState(
	  window.matchMedia("(orientation: portrait)").matches
	);
	const [isUltraWide, setIsUltraWide] = useState(
	  window.matchMedia("(min-width: 2560px)").matches
	);
	const [is4K, setIs4K] = useState(
	  window.matchMedia("(min-width: 3840px)").matches
	);

	useEffect(() => {
	  const orientationMedia = window.matchMedia("(orientation: portrait)");
	  const ultraWideMedia = window.matchMedia("(min-width: 2560px)");
	  const fourKMedia = window.matchMedia("(min-width: 3840px)");

	  const handleOrientation = (e) => setIsPortrait(e.matches);
	  const handleUltraWide = (e) => setIsUltraWide(e.matches);
	  const handle4K = (e) => setIs4K(e.matches);

	  orientationMedia.addEventListener("change", handleOrientation);
	  ultraWideMedia.addEventListener("change", handleUltraWide);
	  fourKMedia.addEventListener("change", handle4K);

	  return () => {
		orientationMedia.removeEventListener("change", handleOrientation);
		ultraWideMedia.removeEventListener("change", handleUltraWide);
		fourKMedia.removeEventListener("change", handle4K);
	  };
	}, []);

	// FIX: i porträttläge är knappen för att växla menyläge dold (se
	// {!isPortrait && ...} i navigeringen), så utan detta kunde en
	// användare fastna i sidomenyn om skärmen roterades till stående
	// medan "side" redan var valt. Tvingar alltid tillbaka till toppmeny.
	useEffect(() => {
	  if (isPortrait && navPosition !== "top") {
		setNavPosition("top");
	  }
	}, [isPortrait, navPosition]);
	const ITEMS_PER_PAGE = is4K
	  ? 12
	  : isUltraWide
	  ? 10
	  : isPortrait
	  ? 12
	  : 8;

  const [page, setPage] = useState(0);

  /* ------------------- SWIPE TO CHANGE PAGE (touchskärm) ------------------- */
  // Horisontell swipe byter sida — samma funktion som prick-navigeringen,
  // men naturligare på en touchpanel. Vertikala swipes (scroll) ignoreras.
  const touchStartRef = useRef(null);

  const handleTouchStart = useCallback((e) => {
	// FIX: widgets som själva hanterar touch (t.ex. DrawingWidget) markerar
    // sig med data-no-swipe="true" — då ska sidbytet inte trigga alls,
    // annars tolkas ritstreck/reglage-drag som ett swipe-sidbyte.
    if (e.target.closest("[data-no-swipe]")) {
      touchStartRef.current = null;
      return;
    }

    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY };
  }, []);

  const handleTouchEnd = useCallback(
    (e) => {
      const start = touchStartRef.current;
      touchStartRef.current = null;
      if (!start) return;

      const t = e.changedTouches[0];
      const deltaX = t.clientX - start.x;
      const deltaY = t.clientY - start.y;

      const SWIPE_THRESHOLD = 50; // px — under det räknas det som en tap, inte en swipe

      // Ignorera mest-vertikala rörelser så vanlig scroll inte tolkas som sidbyte
      if (Math.abs(deltaX) < SWIPE_THRESHOLD || Math.abs(deltaX) < Math.abs(deltaY)) {
        return;
      }

      if (deltaX < 0) {
        // Swipe vänster -> nästa sida
        setPage((p) => Math.min(p + 1, totalPagesRef.current - 1));
      } else {
        // Swipe höger -> föregående sida
        setPage((p) => Math.max(p - 1, 0));
      }
    },
    []
  );

  /* ------------------- WIDGETS ARRAY ------------------- */
  // FIX: memoized so widgets aren't rebuilt on every render.
  // Re-builds only when user, settings, pauseRotation, or is4K changes.
  const widgets = useMemo(() => {
    const canEdit = user?.role === "admin" || user?.role === "suAdmin";
	
    const infoWidget = (
      <StructuredTextWidget
        textwidgetid="info_sections"
        initialTitle="Information"
        initialSections={[
          { subtitle: "Undertitel 1", text: "Text 1" },
          { subtitle: "Undertitel 2", text: "Text 2" },
        ]}
        canEdit={canEdit}
      />
    );

    const rotatorWidget = (
      <WidgetRotator
        paused={pauseRotation}
        interval={settings?.system?.interval || 15000}
      >
        <EditableTextWidget
          textwidgetid="fanvaro"
          canEdit={canEdit}
          onEditingChange={setPauseRotation}
        />
        <StructuredTextWidget
          textwidgetid="arbetstider"
          initialTitle="Arbetstider"
          initialSections={[
            { subtitle: "Undertitel 1", text: "Text 1" },
            { subtitle: "Undertitel 2", text: "Text 2" },
          ]}
          canEdit={canEdit}
          onEditingChange={setPauseRotation}
        />
      </WidgetRotator>
    );

    const safetyWidget = (
      <div className="widget green-cross-widget">
        <h3>Miljö/Säkerhet</h3>
        <GreenCross
          crossId="safety"
          user={user}
          green="Ok"
          yellow="Varning"
          red="Problem"
          url={{
            title: "Risker",
            text: `
🏗️ Tunga eller ovanliga lyft
🔧 Underhåll eller maskin ingrepp
👷 Ny eller inhyrd personal
🚧 Avstängda skydd / provisoriska lösningar
⏱ Stress, övertid, låg bemanning
            `,
          }}
        />
      </div>
    );

    const qualityWidget = (
      <div className="widget green-cross-widget">
        <h3>Kvalité</h3>
        <GreenCross
          crossId="quality"
          user={user}
          green="OK"
          yellow="Int. Avvikelse"
          red="Ext. Avvikelse"
        />
      </div>
    );

    const presenceWidget = <PresenceWidget currentUser={user} />;
    const resourceWidget = <ResourceWidget currentUser={user} />;
    const productionOrderWidget = <ProductionOrderWidget />;
    const orderWidget = <OrderWidget />;
    const lunchWidget = (
		<LunchWidget footerOrder="Hanna Svensson" price="112"  />
	);
	const clock = (
		<ClockWidget
			lat={settings?.system?.lat || 56.1612}
			lon={settings?.system?.lon || 15.5869}
			canEdit={canEdit} 
			onEditingChange={setPauseRotation}
		/>
	);

    const qualityCostWidget = (
      <QualityCostWidget 
		canEdit={canEdit} 
		onEditingChange={setPauseRotation} 
		PREV_YEAR_TOTAL={settings?.system?.qual || 0} 
		PREV_YEAR_TOTAL_2={settings?.system?.qual2 || 0}
		YEAR_LABEL={settings?.system?.yearLabel || "2024/2026"}
	  />
    );
	
	const drawingwidget = (
		<DrawingWidget canEdit={canEdit} />
	);

    const activitiesWidget = <ActivitiesWidget />;



    // 4K screens show more tiles per page — lead with the always-on status
    if (is4K) {
      return [
	    clock,
        infoWidget,
        safetyWidget,
        qualityWidget,
        presenceWidget,
        resourceWidget,
		lunchWidget,
		qualityCostWidget,
        productionOrderWidget,
        orderWidget,
        activitiesWidget,
		rotatorWidget,
/* 		drawingwidget, */
      ];
    }

	if (!canEdit) {
	  return [
		  infoWidget,
		  safetyWidget,
		  qualityWidget,
		  presenceWidget,
		  resourceWidget,
		  productionOrderWidget,
		  orderWidget,
		  rotatorWidget,
		  lunchWidget,
		  qualityCostWidget,
		  activitiesWidget,
		];
	}
	
    return [
      infoWidget,
      safetyWidget,
      qualityWidget,
      presenceWidget,
      resourceWidget,
      productionOrderWidget,
      orderWidget,
      rotatorWidget,
	  lunchWidget,
      qualityCostWidget,
      activitiesWidget,
/* 	  drawingwidget, */
    ];
  }, [user, settings, pauseRotation, is4K]);

  const totalPages = Math.ceil(widgets.length / ITEMS_PER_PAGE);

  // FIX: swipe-handlern ovan är definierad innan totalPages finns (den byggs
  // av widgets/ITEMS_PER_PAGE längre ner), så vi speglar värdet i en ref —
  // det håller handlern stabil (inga onödiga re-renders) samtidigt som den
  // alltid ser det senaste sidantalet istället för ett inaktuellt värde.
  const totalPagesRef = useRef(totalPages);
  useEffect(() => {
    totalPagesRef.current = totalPages;
  }, [totalPages]);

  const paginatedWidgets = useMemo(
    () => widgets.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE),
    [widgets, page, ITEMS_PER_PAGE]
  );

  /* ------------------- LOADING / LOGIN SCREENS ------------------- */
  if (loading) return <div>Laddar inställningar…</div>;
  if (!user) return <Login onLogin={handleLogin} />;

  /* ------------------- DASHBOARD ------------------- */
return (
  <div className={`app ${navPosition}`}>
    {/* Topbar / Sidebar */}
    <header className="dashboard">
		<h1 className="logo">
		  <div className="logo-row">
			{imageExists && (
				<img 
					src="/brand-logo" 
					alt="Logotyp" 
					onError={() => setImageExists(false)}
					width={is4K ? 350 : 180}
				/>
			)}
			<span>
			{!imageExists && (<span className="logo-icon">📊</span>)}
			PULSTAVLA
			</span>
			<span className="today-date">{todayDate}</span>
		  </div>
		</h1>


      <nav className="nav">
        <button
          className={activeTab === "overview" ? "active" : ""}
          onClick={() => {
            setActiveTab("overview");
            setOpenMenu(false);
          }}
        >
          Översikt
        </button>

        <button
          className={activeTab === "activities" ? "active" : ""}
          onClick={() => {
            setActiveTab("activities");
            setOpenMenu(false);
          }}
        >
          Aktiviteter
        </button>

        {user?.role !== "view" && (
          <button
            className={activeTab === "checklist" ? "active" : ""}
            onClick={() => {
              setActiveTab("checklist");
              setOpenMenu(false);
            }}
          >
            Checklista
          </button>
        )}

        {user?.role !== "view" && (
          <button
            className={activeTab === "profile" ? "active" : ""}
            onClick={() => {
              setActiveTab("profile");
              setOpenMenu(false);
            }}
          >
            Profil ({user.name})
          </button>
        )}

        {/* DROPDOWN */}
        {user?.role !== "view" && (
          <div className="nav-dropdown">
            <button
              className="nav-dropdown-button"
              onClick={() => setOpenMenu(!openMenu)}
            >
              Mer ▾
            </button>

            {openMenu && (
              <div className="nav-dropdown-menu">
                <button
                  className={activeTab === "orders" ? "active" : ""}
                  onClick={() => {
                    setActiveTab("orders");
                    setOpenMenu(false);
                  }}
                >
                  Kundordrar
                </button>

                {user?.role === "suAdmin" && (
                  <button
                    className={activeTab === "production" ? "active" : ""}
                    onClick={() => {
                      setActiveTab("production");
                      setOpenMenu(false);
                    }}
                  >
                    Tillverkningsordrar
                  </button>
                )}
                <button
                  className={activeTab === "matprotokoll" ? "active" : ""}
                  onClick={() => {
                    setActiveTab("matprotokoll");
                    setOpenMenu(false);
                  }}
                >
                  Mätprotokoll
                </button>
                <button
                  className={activeTab === "documents" ? "active" : ""}
                  onClick={() => {
                    setActiveTab("documents");
                    setOpenMenu(false);
                  }}
                >
                  Dokument
                </button>
                {(user?.role === "admin" || user?.role === "suAdmin") && (
                  <button
                    className={activeTab === "settings" ? "active" : ""}
                    onClick={() => {
                      setActiveTab("settings");
                      setOpenMenu(false);
                    }}
                  >
                    Inställningar
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        <button className="theme-toggle" onClick={toggleTheme}>
          {theme === "light" ? "🌙 Mörkt läge" : "☀️ Ljust läge"}
        </button>
		{is4K && (
			<button className="theme-toggle" onClick={toggleFullscreen}>
			  {isFullscreen ? "🡼 Avsluta helskärm" : "⛶ Helskärm"}
			</button>
		)}
        {/* NY: växla nav-läge */}
		{!isPortrait && (
			<button className="theme-toggle" onClick={toggleNavPosition}>
			  {navPosition === "top" ? "⬅️ Sidomeny" : "⬆️ Toppmeny"}
			</button>
		)}

        <button className="theme-toggle" onClick={logout}>
          Logga ut
        </button>
      </nav>
    </header>

    {/* Main Content */}
    <main className="content">
	
      {activeTab === "overview" && (
        <div onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
          {totalPages > 1 && (
            <div className="pagination-dots">
              {Array.from({ length: totalPages }).map((_, i) => (
                <button
                  key={i}
                  onClick={() => {setPage(i); setOpenMenu(false);}}
                  className={`dot ${page === i ? "active" : ""}`}
                  aria-label={`Gå till sida ${i + 1}`}
                />
              ))}
            </div>
          )}
		  {is4K && (
			<div className="widget-top">
				<h2><i>Pulsmöte hålls varje Tisdag och Torsdag klockan 07.05.</i></h2>
			</div>
		  )}
          <div className="widget-grid" key={page}>
            {/* FIX: stable key using page offset instead of bare index */}
            {paginatedWidgets.map((w, index) => (
              <div key={page * ITEMS_PER_PAGE + index}>{w}</div>
            ))}
          </div>
        </div>
      )}

      <Suspense fallback={<div className="page-loading">Laddar sida…</div>}>
        {activeTab === "activities" && <Activities />}
        {activeTab === "settings" && <Settings />}
        {activeTab === "profile" && (
          <Profile user={user} setUser={setUser} setActiveTab={setActiveTab} />
        )}
        {activeTab === "checklist" && <MachineChecklist currentUser={user} />}
        {activeTab === "adminUsers" && <AdminUsers currentUser={user} />}
        {activeTab === "documents" && <MachineDocuments />}
        {activeTab === "orders" && <OrderImport />}
        {activeTab === "production" && <ProductionOrderImport />}
        {activeTab === "matprotokoll" && <Matprotokoll />}
      </Suspense>
    </main>
  </div>
);
}