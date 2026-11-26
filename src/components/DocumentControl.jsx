import { Fragment, useCallback, useEffect, useState } from "react";
import { apiFetch } from "../api";
import "./DocumentControl.css";

const CATEGORIES = ["Kvalitetshandbok", "Policy", "Rutin", "Allmän instruktion", "Arbetsinstruktion", "Blankett", "Mall", "Övrigt"];

export default function DocumentControl() {
  const [documents, setDocuments] = useState([]);
  const [availableFiles, setAvailableFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [expandedDocumentId, setExpandedDocumentId] = useState("");
  const [revisionData, setRevisionData] = useState({});
  const [revisionForms, setRevisionForms] = useState({});
  const [revisionSaving, setRevisionSaving] = useState(false);
  const [workflowUsers, setWorkflowUsers] = useState([]);
  const [workflowData, setWorkflowData] = useState({});
  const [workflowAssignments, setWorkflowAssignments] = useState({});
  const [workflowComments, setWorkflowComments] = useState({});
  const [workflowSaving, setWorkflowSaving] = useState(false);
  const [uploadingDocument, setUploadingDocument] = useState(false);
  const [newDocumentFile, setNewDocumentFile] = useState(null);
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
  const currentUserId = currentUser._id || currentUser.id;

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

  useEffect(() => {
    if (!canRegister) return;
    apiFetch("/document-control/users", { headers: { Authorization: "Bearer " + (localStorage.getItem("token") || "") } })
      .then(async (response) => { const data = await response.json(); if (response.ok) setWorkflowUsers(Array.isArray(data) ? data : []); })
      .catch((err) => console.warn("Kunde inte läsa granskningsanvändare:", err.message));
  }, [canRegister]);

  const loadWorkflow = async (documentId) => {
    try {
      const response = await apiFetch("/document-control/documents/" + encodeURIComponent(documentId) + "/workflow", {
        headers: { Authorization: "Bearer " + (localStorage.getItem("token") || "") },
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status !== 403) throw new Error(data.error || "Kunde inte läsa granskningsflödet.");
        return;
      }
      setWorkflowData((previous) => ({ ...previous, [documentId]: data }));
      if (data.workflow) setWorkflowAssignments((previous) => ({ ...previous, [documentId]: {
        reviewerIds: data.workflow.reviewerIds || [], approverIds: data.workflow.approverIds || []
      } }));
    } catch (err) { setError(err.message || "Kunde inte läsa granskningsflödet."); }
  };

  const updateWorkflowAssignment = (documentId, field, selectedOptions) => {
    setWorkflowAssignments((previous) => ({ ...previous, [documentId]: {
      ...(previous[documentId] || { reviewerIds: [], approverIds: [] }),
      [field]: Array.from(selectedOptions, (option) => option.value),
    } }));
  };

  const startReview = async (doc) => {
    const assignment = workflowAssignments[doc.documentId] || {};
    if (!assignment.reviewerIds?.length || !assignment.approverIds?.length) {
      setError("Välj minst en granskare och en godkännare."); return;
    }
    setWorkflowSaving(true); setError(""); setMessage("");
    try {
      const response = await apiFetch("/document-control/documents/" + encodeURIComponent(doc.documentId) + "/submit-review", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + (localStorage.getItem("token") || "") },
        body: JSON.stringify(assignment),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Kunde inte starta granskningen.");
      setMessage("Dokumentet har skickats till granskning. Berörda användare får ett meddelande.");
      await loadRegister(); await loadWorkflow(doc.documentId);
    } catch (err) { setError(err.message || "Kunde inte starta granskningen."); }
    finally { setWorkflowSaving(false); }
  };

  const decideWorkflow = async (doc, stage, decision) => {
    const comment = workflowComments[doc.documentId] || "";
    setWorkflowSaving(true); setError(""); setMessage("");
    try {
      const response = await apiFetch("/document-control/documents/" + encodeURIComponent(doc.documentId) + "/" + (stage === "review" ? "review" : "approval"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + (localStorage.getItem("token") || "") },
        body: JSON.stringify({ decision, comment }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Kunde inte spara beslutet.");
      setMessage(decision === "approved"
        ? (stage === "review" ? "Granskningen är registrerad." : data.status === "published" ? "Dokumentet är nu godkänt och publicerat." : "Ditt godkännande är registrerat.")
        : "Dokumentet har avvisats och behöver bearbetas.");
      setWorkflowComments((previous) => ({ ...previous, [doc.documentId]: "" }));
      await loadRegister(); await loadWorkflow(doc.documentId);
    } catch (err) { setError(err.message || "Kunde inte spara beslutet."); }
    finally { setWorkflowSaving(false); }
  };

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

  const uploadNewDocument = async (event) => {
    event.preventDefault();
    if (!newDocumentFile || !form.title.trim() || !form.category) {
      setError("Välj en fil och ange dokumentnamn samt kategori.");
      return;
    }
    setUploadingDocument(true); setMessage(""); setError("");
    try {
      const body = new FormData();
      body.append("file", newDocumentFile);
      body.append("documentNumber", form.documentNumber.trim());
      body.append("title", form.title.trim());
      body.append("category", form.category);
      body.append("owner", form.owner.trim());
      body.append("description", form.description.trim());
      const response = await apiFetch("/document-control/documents/upload", {
        method: "POST",
        headers: { Authorization: "Bearer " + (localStorage.getItem("token") || "") },
        body,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Kunde inte ladda upp dokumentet.");
      setMessage(data.documentNumber + " har laddats upp till Dokumentstyrning och är ännu inte granskat eller godkänt.");
      setForm({ documentNumber: "", title: "", category: "Arbetsinstruktion", owner: "", description: "", fileName: "" });
      setNewDocumentFile(null);
      event.currentTarget.reset();
      await loadRegister();
    } catch (err) {
      setError(err.message || "Uppladdningen misslyckades.");
    } finally {
      setUploadingDocument(false);
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

  const loadRevisions = async (documentId) => {
    if (expandedDocumentId === documentId) { setExpandedDocumentId(""); return; }
    setExpandedDocumentId(documentId);
    try {
      const response = await apiFetch("/document-control/documents/" + encodeURIComponent(documentId) + "/revisions", {
        headers: { Authorization: "Bearer " + (localStorage.getItem("token") || "") },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Kunde inte läsa revisionshistoriken.");
      setRevisionData((previous) => ({ ...previous, [documentId]: data }));
      await loadWorkflow(documentId);
    } catch (err) { setError(err.message || "Kunde inte läsa revisionshistoriken."); }
  };

  const downloadRevision = async (revision) => {
    try {
      const response = await apiFetch("/document-control/files/" + encodeURIComponent(revision.fileName), {
        headers: { Authorization: "Bearer " + (localStorage.getItem("token") || "") },
      });
      if (!response.ok) throw new Error("Kunde inte hämta revisionsfilen.");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = revision.originalFileName || revision.fileName;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) { setError(err.message || "Kunde inte ladda ner revisionsfilen."); }
  };

  const downloadLatestRevision = async (doc) => {
    try {
      const response = await apiFetch("/document-control/documents/" + encodeURIComponent(doc.documentId) + "/latest-download", {
        headers: { Authorization: "Bearer " + (localStorage.getItem("token") || "") },
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Kunde inte hämta den senaste godkända revisionen.");
      }
      const blobUrl = URL.createObjectURL(await response.blob());
      const disposition = response.headers.get("content-disposition") || "";
      const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      const plainName = disposition.match(/filename="?([^";]+)"?/i)?.[1];
      const downloadName = encodedName ? decodeURIComponent(encodedName) : (plainName || doc.fileName || "dokument");
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = downloadName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(blobUrl);
    } catch (err) { setError(err.message || "Kunde inte ladda ner dokumentfilen."); }
  };

  const updateRevisionForm = (documentId, field, value) => {
    setRevisionForms((previous) => ({ ...previous, [documentId]: { ...(previous[documentId] || {}), [field]: value } }));
  };

  const uploadRevision = async (event, doc) => {
    event.preventDefault();
    const revisionForm = revisionForms[doc.documentId] || {};
    if (!revisionForm.file || !revisionForm.revision?.trim() || !revisionForm.changeDescription?.trim()) {
      setError("Välj fil och ange revision samt ändringsbeskrivning."); return;
    }
    setRevisionSaving(true); setError(""); setMessage("");
    try {
      const body = new FormData();
      body.append("file", revisionForm.file);
      body.append("revision", revisionForm.revision.trim());
      body.append("changeDescription", revisionForm.changeDescription.trim());
      const response = await apiFetch("/document-control/documents/" + encodeURIComponent(doc.documentId) + "/revisions", {
        method: "POST",
        headers: { Authorization: "Bearer " + (localStorage.getItem("token") || "") },
        body,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Kunde inte spara revisionen.");
      setMessage("Revision " + data.revision + " har sparats som en separat fil. Dokumentet är åter markerat som ej granskat.");
      setRevisionForms((previous) => ({ ...previous, [doc.documentId]: {} }));
      await loadRegister();
      const historyResponse = await apiFetch("/document-control/documents/" + encodeURIComponent(doc.documentId) + "/revisions", {
        headers: { Authorization: "Bearer " + (localStorage.getItem("token") || "") },
      });
      const history = await historyResponse.json();
      if (historyResponse.ok) setRevisionData((previous) => ({ ...previous, [doc.documentId]: history }));
    } catch (err) { setError(err.message || "Uppladdningen av revisionen misslyckades."); }
    finally { setRevisionSaving(false); }
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
        <form className="document-control-form" onSubmit={uploadNewDocument}>
          <h3>Ladda upp nytt styrande dokument</h3>
          <p>Filen sparas separat från vanliga Dokument och blir ett utkast i dokumentstyrningen. Den blir inte gällande förrän granskning och godkännande är klara.</p>
          <label>
            Dokumentfil *
            <input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.md" required onChange={(event) => setNewDocumentFile(event.target.files?.[0] || null)} />
          </label>
          <div className="document-control-form-grid">
            <label>
              Eget dokumentnummer (valfritt)
              <input name="documentNumber" value={form.documentNumber} onChange={updateField} maxLength={80} placeholder="Lämna tomt för automatiskt nummer" />
              <small className="document-control-help">Om fältet lämnas tomt skapas nästa nummer automatiskt utifrån dokumentkategori.</small>
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
          <label>Beskrivning / kommentar
            <textarea name="description" value={form.description} onChange={updateField} rows={2} maxLength={1000} />
          </label>
          <button className="btn-primary" type="submit" disabled={uploadingDocument || !newDocumentFile || !form.title.trim()}>
            {uploadingDocument ? "Laddar upp..." : "Ladda upp och registrera"}
          </button>
        </form>
      )}

      {canRegister && (
        <details className="document-control-existing">
          <summary>Registrera en fil som redan finns under Dokument</summary>
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
              Eget dokumentnummer (valfritt)
              <input
                name="documentNumber"
                value={form.documentNumber}
                onChange={updateField}
                maxLength={80}
                placeholder="Lämna tomt för automatiskt nummer"
              />
              <small className="document-control-help">
                Om fältet lämnas tomt skapas nästa nummer automatiskt utifrån dokumentkategori.
                Dokumentadministratören kan ange ett eget nummer vid behov.
              </small>
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
        </details>
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
                <th>Registrerad fil</th>
                <th>Senaste godkända revision</th>
                <th>Status</th>
                <th>Historik</th>
              </tr>
            </thead>
            <tbody>
              {visibleDocuments.map((doc) => (
                <Fragment key={doc.documentId}>
                <tr>
                  <td>{doc.documentNumber || "—"}</td>
                  <td>{doc.title}</td>
                  <td>{doc.category}</td>
                  <td>{doc.owner || "—"}</td>
                  <td>{doc.fileName}</td>
                  <td>
                    <button type="button" className="btn-secondary" onClick={() => downloadLatestRevision(doc)}>
                      Ladda ner senaste
                    </button>
                    <small className="document-control-latest-revision-label">
                      {doc.publishedRevision ? "Publicerad Rev. " + doc.publishedRevision : "Ursprungsfil (ännu ingen publicerad revision)"}
                    </small>
                  </td>
                  <td><span className="document-control-status">{({ "needs-review": "Ej granskad", "in-review": "Under granskning", "awaiting-approval": "Väntar på godkännande", published: "Godkänd / publicerad" })[doc.status] || doc.status || "Ej granskad"}</span></td>
                  <td><button type="button" className="btn-secondary" onClick={() => loadRevisions(doc.documentId)}>
                    {expandedDocumentId === doc.documentId ? "Dölj" : "Revisioner"}
                  </button></td>
                </tr>
                {expandedDocumentId === doc.documentId && (
                  <tr key={doc.documentId + "-history"}>
                    <td colSpan="8">
                      <div className="document-control-revisions">
                        <h4>Revisionshistorik – {doc.title}</h4>
                        {!revisionData[doc.documentId] ? <p>Hämtar historik...</p> : (
                          <div className="document-control-revision-list">
                            {revisionData[doc.documentId].revisions.map((revision) => (
                              <div className="document-control-revision" key={revision.revisionId}>
                                <strong>Rev. {revision.revision}</strong>
                                <span>{revision.changeDescription}</span>
                                <small>{revision.createdAt ? new Date(revision.createdAt).toLocaleString("sv-SE") : "—"} · {revision.createdBy || "—"}</small>
                                <small>Fil: {revision.originalFileName || revision.fileName}</small>
                                <button type="button" className="btn-secondary" onClick={() => downloadRevision(revision)}>Ladda ner fil</button>
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="document-control-workflow">
                          <h4>Granskning och godkännande</h4>
                          {canRegister && (doc.status === "needs-review" || !doc.status) && (
                            <div className="document-control-workflow-setup">
                              <p>Tilldela en eller flera granskare och godkännare för aktuell revision ({doc.revision || "—"}).</p>
                              <label>Granskare
                                <select multiple size={Math.min(5, Math.max(3, workflowUsers.length))} value={workflowAssignments[doc.documentId]?.reviewerIds || []} onChange={(event) => updateWorkflowAssignment(doc.documentId, "reviewerIds", event.target.selectedOptions)}>
                                  {workflowUsers.map((person) => <option key={person.id} value={person.id}>{person.name} ({person.username})</option>)}
                                </select>
                              </label>
                              <label>Godkännare
                                <select multiple size={Math.min(5, Math.max(3, workflowUsers.length))} value={workflowAssignments[doc.documentId]?.approverIds || []} onChange={(event) => updateWorkflowAssignment(doc.documentId, "approverIds", event.target.selectedOptions)}>
                                  {workflowUsers.map((person) => <option key={person.id} value={person.id}>{person.name} ({person.username})</option>)}
                                </select>
                              </label>
                              <small>Håll Ctrl (Windows) eller Cmd (Mac) för att välja flera. Samtliga valda personer måste godkänna sitt steg.</small>
                              <button type="button" className="btn-primary" onClick={() => startReview(doc)} disabled={workflowSaving || !workflowAssignments[doc.documentId]?.reviewerIds?.length || !workflowAssignments[doc.documentId]?.approverIds?.length}>
                                {workflowSaving ? "Skickar..." : "Skicka till granskning"}
                              </button>
                            </div>
                          )}
                          {workflowData[doc.documentId]?.workflow && (
                            <div className="document-control-workflow-state">
                              <p><strong>Flöde för revision {workflowData[doc.documentId].workflow.revision || "—"}</strong> · Startat av {workflowData[doc.documentId].workflow.submittedByName || "—"}</p>
                              <p>Granskare: {workflowData[doc.documentId].workflow.reviewerIds.map((id) => workflowUsers.find((person) => person.id === id)?.name || workflowData[doc.documentId].workflow.reviews?.[id]?.userName || "Användare").join(", ")}</p>
                              <p>Godkännare: {workflowData[doc.documentId].workflow.approverIds.map((id) => workflowUsers.find((person) => person.id === id)?.name || workflowData[doc.documentId].workflow.approvals?.[id]?.userName || "Användare").join(", ")}</p>
                              <ul>
                                {workflowData[doc.documentId].workflow.reviewerIds.map((id) => {
                                  const result = workflowData[doc.documentId].workflow.reviews?.[id];
                                  return <li key={"review-" + id}>Granskning: {result?.userName || workflowUsers.find((person) => person.id === id)?.name || "Tilldelad"} – {result ? (result.decision === "approved" ? "Godkänd" : "Avvisad") : "Väntar"}{result?.comment ? " – " + result.comment : ""}</li>;
                                })}
                                {workflowData[doc.documentId].workflow.approverIds.map((id) => {
                                  const result = workflowData[doc.documentId].workflow.approvals?.[id];
                                  return <li key={"approval-" + id}>Godkännande: {result?.userName || workflowUsers.find((person) => person.id === id)?.name || "Tilldelad"} – {result ? (result.decision === "approved" ? "Godkänd" : "Avvisad") : "Väntar"}{result?.comment ? " – " + result.comment : ""}</li>;
                                })}
                              </ul>
                            </div>
                          )}
                          {doc.status === "in-review" && (workflowData[doc.documentId]?.workflow?.reviewerIds || []).includes(currentUserId) && !workflowData[doc.documentId]?.workflow?.reviews?.[currentUserId] && (
                            <div className="document-control-decision">
                              <label>Kommentar till granskningen (valfri)
                                <textarea rows={2} maxLength={2000} value={workflowComments[doc.documentId] || ""} onChange={(event) => setWorkflowComments((previous) => ({ ...previous, [doc.documentId]: event.target.value }))} />
                              </label>
                              <button type="button" className="btn-secondary" disabled={workflowSaving} onClick={() => decideWorkflow(doc, "review", "rejected")}>Begär ändring</button>
                              <button type="button" className="btn-primary" disabled={workflowSaving} onClick={() => decideWorkflow(doc, "review", "approved")}>Godkänn granskning</button>
                            </div>
                          )}
                          {doc.status === "awaiting-approval" && (workflowData[doc.documentId]?.workflow?.approverIds || []).includes(currentUserId) && !workflowData[doc.documentId]?.workflow?.approvals?.[currentUserId] && (
                            <div className="document-control-decision">
                              <label>Kommentar till godkännandet (valfri)
                                <textarea rows={2} maxLength={2000} value={workflowComments[doc.documentId] || ""} onChange={(event) => setWorkflowComments((previous) => ({ ...previous, [doc.documentId]: event.target.value }))} />
                              </label>
                              <button type="button" className="btn-secondary" disabled={workflowSaving} onClick={() => decideWorkflow(doc, "approval", "rejected")}>Avvisa dokument</button>
                              <button type="button" className="btn-primary" disabled={workflowSaving} onClick={() => decideWorkflow(doc, "approval", "approved")}>Godkänn och publicera</button>
                            </div>
                          )}
                          {(workflowData[doc.documentId]?.events || []).length > 0 && (
                            <details><summary>Händelselogg</summary><ul>{workflowData[doc.documentId].events.map((event) => <li key={event.eventId}>{new Date(event.createdAt).toLocaleString("sv-SE")} · {event.actorName} · {event.eventType}{event.details?.comment ? " – " + event.details.comment : ""}</li>)}</ul></details>
                          )}
                        </div>
                        {canRegister && (
                          <form className="document-control-revision-form" onSubmit={(event) => uploadRevision(event, doc)}>
                            <h4>Lägg till ny revision</h4>
                            <label>Revisionsbeteckning
                              <input value={revisionForms[doc.documentId]?.revision || ""} onChange={(event) => updateRevisionForm(doc.documentId, "revision", event.target.value)} maxLength={40} required />
                            </label>
                            <label>Ändringsbeskrivning
                              <textarea value={revisionForms[doc.documentId]?.changeDescription || ""} onChange={(event) => updateRevisionForm(doc.documentId, "changeDescription", event.target.value)} rows={2} maxLength={2000} required />
                            </label>
                            <label>Ny revisionsfil
                              <input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.md" onChange={(event) => updateRevisionForm(doc.documentId, "file", event.target.files?.[0] || null)} required />
                            </label>
                            <button className="btn-primary" type="submit" disabled={revisionSaving}>
                              {revisionSaving ? "Sparar..." : "Spara ny revision"}
                            </button>
                          </form>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
              {visibleDocuments.length === 0 && (
                <tr><td colSpan="8" className="document-control-empty">Inga registrerade dokument hittades.</td></tr>
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
