import { createContext, useContext, useEffect, useState } from "react";
import { API_URL } from "../config";
import { io } from "socket.io-client";
import { WS_URL } from "../config";
import { createApi } from "../api";
import { socket, connectSocket } from "../socket";

const SettingsContext = createContext(null);

const socket = io(WS_URL, { transports: ["websocket"], 
  auth: (cb) => cb({ token: localStorage.getItem("token") }),
});

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
	
	function logout() {
    localStorage.removeItem("user");
    localStorage.removeItem("token");
  };

  const apiFetch = createApi(logout);

  useEffect(() => {
    const loadSettings = () => {
      const token = localStorage.getItem("token");
      if (!token) {
        setLoading(false);
        return;
      }

      setLoading(true);
      apiFetch("/settings")
        .then(res => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .then(data => {
          setSettings(data);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    };

    loadSettings();
    window.addEventListener("authChanged", loadSettings);
    return () => window.removeEventListener("authChanged", loadSettings);
  }, []);

  useEffect(() => {
    function connectSocket() {
      connectSocket();
    }

    function onSettingsUpdated({ key, value }) {
      setSettings(prev => ({
        ...prev,
        [key]: value,
      }));
    }

    connectSocket();
    window.addEventListener("authChanged", connectSocket);
    socket.on("settingsUpdated", onSettingsUpdated);

    return () => {
      window.removeEventListener("authChanged", connectSocket);
      socket.off("settingsUpdated", onSettingsUpdated);
    };
  }, []);

  return (
    <SettingsContext.Provider value={{ settings, loading }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    throw new Error("useSettings måste användas inom SettingsProvider");
  }
  return ctx;
}

/* ---------------- LOGO (förladdas en gång, cachas som dataURL) ---------------- */
let logoDataUrl = null;
let logoAspect = 1; // höjd / bredd, uppdateras när bilden laddats

const logoImg = new Image();
logoImg.src = "/brand-logo";
logoImg.onload = () => {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = logoImg.naturalWidth;
    canvas.height = logoImg.naturalHeight;
    canvas.getContext("2d").drawImage(logoImg, 0, 0);
    logoDataUrl = canvas.toDataURL("image/png");
    logoAspect = logoImg.naturalHeight / logoImg.naturalWidth;
  } catch (err) {
    console.warn("Kunde inte förladda logo.png:", err);
  }
};
logoImg.onerror = () => {
  console.warn("Kunde inte hitta /docs/logo.png");
};

export const addPDFHeader = (doc, title, settings) => {
  const pageWidth = doc.internal.pageSize.getWidth();

  // Logga längst upp till vänster
  const logoWidth = 32; // mm
  const logoHeight = logoWidth * logoAspect;
  const textStartX = logoDataUrl ? 15 + logoWidth + 5 : 15; // ge plats åt loggan om den finns

  if (logoDataUrl) {
    try {
      doc.addImage(logoDataUrl, "PNG", 15, 8, logoWidth, logoHeight);
    } catch (err) {
      console.warn("Kunde inte rita logo i PDF:", err);
    }
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(
    settings.company || "Företagsnamn",
    textStartX,
    15
  );
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(title, textStartX, 22);
  doc.setFontSize(8);
  doc.text(
    new Date().toLocaleDateString("sv-SE"),
    pageWidth - 15,
    15,
    { align: "right" }
  );
};


export const addPDFFooter = (doc, settings) => {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);

  doc.text(
    settings.company || "Företagsnamn",
    15,
    pageHeight - 15
  );

  doc.text(
    settings.address ||
      "Företagsvägen 1, SE-123 45 STORSTADEN, Sverige",
    15,
    pageHeight - 11
  );

  doc.text(
    settings.email ||
		"+46 123 123 45  |  info@företaget.com",
    pageWidth - 15,
    pageHeight - 11,
    { align: "right" }
  );
};