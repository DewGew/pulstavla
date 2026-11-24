import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../api";
import "./DocumentControl.css";

const CATEGORIES = [
  "Rutin",
  "Arbetsinstruktion",
  "Blankett",
  "Mall",
  "Policy",
  "Övrigt",
];

export default function DocumentControl() {
  const [documents, setDocuments] = useState([]);
  const [availableFiles, setAvailableFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [form, setForm] = useState({
    documentNumber: "",
    title: "",
    category: "Arbetsinstruktion",
    owner: "",
    description: "",
    fileName: "",
  });

  const currentUser = (() => {
    try {
      return JSON.parse(localStorage.getItem("user") || "{}");
    } catch {
      return {};
    }
  })();
  const canRegister = ["admin", "suAdmin"].includes(currentUser.role);

  const loadRegister = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await apiFetch("/document-control/documents", {
        headers: { Authorization: `Bearer ${localStorage.getItem("token") || ""}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Kunde inte läsa dokumentregistret.");
      setDocuments(Array.isArray(data.documents) ? data.documents : []);
      setAvailableFiles(Array.isArray(data.availableFiles) ? data.availableFiles : []);
    } catch (err) {
      setError(err.message || "Ett fel uppstod när dokumentregistret skulle hämtas.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRegister();
  }, [loadRegister]);

  const updateField = (event) => {
    const { name, value } = event.target;
    setForm((previous) => ({ ...previous, [name]: value }));
    if (name === "fileName" && value) {
      setForm((previous) => ({
        ...previous,
        fileName: value,
        title: previous.title || value.replace(/\.[^.]+$/, ""),
      }));
    }
  };

  const registerDocument = async (event) => {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const response = await apiFetch("/document-control/documents", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token") || ""}`,
        },
        body: JSON.stringify(form),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Kunde inte registrera dokumentet.");
      setMessage("Dokumentet har registrerats. Det är ännu inte granskat eller godkänt.");
      setForm({
        documentNumber: "",
        title: "",
        category: "Arbetsinstruktion",
        owner: "",
        description: "",
        fileName: "",
      });
      await loadRegister();
    } catch (err) {
      setError(err.message || "Registreringen misslyckades.");
    } finally {
      setSaving(false);
    }
  };

  const visibleDocuments = documents.filter((doc) =>
    [doc.documentNumber, doc.title, doc.category, doc.fileName, doc.owner]
      .some((value) => String(value || "").toLowerCase().includes(filter.toLowerCase()))
  );

  return (
    <section className="document-control">
      <header className="document-control-header">
        <div>
          <h2>Dokumentstyrning</h2>
          <p>Register över styrda dokument. Registrering innebär inte att dokumentet är godkänt.</p>
        </div>
        <button type="button" className="btn-secondary" onClick={loadRegister} disabled={loading}>
          Uppdatera
        </button>
      </header>

      {message && <p className="document-control-message" role="status">{message}</p>}
      {error && <p className="document-control-error" role="alert">{error}</p>}

      {canRegister && (
        <form className="document-control-form" onSubmit={registerDocument}>
          <h3>Registrera befintligt dokument</h3>
          <p>Filen ligger kvar på sin nuvarande plats. Här lägger du endast till registeruppgifter.</p>

          <label>
            Befintlig fil *
            <select name="fileName" value={form.fileName} onChange={updateField} required>
              <option value="">Välj fil i dokumentmappen</option>
              {availableFiles.map((file) => <option key={file} value={file}>{file}</option>)}
            </select>
          </label>

          <div className="document-control-form-grid">
            <label>
              Dokumentnummer
              <input name="documentNumber" value={form.documentNumber} onChange={updateField} maxLength={80} />
            </label>
            <label>
              Dokumentnamn *
              <input name="title" value={form.title} onChange={updateField} required maxLength={200} />
            </label>
            <label>
              Dokumentkategori *
              <select name="category" value={form.category} onChange={updateField} required>
                {CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
            </label>
            <label>
              Dokumentansvarig
              <input name="owner" value={form.owner} onChange={updateField} maxLength={120} />
            </label>
          </div>

          <label>
            Beskrivning / kommentar
            <textarea name="description" value={form.description} onChange={updateField} rows={2} maxLength={1000} />
          </label>

          <button className="btn-primary" type="submit" disabled={saving || !form.fileName || !form.title.trim()}>
            {saving ? "Registrerar..." : "Registrera dokument"}
          </button>
        </form>
      )}

      <div className="document-control-list-header">
        <h3>Registrerade dokument ({documents.length})</h3>
        <input
          type="search"
          placeholder="Sök dokument..."
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          aria-label="Sök dokument"
        />
      </div>

      {loading ? <p>Hämtar dokumentregistret...</p> : (
        <div className="document-control-table-wrap">
          <table className="document-control-table">
            <thead>
              <tr>
                <th>Dokumentnummer</th>
                <th>Namn</th>
                <th>Kategori</th>
                <th>Ansvarig</th>
                <th>Fil</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {visibleDocuments.map((doc) => (
                <tr key={doc.documentId}>
                  <td>{doc.documentNumber || "—"}</td>
                  <td>{doc.title}</td>
                  <td>{doc.category}</td>
                  <td>{doc.owner || "—"}</td>
                  <td>{doc.fileName}</td>
                  <td><span className="document-control-status">Ej granskad</span></td>
                </tr>
              ))}
              {visibleDocuments.length === 0 && (
                <tr><td colSpan="6" className="document-control-empty">Inga registrerade dokument hittades.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <p className="document-control-footnote">
        {availableFiles.length} filer i den befintliga dokumentmappen väntar på eventuell registrering.
        Inga filer importeras automatiskt eller ändras av registret.
      </p>
    </section>
  );
}
