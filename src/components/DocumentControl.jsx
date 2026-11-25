import { Fragment, useCallback, useEffect, useState } from "react";
import { apiFetch } from "../api";
import "./DocumentControl.css";

const DOCUMENT_TEMPLATES = [
  { key: "KHB", label: "Kvalitetshandbok", category: "Kvalitetshandbok", sections: ["Verksamhet och omfattning", "Kvalitetsledningssystemets uppbyggnad", "Processer och deras samverkan", "Ansvar och befogenheter", "Kvalitetspolicy och kvalitetsmål", "Risker och möjligheter", "Kompetens och resurser", "Uppföljning, avvikelsehantering och förbättring", "Hänvisningar till styrande dokument"] },
  { key: "POL", label: "Policy", category: "Policy", sections: ["Syfte och åtagande", "Omfattning", "Policy och grundprinciper", "Ansvar", "Kommunikation och tillämpning", "Uppföljning och översyn"] },
  { key: "RUT", label: "Rutin", category: "Rutin", sections: ["Syfte", "Omfattning", "Definitioner och förutsättningar", "Ansvar och befogenheter", "Genomförande – arbetsflöde steg för steg", "Kontroller och acceptanskriterier", "Hantering av avvikelser", "Dokumentation och relaterade dokument"] },
  { key: "AI", label: "Arbetsinstruktion", category: "Arbetsinstruktion", sections: ["Syfte och arbetsmoment", "Omfattning och förutsättningar", "Verktyg, material och utrustning", "Säkerhet och risker", "Arbetsgång – steg för steg", "Kontrollpunkter och acceptanskriterier", "Avvikelsehantering", "Dokumentation"] },
  { key: "AIN", label: "Allmän instruktion", category: "Allmän instruktion", sections: ["Syfte", "Vem instruktionen gäller för", "Grundregler", "Arbetssätt och förväntat beteende", "Ansvar", "Hänvisningar till rutiner och arbetsinstruktioner"] },
  { key: "FORM", label: "Blankett / Mall", category: "Blankett", sections: ["Syfte och användningsområde", "När och av vem dokumentet ska användas", "Instruktioner för ifyllnad", "Uppgifter och kontrollfält som ska dokumenteras", "Granskning, signering och sparande", "Hänvisningar och relaterade dokument"] }
];

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
  const [templateKey, setTemplateKey] = useState("RUT");
  const [templateTitle, setTemplateTitle] = useState("");
  const [templateCategory, setTemplateCategory] = useState("Rutin");
  const [templateOwner, setTemplateOwner] = useState("");
  const [templateDescription, setTemplateDescription] = useState("");
  const [templateSections, setTemplateSections] = useState({});
  const [templateSaving, setTemplateSaving] = useState(false);
  const [workflowUsers, setWorkflowUsers] = useState([]);
  const [workflowData, setWorkflowData] = useState({});
  const [workflowAssignments, setWorkflowAssignments] = useState({});
  const [workflowComments, setWorkflowComments] = useState({});
  const [workflowSaving, setWorkflowSaving] = useState(false);
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

  const selectedTemplate = DOCUMENT_TEMPLATES.find((template) => template.key === templateKey) || DOCUMENT_TEMPLATES[2];

  const changeTemplate = (key) => {
    const nextTemplate = DOCUMENT_TEMPLATES.find((template) => template.key === key);
    setTemplateKey(key);
    setTemplateCategory(nextTemplate?.category || "Rutin");
    setTemplateTitle("");
    setTemplateSections({});
  };

  const createFromTemplate = async (event) => {
    event.preventDefault();
    setTemplateSaving(true);
    setMessage("");
    setError("");
    try {
      const response = await apiFetch("/document-control/documents/from-template", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token") || ""}`,
        },
        body: JSON.stringify({
          templateKey, title: templateTitle.trim(), category: templateCategory,
          owner: templateOwner.trim(), description: templateDescription.trim(),
          sections: templateSections,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Kunde inte skapa dokumentet från mallen.");
      setMessage(`Utkastet ${data.document.documentNumber} har skapats med revision 00. Det är inte granskat eller godkänt.`);
      setTemplateTitle("");
      setTemplateOwner("");
      setTemplateDescription("");
      setTemplateSections({});
      await loadRegister();
    } catch (err) {
      setError(err.message || "Kunde inte skapa dokumentet från mallen.");
    } finally {
      setTemplateSaving(false);
    }
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
      const response = await apiFetch("/documents/" + encodeURIComponent(revision.fileName), {
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
        <form className="document-control-form document-control-template-form" onSubmit={createFromTemplate}>
          <h3>Skapa nytt styrande dokument från mall</h3>
          <p>Välj dokumenttyp och fyll i relevanta avsnitt. Pulstavla skapar ett separat utkast med automatiskt dokumentnummer och revision 00.</p>
          <div className="document-control-form-grid">
            <label>
              Dokumentmall *
              <select value={templateKey} onChange={(event) => changeTemplate(event.target.value)}>
                {DOCUMENT_TEMPLATES.map((template) => <option key={template.key} value={template.key}>{template.label}</option>)}
              </select>
            </label>
            {templateKey === "FORM" && (
              <label>
                Dokumentkategori *
                <select value={templateCategory} onChange={(event) => setTemplateCategory(event.target.value)}>
                  <option value="Blankett">Blankett</option>
                  <option value="Mall">Mall</option>
                </select>
              </label>
            )}
            <label>
              Dokumentnamn *
              <input value={templateTitle} onChange={(event) => setTemplateTitle(event.target.value)} maxLength={200} required placeholder={selectedTemplate.label} />
            </label>
            <label>
              Dokumentansvarig
              <input value={templateOwner} onChange={(event) => setTemplateOwner(event.target.value)} maxLength={120} />
            </label>
          </div>
          <label>
            Kort beskrivning
            <textarea value={templateDescription} onChange={(event) => setTemplateDescription(event.target.value)} rows={2} maxLength={1000} />
          </label>
          <div className="document-control-template-sections">
            <h4>Dokumentinnehåll</h4>
            {selectedTemplate.sections.map((heading) => (
              <label key={heading}>
                {heading}
                <textarea
                  value={templateSections[heading] || ""}
                  onChange={(event) => setTemplateSections((previous) => ({ ...previous, [heading]: event.target.value }))}
                  rows={3}
                  maxLength={12000}
                  placeholder="Beskriv innehållet här. Lämna avsnitt tomt om det inte är relevant; det markeras då för komplettering i utkastet."
                />
              </label>
            ))}
          </div>
          <button className="btn-primary" type="submit" disabled={templateSaving || !templateTitle.trim()}>
            {templateSaving ? "Skapar utkast..." : "Skapa dokumentutkast"}
          </button>
        </form>
      )}

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
                  <td><span className="document-control-status">{({ "needs-review": "Ej granskad", "in-review": "Under granskning", "awaiting-approval": "Väntar på godkännande", published: "Godkänd / publicerad" })[doc.status] || doc.status || "Ej granskad"}</span></td>
                  <td><button type="button" className="btn-secondary" onClick={() => loadRevisions(doc.documentId)}>
                    {expandedDocumentId === doc.documentId ? "Dölj" : "Revisioner"}
                  </button></td>
                </tr>
                {expandedDocumentId === doc.documentId && (
                  <tr key={doc.documentId + "-history"}>
                    <td colSpan="7">
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
                <tr><td colSpan="7" className="document-control-empty">Inga registrerade dokument hittades.</td></tr>
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
