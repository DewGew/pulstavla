import { lazy, Suspense, useState, useEffect, useCallback } from "react";
import { useSettings } from "./components/SettingsContext";
import Login from "./components/Login";
import DashboardView from "./dashboard/DashboardView";









import { API_URL } from "./config";
import { socket, connectSocket, disconnectSocket } from "./socket";
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
const KpiAdmin = lazy(() => import("./dashboard/KpiAdmin"));


const today = new Date().toLocaleDateString("sv-SE", {
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
});

const todayDate = today.charAt(0).toUpperCase() + today.slice(1);

export default function App() {
  const { loading } = useSettings();
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
        const checkExpiry = () => {
          const expiresInMs = payload.exp * 1000 - Date.now();

          if (expiresInMs <= 0) {
            console.warn("Token expired");
            clearSession();
            return;
          }

          // setTimeout har en maximal säker fördröjning på cirka 24,8 dagar.
          // Kontrollera därför igen efter högst en dag tills token går ut.
          expiryTimer = window.setTimeout(
            checkExpiry,
            Math.min(expiresInMs, 24 * 60 * 60 * 1000)
          );
        };

        checkExpiry();
      }
    } catch (err) {
      console.error("Invalid token:", err);
      clearSession();
    }

    return () => {
      if (expiryTimer) window.clearTimeout(expiryTimer);
    };
  }, [clearSession, user]);

  // Android-TV med Chrome kan rapportera en mycket stor CSS-viewport vid 50 % zoom.
  // Behandla därför stora Android-skärmar separat från äkta desktop-4K.
  const isAndroidLargeScreen = /Android/i.test(navigator.userAgent) && window.screen.width >= 1200;

	/* ------------------- ORIENTATION / PAGINATION ------------------- */
	const [isPortrait, setIsPortrait] = useState(
	  window.matchMedia("(orientation: portrait)").matches
	);
	const [is4K, setIs4K] = useState(
	  (!isAndroidLargeScreen && window.matchMedia("(min-width: 3840px)").matches)
	);

	useEffect(() => {
	  const orientationMedia = window.matchMedia("(orientation: portrait)");
	  const fourKMedia = window.matchMedia("(min-width: 3840px)");

	  const handleOrientation = (e) => setIsPortrait(e.matches);
	  const handle4K = (e) => setIs4K(!isAndroidLargeScreen && e.matches);

	  orientationMedia.addEventListener("change", handleOrientation);
	  fourKMedia.addEventListener("change", handle4K);

	  return () => {
		orientationMedia.removeEventListener("change", handleOrientation);
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
  /* ------------------- LOADING / LOGIN SCREENS ------------------- */
  if (loading) return <div>Laddar inställningar…</div>;
  if (!user) return <Login onLogin={handleLogin} />;

  /* ------------------- DASHBOARD ------------------- */
return (
  <div className={`app ${navPosition}${isAndroidLargeScreen ? " android-large-screen" : ""}`}>
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
                  className={activeTab === "kpis" ? "active" : ""}
                  onClick={() => {
                    setActiveTab("kpis");
                    setOpenMenu(false);
                  }}
                >
                  Nyckeltal
                </button>
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
	
      {activeTab === "overview" && <DashboardView user={user} />}

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
        {activeTab === "kpis" && <KpiAdmin currentUser={user} />}
      </Suspense>
    </main>
  </div>
);
}