import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API_URL } from "../config";
import { Html5Qrcode } from "html5-qrcode";
import "./PublicMeasuringTools.css";

export default function PublicMeasuringTools() {
  const [tools, setTools] = useState([]);
  const [activeTab, setActiveTab] = useState("available");
  const [search, setSearch] = useState("");
  const [selectedTool, setSelectedTool] = useState(null);
  const [employeeNumber, setEmployeeNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerError, setScannerError] = useState("");
  const scannerRef = useRef(null);
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem("public-loan-theme") === "dark" ? "dark" : "light"; }
    catch { return "light"; }
  });

  useEffect(() => {
    try { localStorage.setItem("public-loan-theme", theme); } catch { /* Lagring är valfri. */ }
  }, [theme]);

  const loadTools = useCallback(async () => {
    try {
      setError("");
      const response = await fetch(`${API_URL}/public/measuring-tools`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Kunde inte hämta mätverktyg.");
      setTools(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message || "Kunde inte hämta mätverktyg.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadTools(); }, [loadTools]);

  useEffect(() => {
    if (!scannerOpen) return undefined;

    let cancelled = false;
    let scanner;
    let started = false;

    const startScanner = async () => {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setScannerError("Kameran kräver HTTPS. Öppna sidan via produktionsadressen med https://.");
        return;
      }

      try {
        scanner = new Html5Qrcode("public-loan-qr-reader");
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1 },
          (decodedText) => {
            if (cancelled) return;
            const value = decodedText.trim();
            if (!value) return;
            const matchedTool = tools.find((tool) =>
              String(tool.toolNumber || "").trim().toLocaleLowerCase("sv") === value.toLocaleLowerCase("sv")
            );
            setSearch(value);
            setActiveTab(matchedTool?.status === "Utlånad" ? "borrowed" : "available");
            setScannerOpen(false);
          },
          () => {}
        );
        started = true;
        if (cancelled) {
          await scanner.stop();
          scanner.clear();
        }
      } catch (err) {
        if (!cancelled) {
          setScannerError(err?.message || "Kunde inte starta QR-skannern. Kontrollera kamerabehörigheten.");
        }
      }
    };

    startScanner();
    return () => {
      cancelled = true;
      if (scannerRef.current === scanner) scannerRef.current = null;
      if (scanner && started) {
        scanner.stop().then(() => scanner.clear()).catch(() => {});
      } else if (scanner) {
        scanner.clear();
      }
    };
  }, [scannerOpen, tools]);

  const availableTools = useMemo(
    () => tools.filter((tool) => tool.status === "Disponibel"),
    [tools]
  );
  const borrowedTools = useMemo(
    () => tools.filter((tool) => tool.status === "Utlånad"),
    [tools]
  );
  const visibleTools = useMemo(() => {
    const list = activeTab === "available" ? availableTools : borrowedTools;
    const query = search.trim().toLocaleLowerCase("sv");
    if (!query) return list;
    return list.filter((tool) =>
      [tool.toolNumber, tool.type, tool.description, tool.manufacturer, tool.range, tool.location]
        .join(" ").toLocaleLowerCase("sv").includes(query)
    );
  }, [activeTab, availableTools, borrowedTools, search]);

  const submitAction = async (event) => {
    event.preventDefault();
    if (!selectedTool || !employeeNumber.trim() || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const action = selectedTool.action;
      const response = await fetch(
        `${API_URL}/public/measuring-tools/${encodeURIComponent(selectedTool._id)}/${action}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ employeeNumber: employeeNumber.trim() }),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Åtgärden kunde inte genomföras.");
      setNotice(action === "checkout"
        ? `${selectedTool.toolNumber} är nu utlånat.`
        : `${selectedTool.toolNumber} är nu återlämnat.`);
      setSelectedTool(null);
      setEmployeeNumber("");
      await loadTools();
    } catch (err) {
      setError(err.message || "Åtgärden kunde inte genomföras.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="public-loan-page" data-theme={theme}>
      <header className="public-loan-header">
        <div className="public-loan-header-top">
          <a className="public-loan-brand" href="/" aria-label="Pulstavlan">
            <span className="public-loan-brand-mark">P</span>
            <span>PULSTAVLA</span>
          </a>
          <button type="button" className="public-loan-theme-toggle"
            onClick={() => setTheme((current) => current === "light" ? "dark" : "light")}
            aria-label={theme === "light" ? "Aktivera mörkt läge" : "Aktivera ljust läge"}
            aria-pressed={theme === "dark"}>
            <span aria-hidden="true">{theme === "light" ? "☾" : "☀"}</span>
            {theme === "light" ? "Mörkt läge" : "Ljust läge"}
          </button>
        </div>
        <div className="public-loan-intro">
          <h1>Låna mätverktyg</h1>
          <p>Hitta ett ledigt verktyg eller återlämna ett du har lånat.</p>
        </div>
      </header>

      <main className="public-loan-content">
        <div className="public-loan-tabs" role="tablist" aria-label="Verktygsstatus">
          <button type="button" role="tab" aria-selected={activeTab === "available"}
            className={activeTab === "available" ? "active" : ""}
            onClick={() => { setActiveTab("available"); setSearch(""); setError(""); }}>
            Lediga <span>{availableTools.length}</span>
          </button>
          <button type="button" role="tab" aria-selected={activeTab === "borrowed"}
            className={activeTab === "borrowed" ? "active" : ""}
            onClick={() => { setActiveTab("borrowed"); setSearch(""); setError(""); }}>
            Utlånade <span>{borrowedTools.length}</span>
          </button>
        </div>

        <div className="public-loan-search-row">
          <label className="public-loan-search">
          <span className="public-loan-search-icon" aria-hidden="true">⌕</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)}
            placeholder="Sök verktygsnummer, namn eller typ…" />
          </label>
          <button type="button" className="public-loan-scan-button"
            onClick={() => { setScannerError(""); setScannerOpen(true); }}>
            <span aria-hidden="true">▦</span> Skanna QR-kod
          </button>
        </div>

        {notice && <div className="public-loan-notice" role="status">{notice}<button type="button" onClick={() => setNotice("")} aria-label="Stäng">×</button></div>}
        {error && !selectedTool && <div className="public-loan-error" role="alert">{error}</div>}
        {loading ? (
          <div className="public-loan-empty">Hämtar mätverktyg…</div>
        ) : visibleTools.length === 0 ? (
          <div className="public-loan-empty">
            <span aria-hidden="true">⌕</span>
            <strong>{search ? "Inga verktyg matchar sökningen" : activeTab === "available" ? "Inga lediga mätverktyg just nu" : "Inga utlånade mätverktyg"}</strong>
            <p>{search ? "Prova ett annat sökord." : "Listan uppdateras när ett verktyg lånas eller återlämnas."}</p>
          </div>
        ) : (
          <div className="public-loan-grid">
            {visibleTools.map((tool) => (
              <article className="public-loan-card" key={tool._id}>
                <div className="public-loan-card-top">
                  <span className={tool.status === "Disponibel" ? "public-loan-status available" : "public-loan-status borrowed"}>
                    {tool.status === "Disponibel" ? "Ledigt" : "Utlånat"}
                  </span>
                  <span className="public-loan-number">{tool.toolNumber}</span>
                </div>
                <h2>{tool.description || tool.type || "Mätverktyg"}</h2>
                {tool.type && <p className="public-loan-type">{tool.type}</p>}
                {tool.status === "Utlånad" && tool.borrowerName && (
                  <p className="public-loan-borrower">Lånad av: <strong>{tool.borrowerName}</strong></p>
                )}
                <dl>
                  {tool.range && <div><dt>Mätområde</dt><dd>{tool.range}</dd></div>}
                  {tool.manufacturer && <div><dt>Tillverkare</dt><dd>{tool.manufacturer}</dd></div>}
                  {tool.location && <div><dt>Placering</dt><dd>{tool.location}</dd></div>}
                </dl>
                <button type="button" className={tool.status === "Disponibel" ? "public-loan-action" : "public-loan-action secondary"}
                  onClick={() => { setError(""); setSelectedTool({ ...tool, action: tool.status === "Disponibel" ? "checkout" : "return" }); setEmployeeNumber(""); }}>
                  {tool.status === "Disponibel" ? "Låna verktyget" : "Återlämna verktyget"}
                </button>
              </article>
            ))}
          </div>
        )}
        <p className="public-loan-footnote">Ange ditt anställningsnummer för att registrera lån eller återlämning.</p>
      </main>

      {scannerOpen && (
        <div className="public-loan-modal-backdrop" role="presentation">
          <section className="public-loan-modal public-loan-scanner" role="dialog" aria-modal="true" aria-labelledby="public-loan-scanner-title">
            <button type="button" className="public-loan-modal-close"
              onClick={() => setScannerOpen(false)} aria-label="Stäng">×</button>
            <h2 id="public-loan-scanner-title">Skanna mätverktygets QR-kod</h2>
            <p>Rikta mobilens kamera mot QR-koden. Verktygsnumret fylls i automatiskt.</p>
            <div id="public-loan-qr-reader" className="public-loan-scanner-reader" />
            {scannerError && <div className="public-loan-error" role="alert">{scannerError}</div>}
            <button type="button" className="public-loan-cancel" onClick={() => setScannerOpen(false)}>Stäng skannern</button>
          </section>
        </div>
      )}

      {selectedTool && (
        <div className="public-loan-modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !busy) setSelectedTool(null);
        }}>
          <section className="public-loan-modal" role="dialog" aria-modal="true" aria-labelledby="public-loan-modal-title">
            <button type="button" className="public-loan-modal-close" onClick={() => setSelectedTool(null)} disabled={busy} aria-label="Stäng">×</button>
            <span className={selectedTool.action === "checkout" ? "public-loan-status available" : "public-loan-status borrowed"}>
              {selectedTool.action === "checkout" ? "Låna" : "Återlämna"}
            </span>
            <h2 id="public-loan-modal-title">{selectedTool.description || selectedTool.type}</h2>
            <p className="public-loan-modal-number">{selectedTool.toolNumber}</p>
            <form onSubmit={submitAction}>
              <label htmlFor="public-employee-number">Anställningsnummer</label>
              <input id="public-employee-number" value={employeeNumber}
                onChange={(event) => setEmployeeNumber(event.target.value)}
                autoComplete="off" autoFocus required maxLength={40}
                placeholder="Ange anställningsnummer" />
              {error && <div className="public-loan-error" role="alert">{error}</div>}
              <button type="submit" className="public-loan-action" disabled={busy || !employeeNumber.trim()}>
                {busy ? "Registrerar…" : selectedTool.action === "checkout" ? "Bekräfta lån" : "Bekräfta återlämning"}
              </button>
              <button type="button" className="public-loan-cancel" onClick={() => setSelectedTool(null)} disabled={busy}>Avbryt</button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
