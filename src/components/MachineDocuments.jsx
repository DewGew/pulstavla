import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { apiFetch } from "../api";
import "./MachineDocuments.css";
import { API_URL } from "../config";

export default function MachineDocuments() {
  const [documents, setDocuments] = useState([]);
  const [modalDoc, setModalDoc] = useState(null);
  const [uploadModal, setUploadModal] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");

  const [token] = useState(() => localStorage.getItem("token"));

  const [user] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("user") || "{}");
    } catch {
      return {};
    }
  });

  const isAdmin =
    user.role === "admin" ||
    user.role === "suAdmin";

  useEffect(() => {
    loadDocuments();
  }, []);

  const loadDocuments = () => {
    apiFetch(`/documents`, {
      headers: localStorage.getItem("token")
        ? { Authorization: `Bearer ${localStorage.getItem("token")}` }
        : {},
    })
      .then(res => res.json())
      .then(data => setDocuments(data))
      .catch(err => console.error(err));
  };

  const openDocument = async (doc, download = false) => {
    try {
      const response = await apiFetch(`/documents/${encodeURIComponent(doc.name)}`, {
        headers: { Authorization: `Bearer ${token || localStorage.getItem("token") || ""}` },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const previewUrl = URL.createObjectURL(await response.blob());
      if (download) {
        const link = document.createElement("a");
        link.href = previewUrl;
        link.download = doc.name;
        link.click();
        URL.revokeObjectURL(previewUrl);
      } else {
        setModalDoc({ ...doc, previewUrl });
      }
    } catch (error) {
      console.error("Kunde inte öppna dokument:", error);
      alert("Kunde inte hämta dokumentet. Kontrollera att du är inloggad.");
    }
  };
  const openModal = (doc) => openDocument(doc);
  const closeModal = () => { if (modalDoc?.previewUrl) URL.revokeObjectURL(modalDoc.previewUrl); setModalDoc(null); };

  const openUploadModal = () => {
    setSelectedFile(null);
    setUploadMsg("");
    setUploadModal(true);
  };

  const closeUploadModal = () => {
    if (!uploading) {
      setUploadModal(false);
      setSelectedFile(null);
      setUploadMsg("");
    }
  };

  const getIcon = (name) => {
    const ext = name.split(".").pop().toLowerCase();

    switch (ext) {
      case "pdf":
        return "/icons/pdf.png";

      case "doc":
      case "docx":
        return "/icons/document.png";

      case "xls":
      case "xlsx":
        return "/icons/xls.png";

      case "png":
      case "jpg":
      case "jpeg":
        return "/icons/image.png";

      default:
        return "/icons/document.png";
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];

    if (!file) {
      setSelectedFile(null);
      return;
    }

    setSelectedFile(file);
    setUploadMsg("");
  };


	const handleUpload = async () => {
		if (!selectedFile) {
			setUploadMsg("Välj en fil först.");
			return;
		}

		setUploading(true);
		setUploadMsg("");

		try {
			if (!token) {
				throw new Error("Du är inte inloggad eller saknar token.");
			}

			const formData = new FormData();
			formData.append("file", selectedFile);

			const response = await apiFetch(`/documents`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				body: formData,
			});

			const responseText = await response.text();

			let data = null;
			try {
				data = JSON.parse(responseText);
			} catch {
				// Servern kan svara med text eller HTML i stället för JSON.
			}

			if (!response.ok) {
				const detail =
					data?.error ||
					data?.message ||
					responseText.slice(0, 300) ||
					`HTTP ${response.status}`;

				throw new Error(`HTTP ${response.status}: ${detail}`);
			}

			setUploadMsg("Dokumentet laddades upp!");
			loadDocuments();

			setTimeout(() => {
				setUploadModal(false);
				setSelectedFile(null);
				setUploadMsg("");
			}, 800);
		} catch (error) {
			console.error("Fel vid dokumentuppladdning:", error);
			setUploadMsg(
				`Uppladdningen misslyckades: ${error.message}`
			);
		} finally {
			setUploading(false);
		}
	};


  // =========================
  // TA BORT DOKUMENT
  // =========================
	const handleDelete = async (doc) => {
	  const confirmed = window.confirm(
		`Är du säker på att du vill ta bort "${doc.name}"?`
	  );

	  if (!confirmed) return;

	  try {
		const response = await apiFetch(
		  `/documents/${encodeURIComponent(doc.name)}`,
		  {
			method: "DELETE",
			headers: {
			  Authorization: `Bearer ${token}`,
			},
		  }
		);

		// Läs först som text så vi kan se vad servern faktiskt svarar
		const text = await response.text();

		let data;

		try {
		  data = JSON.parse(text);
		} catch {
		  console.error("Servern svarade inte med JSON:", text);

		  throw new Error(
			`Servern svarade med ogiltigt svar (${response.status})`
		  );
		}

		if (!response.ok) {
		  throw new Error(data.error || "Kunde inte ta bort dokumentet");
		}

		// Ta bort dokumentet från listan direkt
		setDocuments(prev =>
		  prev.filter(item => item.id !== doc.id)
		);

	  } catch (error) {
		console.error("Fel vid borttagning:", error);
		alert(error.message);
	  }
	};

  // Filtrera dokument
  const filteredDocuments = documents.filter(doc =>
    doc.name
      .toLowerCase()
      .includes(filterText.toLowerCase())
  );

  return (
    <div className="widget documents">

      {/* Rubrik */}
      <div className="documents-header">
        <h2>Dokument</h2>
      </div>

      {/* Filter */}
      <div className="document-filter">

        {isAdmin && (
          <button
            style={{ marginRight: "10px" }}
            type="button"
            className="btn-primary upload-btn"
            onClick={openUploadModal}
          >
            + Ladda upp dokument
          </button>
        )}

        <label>Filter:</label>

        <input
          type="text"
          placeholder="Filtrera dokument..."
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          className="doc-filter"
        />
      </div>

      {/* Dokumentlista */}
      <ul>
        {filteredDocuments.map(doc => (
          <li key={doc.id}>

            <img
              src={getIcon(doc.name)}
              alt="document icon"
              className="doc-icon"
              onError={(e) => {
                e.target.onerror = null;
                e.target.src = "/icons/document.png";
              }}
            />

            <span
              className="doc-name"
              onClick={() => openModal(doc)}
            >
              {doc.name}
            </span>

			<div className="document-actions">
			  <a
				href="#" onClick={(e) => { e.preventDefault(); openDocument(doc, true); }}
				download
				className="btn-primary"
			  >
				Ladda ner
			  </a>

			  {isAdmin && (
				<button
				  type="button"
				  className="btn-danger"
				  onClick={() => handleDelete(doc)}
				>
				  Ta bort
				</button>
			  )}
			</div>

          </li>
        ))}

        {filteredDocuments.length === 0 && (
          <li className="no-documents">
            Inga dokument hittades.
          </li>
        )}
      </ul>

      {/* =========================
          Förhandsvisningsmodal
         ========================= */}
      {modalDoc && createPortal(
        <div
          className="modal-overlay"
          onClick={closeModal}
        >
          <div
            className="modal-content"
            onClick={e => e.stopPropagation()}
          >
            <span
              className="close"
              onClick={closeModal}
            >
              ×
            </span>

            {modalDoc.name.match(/\.pdf$/i) ? (
              <iframe
                src={modalDoc.previewUrl}
                title={modalDoc.name}
                width="100%"
                height="1200px"
              />
            ) : modalDoc.name.match(/\.(png|jpg|jpeg)$/i) ? (
              <img
                src={modalDoc.previewUrl}
                alt={modalDoc.name}
              />
            ) : (
              <p>Förhandsvisning ej tillgänglig</p>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* =========================
          Uppladdningsmodal
         ========================= */}
      {uploadModal && createPortal(
        <div
          className="modal-overlay"
          onClick={closeUploadModal}
        >
          <div
            className="modal-content upload-modal"
            onClick={e => e.stopPropagation()}
          >
            <span
              className="close"
              onClick={closeUploadModal}
            >
              ×
            </span>

            <h2>Ladda upp ett dokument</h2>

            <div className="upload-area">

              <label htmlFor="document-upload">
                Välj dokument
              </label>

              <input
                id="document-upload"
                type="file"
                onChange={handleFileChange}
                disabled={uploading}
              />

              {selectedFile && (
                <div className="selected-file">
                  <img
                    src={getIcon(selectedFile.name)}
                    alt=""
                    className="doc-icon"
                  />

                  <span>
                    {selectedFile.name}
                  </span>
                </div>
              )}

              {uploadMsg && (
                <p className="upload-message">
                  {uploadMsg}
                </p>
              )}

              <div className="upload-actions">

                <button
                  type="button"
                  className="btn-secondary"
                  onClick={closeUploadModal}
                  disabled={uploading}
                >
                  Avbryt
                </button>

                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleUpload}
                  disabled={!selectedFile || uploading}
                >
                  {uploading
                    ? "Laddar upp..."
                    : "Ladda upp"}
                </button>

              </div>

            </div>
          </div>
        </div>,
        document.body
      )}

    </div>
  );
}