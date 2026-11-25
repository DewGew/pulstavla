// Matprotokoll.jsx
import React, { useState, useEffect, useMemo } from "react";
import { apiFetch } from "../api";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { useSettings, addPDFHeader, addPDFFooter } from "./SettingsContext";
import { API_URL } from "../config";
import "./Matprotokoll.css";

// Fördefinierad lista över vanliga mätinstrument (kanoniska/sparade värden
// är alltid svenska — engelsk text visas bara i UI:t via MATINSTRUMENT_LABELS_EN)
const MATINSTRUMENT_OPTIONS = [
  "Pinntolk",
  "Tolk",
  "CMM/3D-Taster",
  "Bladmått",
  "Passbit",
  "Annat / Övrigt",
];

const MATINSTRUMENT_LABELS_EN = {
  "Pinntolk": "Pin gauge",
  "Tolk": "Gauge",
  "CMM/3D-Taster": "CMM/3D probe",
  "Bladmått": "Feeler gauge",
  "Passbit": "Gauge block",
  "Annat / Övrigt": "Other",
};

const OPERATION_OPTIONS = [
  "Fräs",
  "Svarv",
  "Slip",
  "Kontrollmätning",
  "Övrigt",
];

const OPERATION_LABELS_EN = {
  "Fräs": "Milling",
  "Svarv": "Turning",
  "Slip": "Grinding",
  "Kontrollmätning": "Inspection measurement",
  "Övrigt": "Other",
};

/* ================= ÖVERSÄTTNINGAR ================= */
const T = {
  sv: {
    title: "Mätprotokoll",
    loadingSettings: "Laddar inställningar…",
    settingsError: "Kunde inte ladda inställningar. Försök ladda om sidan.",
    reload: "⟳ Ladda om",
    ordernr: "Ordernummer",
    ordernrPlaceholder: "Välj eller skriv ordernummer…",
    artikelnummer: "Artikelnummer",
    artikelnummerPlaceholderWithOptions: "Välj eller skriv artikelnummer…",
    artikelnummerPlaceholderNoOptions: "Ange artikelnummer",
    benamning: "Benämning",
    benamningPlaceholder: "Ange benämning",
    ritningsnummer: "Ritningsnummer",
    ritningsnummerPlaceholder: "Ange ritningsnummer",
    kund: "Kund",
    kundPlaceholder: "Ange kundnamn",
    operation: "Operation",
    operationPlaceholder: "Välj eller skriv operation...",
    upprattadAv: "Upprättad av",
    valjAnvandare: "Välj användare…",
    datum: "Datum",
    mätpunkter: "Mätpunkter",
    tableHeaders: [
      "Mätpunkt", "Nominellt mått", "Tolerans",
      "Detalj 1", "Detalj 2", "Detalj 3", "Detalj 4", "Detalj 5",
      "Bedömning", "Mätinstrument", "Kommentar", "",
    ],
    ph: {
      mätpunkt: "t.ex. A1 el. #1",
      dimensionskrav: "t.ex. Ø25",
      plustolerans: "t.ex. +/-0,05",
      resultat: "t.ex. 25,02",
      kommentar: "ange kommentar",
    },
    valjInstrument: "Välj instrument…",
    addMeasurement: "➕ Lägg till mätpunkt",
    newReport: "🆕 Nytt protokoll",
    saveDraft: "💾 Spara utkast",
    saving: "Sparar…",
    openSaved: "📂 Öppna sparat protokoll",
    savePdf: "📄 Spara som PDF",
    filterPlaceholder: "🔍 Filtrera på order- eller artikelnr…",
    sortBy: "Sortera på:",
    sortAsc: "↑ Stigande",
    sortDesc: "↓ Fallande",
    loadingList: "Laddar sparade protokoll…",
    noneSavedAdmin: "Inga sparade mätprotokoll ännu.",
    noneSavedUser: "Du har inga sparade mätprotokoll ännu.",
    noMatch: "Inga protokoll matchar filtret.",
    colOrderArt: "Order / Artikel",
    colBenamning: "Benämning",
    colKund: "Kund",
    colSenast: "Senast sparad",
    colUpprattad: "Upprättad av",
    colPdf: "Utskriven/Sparad som PDF",
    open: "Öppna",
    sure: "Säker?",
    yes: "Ja",
    no: "Nej",
    delete: "🗑 Ta bort",
    fillArtikelnummer: "Fyll i Artikelnummer först",
    fillOrdernr: "Fyll i Ordernummer först",
    fillInstrument: "Välj ett mätinstrument för varje mätpunkt innan du sparar som PDF.",
    draftSaved: "✔️ Mätprotokoll utkast sparat.",
    saveError: "❌ Kunde inte spara mätprotokollet.",
    listError: "❌ Kunde inte hämta sparade mätprotokoll.",
    opened: (id) => `✔️ Öppnade ${id}`,
    openError: "❌ Kunde inte öppna mätprotokollet.",
    deleted: (id) => `🗑️ Tog bort ${id} från databasen.`,
    deleteError: "❌ Kunde inte ta bort mätprotokollet.",
    pdfSaved: "✔️ PDF sparad.",
	dateFrom: "Från datum",
	dateTo: "Till datum",
  },
  en: {
    title: "Measurement Report",
    loadingSettings: "Loading settings…",
    settingsError: "Could not load settings. Please reload the page.",
    reload: "⟳ Reload",
    ordernr: "Order number",
    ordernrPlaceholder: "Select or type order number…",
    artikelnummer: "Article number",
    artikelnummerPlaceholderWithOptions: "Select or type article number…",
    artikelnummerPlaceholderNoOptions: "Enter article number",
    benamning: "Description",
    benamningPlaceholder: "Enter description",
    ritningsnummer: "Drawing number",
    ritningsnummerPlaceholder: "Enter drawing number",
    kund: "Customer",
    kundPlaceholder: "Enter customer name",
    operation: "Operation",
    operationPlaceholder: "Select or type operation...",
    upprattadAv: "Prepared by",
    valjAnvandare: "Select user…",
    datum: "Date",
    mätpunkter: "Measurement points",
    tableHeaders: [
      "Point", "Nominal size", "Tolerance",
      "Piece 1", "Piece 2", "Piece 3", "Piece 4", "Piece 5",
      "Assessment", "Instrument", "Comment", "",
    ],
    ph: {
      mätpunkt: "e.g. A1 or #1",
      dimensionskrav: "e.g. Ø25",
      plustolerans: "e.g. +/-0.05",
      resultat: "e.g. 25.02",
      kommentar: "add comment",
    },
    valjInstrument: "Select instrument…",
    addMeasurement: "➕ Add measurement point",
    newReport: "🆕 New report",
    saveDraft: "💾 Save draft",
    saving: "Saving…",
    openSaved: "📂 Open saved report",
    savePdf: "📄 Save as PDF",
    filterPlaceholder: "🔍 Filter by order or article no…",
    sortBy: "Sort by:",
    sortAsc: "↑ Ascending",
    sortDesc: "↓ Descending",
    loadingList: "Loading saved reports…",
    noneSavedAdmin: "No saved measurement reports yet.",
    noneSavedUser: "You have no saved measurement reports yet.",
    noMatch: "No reports match the filter.",
    colOrderArt: "Order / Article",
    colBenamning: "Description",
    colKund: "Customer",
    colSenast: "Last saved",
    colUpprattad: "Prepared by",
    colPdf: "Printed/Saved as PDF",
    open: "Open",
    sure: "Sure?",
    yes: "Yes",
    no: "No",
    delete: "🗑 Delete",
    fillArtikelnummer: "Please fill in Article number first",
    fillOrdernr: "Please fill in Order number first",
    fillInstrument: "Select a measuring instrument for every measurement point before saving as PDF.",
    draftSaved: "✔️ Measurement report draft saved.",
    saveError: "❌ Could not save the measurement report.",
    listError: "❌ Could not fetch saved measurement reports.",
    opened: (id) => `✔️ Opened ${id}`,
    openError: "❌ Could not open the measurement report.",
    deleted: (id) => `🗑️ Removed ${id} from the database.`,
    deleteError: "❌ Could not remove the measurement report.",
    pdfSaved: "✔️ PDF saved.",
	dateFrom: "From date",
	dateTo: "To date",
  },
};

const emptyForm = (currentUser) => ({
  dokumentnr: "Mätprotokoll",
  revision: "5",
  artikelnummer: "",
  ritningsnummer: "",
  benamning: "",
  kund: "",
  ordernr: "",
  operation: "",
  upprattadAv: currentUser?.name || "",
  datum: new Date().toISOString().split("T")[0],
});

const parseMeasurementNumber = (value) => {
  const match = String(value ?? "").replace(/,/g, ".").match(/[-+]?(?:\d+(?:\.\d*)?|\.\d+)/);
  return match ? Number(match[0]) : null;
};

const parseTolerance = (value) => {
  const raw = String(value ?? "").trim().replace(/,/g, ".");
  if (!raw) return null;

  // Asymmetrisk tolerans skrivs som övre/undre avvikelse,
  // exempelvis +0.05/-0.02 eller -0.10/-0.15.
  const asymmetric = raw.match(/([+-])\s*(\d+(?:\.\d*)?|\.\d+)\s*\/\s*([+-])\s*(\d+(?:\.\d*)?|\.\d+)/);
  if (asymmetric) {
    const upper = Number(asymmetric[2]) * (asymmetric[1] === "-" ? -1 : 1);
    const lower = Number(asymmetric[4]) * (asymmetric[3] === "-" ? -1 : 1);
    return { upper, lower };
  }

  const symmetric = raw.match(/(?:±|\+\/\-|\+\-)\s*(\d+(?:\.\d*)?|\.\d+)/);
  if (symmetric) return { upper: Number(symmetric[1]), lower: -Number(symmetric[1]) };
  const plain = raw.match(/^\d+(?:\.\d*)?$/);
  if (plain) return { upper: Number(plain[0]), lower: -Number(plain[0]) };
  return null;
};

const isGaugeTolerance = (value) => /tolk/i.test(String(value ?? "").trim());

// ISO 286-1/-2: publicerade IT6–IT9-tabellvärden i µm.
// Stöder H6–H9 för hål och h6–h9 för axlar (1–500 mm).
const getISO286Tolerance = (nominal, designation) => {
  const match = String(designation ?? "").trim().match(/^([Hh])([6-9])$/);
  if (!match || !Number.isFinite(nominal) || nominal <= 0 || nominal > 500) return null;

  const ranges = [
    [0, 3, 6, 10, 14, 25],
    [3, 6, 8, 12, 18, 30],
    [6, 10, 9, 15, 22, 36],
    [10, 18, 11, 18, 27, 43],
    [18, 30, 13, 21, 33, 52],
    [30, 50, 16, 25, 39, 62],    [50, 80, 19, 30, 46, 74],
    [80, 120, 22, 35, 54, 87],
    [120, 180, 25, 40, 63, 100],
    [180, 250, 29, 46, 72, 115],
    [250, 315, 32, 52, 81, 130],
    [315, 400, 36, 57, 89, 140],
    [400, 500, 40, 63, 97, 155],
  ];
  const range = ranges.find(([min, max]) => nominal > min && nominal <= max);
  if (!range) return null;

  const grade = Number(match[2]);
  const tolerance = range[grade - 4] / 1000;
  return match[1] === "H"
    ? { upper: tolerance, lower: 0 }
    : { upper: 0, lower: -tolerance };
};

// ISO 2768-1, klass m (medium): allmänna toleranser för linjära mått i mm.
const getISO2768mTolerance = (nominal) => {
  if (!Number.isFinite(nominal) || nominal < 0.5 || nominal > 4000) return null;
  const ranges = [
    [0.5, 3, 0.1],
    [3, 6, 0.1],
    [6, 30, 0.2],
    [30, 120, 0.3],
    [120, 400, 0.5],
    [400, 1000, 0.8],
    [1000, 2000, 1.2],
    [2000, 4000, 2.0],
  ];
  const range = ranges.find(([min, max]) => nominal > min && nominal <= max);
  if (!range) return null;
  return { upper: range[2], lower: -range[2] };
};

const getRowTolerance = (row) => {
  const nominal = parseMeasurementNumber(row.dimensionskrav);
  if (nominal === null) return null;
  const enteredTolerance = String(row.plustolerans ?? "").trim();
  return getISO286Tolerance(nominal, enteredTolerance)
    || parseTolerance(enteredTolerance)
    || (!enteredTolerance ? getISO2768mTolerance(nominal) : null);
};

const formatToleranceLimits = (row) => {
  const nominal = parseMeasurementNumber(row.dimensionskrav);
  const enteredTolerance = String(row.plustolerans ?? "").trim();
  const iso286 = getISO286Tolerance(nominal, enteredTolerance);
  const tolerance = iso286 || (!enteredTolerance ? getISO2768mTolerance(nominal) : null);
  if (!tolerance) return "";
  const lower = nominal + tolerance.lower;
  const upper = nominal + tolerance.upper;
  const standard = iso286 ? "ISO 286" : "ISO 2768-m";
  return `${standard}: ${lower.toFixed(3).replace(".", ",")}–${upper.toFixed(3).replace(".", ",")} mm`;
};

const getMeasurementStatus = (row, field) => {
  if (isGaugeTolerance(row.plustolerans)) {
    if (!row[field]) return null;
    return row[field] === "OK" ? "Godkänd" : row[field] === "Ej OK" ? "Underkänd" : null;
  }
  const nominal = parseMeasurementNumber(row.dimensionskrav);
  const tolerance = getRowTolerance(row);
  const measured = parseMeasurementNumber(row[field]);
  if (nominal === null || !tolerance || measured === null) return null;
  const lowerLimit = nominal + tolerance.lower;
  const upperLimit = nominal + tolerance.upper;
  return measured >= Math.min(lowerLimit, upperLimit) && measured <= Math.max(lowerLimit, upperLimit)
    ? "Godkänd"
    : "Underkänd";
};

const emptyMeasurement = (nr = 1) => ({
  mätpunkt: String(nr),
  dimensionskrav: "",
  plustolerans: "",
  resultat_1: "",
  resultat_2: "",
  resultat_3: "",
  resultat_4: "",
  resultat_5: "",
  matinstrument: "",
  kommentar: "",
  matinstrumentId: "",
  matinstrumentSnapshot: null,
});

export default function Matprotokoll() {
  const [Msg, setMsg] = useState(null);
  const [lang, setLang] = useState("sv");
  const t = T[lang];
  const { settings, loading } = useSettings();

  const currentUser = (() => {
    try {
      return JSON.parse(localStorage.getItem("user") || "{}");
    } catch {
      return {};
    }
  })();

  const canEdit =
    currentUser.role === "admin" || currentUser.role === "suAdmin";

  const [form, setForm] = useState(() => emptyForm(currentUser));
  const [measurements, setMeasurements] = useState([emptyMeasurement()]);
  const [activeRecordId, setActiveRecordId] = useState(null);
  const [measuringTools, setMeasuringTools] = useState([]);

  /* ---------------- ANVÄNDARLISTA (för "Upprättad av") ---------------- */
  const [users, setUsers] = useState([]);

  useEffect(() => {
    apiFetch(`/presence/users`, {
      headers: localStorage.getItem("token")
        ? { Authorization: `Bearer ${localStorage.getItem("token")}` }
        : {},
    })
      .then((res) => res.json())
      .then((data) => setUsers(Array.isArray(data) ? data : []))
      .catch(() => {
        // Tyst: om listan inte går att hämta faller fältet tillbaka på
        // det sparade värdet (se fallback-option nedan) istället för
        // att blockera hela formuläret.
      });
  }, []);

  useEffect(() => {
    apiFetch("/measuring-tools", {
      headers: localStorage.getItem("token")
        ? { Authorization: `Bearer ${localStorage.getItem("token")}` }
        : {},
    })
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        const currentUserId = currentUser?._id;
        setMeasuringTools(
          Array.isArray(data) && currentUserId
            ? data.filter((tool) => tool.reservation?.userId === currentUserId || tool.activeLoan?.borrowerId === currentUserId)
            : []
        );
      })
      .catch(() => setMeasuringTools([]));
  }, []);

  const updateForm = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const updateMeasurement = (index, field, value) => {
    setMeasurements((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [field]: value } : row))
    );
  };

  const addMeasurement = () => {
    setMeasurements((prev) => [...prev, emptyMeasurement(prev.length + 1)]);
  };

  const removeMeasurement = (index) => {
    if (measurements.length === 1) return;
    setMeasurements((prev) => prev.filter((_, i) => i !== index));
  };

  const clearForm = () => {
    setForm(emptyForm(currentUser));
    setMeasurements([emptyMeasurement()]);
    setActiveRecordId(null);
  };

  /* ---------------- SPARA / ÖPPNA (NeDB) ---------------- */
  const getRecordId = () => activeRecordId || (globalThis.crypto?.randomUUID?.() || `mp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

  const [isSavingDb, setIsSavingDb] = useState(false);
  const [savedList, setSavedList] = useState([]);
  const [showOpenPanel, setShowOpenPanel] = useState(false);
  const [openListLoading, setOpenListLoading] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [openFilter, setOpenFilter] = useState("");
  const [openSortBy, setOpenSortBy] = useState("ordernr"); // "ordernr" | "artikelnummer"
  const [openSortDir, setOpenSortDir] = useState("asc");   // "asc" | "desc"
  const [openDateFrom, setOpenDateFrom] = useState("");    // "YYYY-MM-DD" eller ""
  const [openDateTo, setOpenDateTo] = useState("");        // "YYYY-MM-DD" eller ""

  const validateRequired = () => {
    if (!form.artikelnummer.trim()) {
      setMsg({ type: "error", text: t.fillArtikelnummer });
      return false;
    }
    if (!form.ordernr.trim()) {
      setMsg({ type: "error", text: t.fillOrdernr });
      return false;
    }
    return true;
  };

  const saveToDb = async ({ silent = false, pdfSaved = false, matprotokollId = null } = {}) => {
    if (!validateRequired()) return false;

    const token = localStorage.getItem("token");
    const id = matprotokollId || getRecordId();
    if (!activeRecordId) setActiveRecordId(id);

    setIsSavingDb(true);
    try {
      const res = await apiFetch(`/matprotokoll/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ form, measurements, pdfSaved }),
      });

      if (!res.ok) throw new Error();

      if (!silent) {
        setMsg({ type: "success", text: t.draftSaved });
      }
      return true;
    } catch {
      setMsg({ type: "error", text: t.saveError });
      return false;
    } finally {
      setIsSavingDb(false);
    }
  };

  const loadSavedList = async () => {
    setOpenListLoading(true);
    try {
      const res = await apiFetch(`/matprotokoll`, {
        headers: localStorage.getItem("token")
          ? { Authorization: `Bearer ${localStorage.getItem("token")}` }
          : {},
      });
      if (!res.ok) throw new Error();
      const data = await res.json();

      // Admin/suAdmin ser alla sparade protokoll — övriga ser bara sina
      // egna (baserat på vem som står som "Upprättad av").
      const visible = canEdit
        ? data
        : data.filter(
            (doc) =>
              doc.form?.upprattadAv === currentUser?.name &&
              doc.pdfSaved === false
          );
      setSavedList(visible);
    } catch {
      setMsg({ type: "error", text: t.listError });
    } finally {
      setOpenListLoading(false);
    }
  };

  const openPanel = () => {
    setShowOpenPanel((v) => {
      const next = !v;
      if (next) loadSavedList();
      return next;
    });
  };

  const openSaved = async (matprotokollId) => {
    try {
      const res = await apiFetch(`/matprotokoll/${encodeURIComponent(matprotokollId)}`, {
        headers: localStorage.getItem("token")
          ? { Authorization: `Bearer ${localStorage.getItem("token")}` }
          : {},
      });
      if (!res.ok) throw new Error();
      const doc = await res.json();

      setForm(doc.form);
      setMeasurements(doc.measurements?.length ? doc.measurements : [emptyMeasurement()]);
      setActiveRecordId(doc.matprotokollId);
      setShowOpenPanel(false);
      setMsg({ type: "success", text: t.opened(matprotokollId) });
    } catch {
      setMsg({ type: "error", text: t.openError });
    }
  };

  const deleteSaved = async (matprotokollId) => {
    const token = localStorage.getItem("token");

    setIsDeleting(true);
    try {
      const res = await apiFetch(`/matprotokoll/${encodeURIComponent(matprotokollId)}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!res.ok) throw new Error();

      setSavedList((prev) => prev.filter((d) => d.matprotokollId !== matprotokollId));
      setConfirmDeleteId(null);
      setMsg({ type: "success", text: t.deleted(matprotokollId) });
    } catch {
      setMsg({ type: "error", text: t.deleteError });
    } finally {
      setIsDeleting(false);
    }
  };

  const savePDF = async () => {
    if (!validateRequired()) return;

    const missingInstrumentIndex = measurements.findIndex(
      (row) => !String(row.matinstrumentId || row.matinstrument || "").trim()
    );
    if (missingInstrumentIndex !== -1) {
      setMsg({
        type: "error",
        text: `${t.fillInstrument} (${lang === "sv" ? "Mätpunkt" : "Measurement point"} ${missingInstrumentIndex + 1})`,
      });
      return;
    }

    const recordId = getRecordId();
    setActiveRecordId(recordId);
    const doc = new jsPDF({
      orientation: "landscape",
      unit: "mm",
      format: "A4",
    });

    const pageWidth = doc.internal.pageSize.getWidth();

    /* ---------------- HEADER ---------------- */
    addPDFHeader(doc, "Mätprotokoll", settings);

    doc.setFontSize(8);
    doc.text(`Dokument: Mätprotokoll`, pageWidth - 15, 22, { align: "right" });
    doc.text(`Rev: ${form.revision || "5"}`, pageWidth - 15, 27, { align: "right" });

    /* ---------------- INFORMATION ---------------- */
    autoTable(doc, {
      startY: 32,
      theme: "grid",
      styles: { fontSize: 8, cellPadding: 2, valign: "middle" },
      columnStyles: {
        0: { fontStyle: "bold", cellWidth: 32 },
        1: { cellWidth: 50 },
        2: { fontStyle: "bold", cellWidth: 32 },
        3: { cellWidth: 50 },
        4: { fontStyle: "bold", cellWidth: 32 },
      },
      body: [
        [
          "Ordernummer", form.ordernr || "-",
          "Kund", form.kund || "-",
          "Datum", form.datum || "-",
        ],
        [
          "Artikelnummer", form.artikelnummer || "-",
          "Benämning", form.benamning || "-",
          "Upprättad av", form.upprattadAv || "-",
        ],
        [
          "Ritningsnummer", form.ritningsnummer || "-",
          "", "",
          "Operation", form.operation || "-",
        ],
      ],
    });

    /* ---------------- MEASUREMENTS ---------------- */
    const startY = (doc.lastAutoTable?.finalY || 50) + 8;

    const rows = measurements.map((row) => [
      row.mätpunkt || "",
      row.dimensionskrav || "",
      [row.plustolerans, formatToleranceLimits(row)].filter(Boolean).join("\n"),
      row.resultat_1 || "",
      row.resultat_2 || "",
      row.resultat_3 || "",
      row.resultat_4 || "",
      row.resultat_5 || "",
      ["resultat_1", "resultat_2", "resultat_3", "resultat_4", "resultat_5"]
        .map((field, i) => row[field] ? `D${i + 1}: ${getMeasurementStatus(row, field) || "Ej bedömd"}` : "")
        .filter(Boolean).join("\n") || "Ej bedömd",
      [row.matinstrument, row.matinstrumentSnapshot?.lastControlDate ? `Senast kontroll: ${row.matinstrumentSnapshot.lastControlDate}` : "", row.matinstrumentSnapshot?.controlBlocked ? "SPÄRRAT VID VAL" : ""]
        .filter(Boolean).join("\n"),
      row.kommentar || "",
    ]);

    autoTable(doc, {
      startY,
      theme: "grid",
      head: [[
        "Mätpunkt", "Nominellt mått", "Tolerans",
        "Detalj 1", "Detalj 2", "Detalj 3", "Detalj 4", "Detalj 5",
        "Bedömning", "Mätinstrument", "Kommentar",
      ]],
      body: rows,
      styles: { fontSize: 8, cellPadding: 2, valign: "middle" },
      headStyles: {
        fontStyle: "bold",
        halign: "center",
        fillColor: [158, 6, 6],
        textColor: 255,
      },
      columnStyles: {
        0: { cellWidth: 20 }, 1: { cellWidth: 20 }, 2: { cellWidth: 20 },
        3: { cellWidth: 20 }, 4: { cellWidth: 20 }, 5: { cellWidth: 20 },
        6: { cellWidth: 18 }, 7: { cellWidth: 18 }, 8: { cellWidth: 28 },
        9: { cellWidth: 32 }, 10: { cellWidth: "auto", minCellWidth: 35 },
      },
      didDrawPage: () => {
        addPDFFooter(doc, settings);
      },
    });

    /* ---------------- SIGNATUR ---------------- */
    const pageHeight = doc.internal.pageSize.getHeight();
    let sigY = (doc.lastAutoTable?.finalY || startY) + 15;

    if (sigY > pageHeight - 25) {
      doc.addPage();
      addPDFFooter(doc, settings);
      sigY = 25;
    }

    doc.setFontSize(9);
    doc.setTextColor(0, 0, 0);

    doc.text("Sign: _________________________", 15, sigY);
    doc.text("Datum: ________________________", pageWidth - 15, sigY, {
      align: "right",
    });

    /* ---------------- SAVE ---------------- */
    const fileName =
      `${form.ordernr}_${form.artikelnummer}_${form.operation}_${recordId.slice(-8)}` ||
      form.dokumentnr ||
      "mätprotokoll";

    doc.save(`${fileName}_mätprotokoll.pdf`);

    const saved = await saveToDb({ silent: true, pdfSaved: true, matprotokollId: recordId });
    if (saved) {
      setMsg({ type: "success", text: t.pdfSaved });

      setSavedList((prev) => {
        const id = recordId;
        const updated = {
          matprotokollId: id,
          form,
          measurements,
          pdfSaved: true,
          updatedAt: new Date().toISOString(),
          updatedBy: currentUser?.name || "",
        };

        const exists = prev.some((d) => d.matprotokollId === id);
        return exists
          ? prev.map((d) => (d.matprotokollId === id ? { ...d, ...updated } : d))
          : [...prev, updated];
      });
    }
  };

  if (loading) return <p style={{ padding: "20px" }}>{t.loadingSettings}</p>;
  if (!settings)
    return (
      <p style={{ padding: "20px", color: "red", display: "flex", alignItems: "center", gap: "10px" }}>
        {t.settingsError}
        <button
          type="button"
          className="btn-secondary"
          onClick={() => window.location.reload()}
          title={t.reload}
        >
          {t.reload}
        </button>
      </p>
    );

	const filteredSortedList = savedList
	  .filter((doc) => {
		const term = openFilter.trim().toLowerCase();
		const matchesTerm =
		  !term ||
		  (doc.form?.ordernr || "").toLowerCase().includes(term) ||
		  (doc.form?.artikelnummer || "").toLowerCase().includes(term);

		if (!matchesTerm) return false;

		// Datumfilter på "Senast sparad" (updatedAt), jämfört dag för dag
		if (openDateFrom || openDateTo) {
		  if (!doc.updatedAt) return false;

		  const docDate = new Date(doc.updatedAt);
		  const docDay = new Date(
			docDate.getFullYear(),
			docDate.getMonth(),
			docDate.getDate()
		  );

		  if (openDateFrom) {
			const from = new Date(openDateFrom);
			if (docDay < from) return false;
		  }

		  if (openDateTo) {
			const to = new Date(openDateTo);			if (docDay > to) return false;
		  }
		}

		return true;
	  })
	  .sort((a, b) => {
		const dir = openSortDir === "asc" ? 1 : -1;
		const aVal =
		  openSortBy === "ordernr" ? a.form?.ordernr || "" : a.form?.artikelnummer || "";
		const bVal =
		  openSortBy === "ordernr" ? b.form?.ordernr || "" : b.form?.artikelnummer || "";

		return dir * aVal.localeCompare(bVal, "sv", { numeric: true, sensitivity: "base" });
	  });

  /* ---------------- PRODUKTIONSORDRAR (för "Ordernummer") ---------------- */
  const [productionOrders, setProductionOrders] = useState([]);

  useEffect(() => {
    apiFetch(`/production-orders`, {
      headers: localStorage.getItem("token")
        ? { Authorization: `Bearer ${localStorage.getItem("token")}` }
        : {},
    })
      .then((res) => res.json())
      .then((data) => setProductionOrders(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  const uniqueProductionOrders = useMemo(() => {
    const map = new Map();
    productionOrders.forEach((o) => {
      if (!o.Ordernr || map.has(o.Ordernr)) return;
      map.set(o.Ordernr, o);
    });
    return Array.from(map.values()).sort((a, b) =>
      String(a.Ordernr).localeCompare(String(b.Ordernr), "sv", { numeric: true })
    );
  }, [productionOrders]);

  const articlesForSelectedOrder = useMemo(() => {
    if (!form.ordernr.trim()) return [];

    const map = new Map();
    productionOrders
      .filter((o) => String(o.Ordernr) === form.ordernr)
      .forEach((o) => {
        if (!o.Artikelnr || map.has(o.Artikelnr)) return;
        map.set(o.Artikelnr, o);
      });

    return Array.from(map.values()).sort((a, b) =>
      String(a.Artikelnr).localeCompare(String(b.Artikelnr), "sv", { numeric: true })
    );
  }, [productionOrders, form.ordernr]);

  return (
    <div className="mätprotokoll-container" style={{ margin: "0 auto", padding: "20px" }}>
      <h2>{t.title}</h2>

      <div className="mätprotokoll-info-text">
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "8px" }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setLang((prev) => (prev === "sv" ? "en" : "sv"))}
          >
            {lang === "sv" ? "🇬🇧 English" : "🇸🇪 Svenska"}
          </button>
        </div>

		{lang === "sv" ? (
		  <p>
			Här kan du skapa mätprotokoll. Börja med att välja <strong>Ordernummer</strong> — antingen genom att välja ett förslag ur listan (hämtas från tillverkningsordrarna) eller skriva in det manuellt.<br></br>När ett ordernummer är valt filtreras <strong>Artikelnummer</strong>-fältets förslag till artiklarna på just den ordern; väljer du en artikel fylls Benämning och Kund i automatiskt om de är tomma.<br></br>
			När alla värden är ifyllda, klicka på Spara som PDF. Klicka på Spara utkast för att spara pågående mätning till senare. När du klickar på Spara som PDF tas protokollet bort från listan.<br></br>
			Välj var PDF-filen ska sparas, t.ex. <i>V:\Mätprotokoll\K12324</i> och kontrollera dokumentet innan det arkiveras.<br></br>
			Ska fler än 5 detaljer dokumenteras. Skapa nytt mätprotokoll med prefix på ordernumret t.ex. <i>K12345-2, K12345-3</i> osv.<br></br>
			<i>I listan för registrerade mätverktyg, kan du endast välja dina personligt reserverade eller lånade mätverkyg. För att låna mätverktyg gå till Mätverktyg.</i> 
		  </p>
		) : (
		  <p>
			Here you can create a measurement report. Start by selecting an <strong>Order number</strong> — either by choosing a suggestion from the list (pulled from the production orders) or by typing it manually.<br></br>Once an order number is selected, the <strong>Article number</strong> field's suggestions are filtered to the articles on that order; selecting an article automatically fills in Description and Customer if they are empty.<br></br>
			When all values are filled in, click Save as PDF. Click Save draft to save the current measurement for later. When you click Save as PDF the protocol removes from the list<br></br>
			Choose where the PDF file should be saved, e.g. <i>V:\Mätprotokoll\K12324</i> and check the document before archiving.<br></br>
			If more than 5 details are to be documented, create a new measurement report with a prefix of the order number, e.g. <i>K12345-2, K12345-3</i> etc.<br></br>
			<i>In the list of registered measuring tools, you can only select measuring tools that are personally reserved for you or that you have borrowed. To borrow measuring tools, go to Measuring Tools.</i>
		  </p>
		)}
      </div>

      {/* ---------------- DOCUMENT INFO ---------------- */}
      <div
        className="mätprotokoll-info"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "12px",
          marginBottom: "25px",
        }}
      >
        <div className="mätprotokoll-field">
          <label>
            {t.ordernr}
            <input
              type="text"
              list="ordernr-options"
              value={form.ordernr}
              placeholder={t.ordernrPlaceholder}
              onChange={(e) => updateForm("ordernr", e.target.value)}
            />
            <datalist id="ordernr-options">
              {uniqueProductionOrders.map((o) => (
                <option key={o.Ordernr} value={o.Ordernr}>
                  {o.Kundnamn ? `${o.Kundnamn}` : o.Ordernr}
                </option>
              ))}
            </datalist>
          </label>
        </div>

		<div className="mätprotokoll-field">
		  <label>
			{t.artikelnummer}
			<input
			  type="text"
			  list="artikelnummer-options"
			  value={form.artikelnummer}
			  placeholder={
				articlesForSelectedOrder.length > 0
				  ? t.artikelnummerPlaceholderWithOptions
				  : t.artikelnummerPlaceholderNoOptions
			  }
			  onChange={(e) => {
				const value = e.target.value;
				const match = articlesForSelectedOrder.find(
				  (o) => String(o.Artikelnr) === value
				);

				setForm((prev) => ({
				  ...prev,
				  artikelnummer: value,
				  // Fyll i Benämning och Kund automatiskt vid val från listan,
				  // men skriv inte över dem om användaren redan fyllt i manuellt.
				  benamning:
					match && !prev.benamning
					  ? match.Benämning || prev.benamning
					  : prev.benamning,
				  kund:
					match && !prev.kund
					  ? match.Kundnamn || prev.kund
					  : prev.kund,
				}));
			  }}
			/>
			<datalist id="artikelnummer-options">
			  {articlesForSelectedOrder.map((o) => (
				<option key={o.Artikelnr} value={o.Artikelnr}>
				  {o.Benämning ? `${o.Benämning}` : o.Artikelnr}
				</option>
			  ))}
			</datalist>
		  </label>
		</div>

        <div className="mätprotokoll-field">
          <label>
            {t.benamning}
            <input
              type="text"
              value={form.benamning}
              placeholder={t.benamningPlaceholder}
              onChange={(e) => updateForm("benamning", e.target.value)}
            />
          </label>
        </div>

        <div className="mätprotokoll-field">
          <label>
            {t.ritningsnummer}
            <input
              type="text"
              value={form.ritningsnummer}
              placeholder={t.ritningsnummerPlaceholder}
              onChange={(e) => updateForm("ritningsnummer", e.target.value)}
            />
          </label>
        </div>

        <div className="mätprotokoll-field">
          <label>
            {t.kund}
            <input
              type="text"
              value={form.kund}
              placeholder={t.kundPlaceholder}
              onChange={(e) => updateForm("kund", e.target.value)}
            />
          </label>
        </div>

        <div className="mätprotokoll-field">
          <label>
            {t.operation}
            <input
              list="operationer"
              value={form.operation}
              onChange={(e) => updateForm("operation", e.target.value)}
              placeholder={t.operationPlaceholder}
            />
            {/* Sparat värde är alltid det svenska originalet (canonical) */}
            <datalist id="operationer">
              {OPERATION_OPTIONS.map((op) => (
                <option key={op} value={op}>
                  {lang === "en" ? OPERATION_LABELS_EN[op] : op}
                </option>
              ))}
            </datalist>
          </label>
        </div>

        <div className="mätprotokoll-field">
          <label>
            {t.upprattadAv}
            <select
              disabled={!canEdit}
              value={form.upprattadAv}
              onChange={(e) => updateForm("upprattadAv", e.target.value)}
            >
              <option value="">{t.valjAnvandare}</option>
              {users
                .slice()
                .sort((a, b) => (a.name || "").localeCompare(b.name || "", "sv"))
                .map((u) => (
                  <option key={u._id} value={u.name}>
                    {u.name}
                  </option>
                ))}
              {form.upprattadAv &&
                !users.some((u) => u.name === form.upprattadAv) && (
                  <option value={form.upprattadAv}>{form.upprattadAv}</option>
                )}
            </select>
          </label>
        </div>

        <div className="mätprotokoll-field">
          <label>
            {t.datum}
            <input
              type="date"
              value={form.datum}
              onChange={(e) => updateForm("datum", e.target.value)}
            />
          </label>
        </div>
      </div>

      {Msg && (
        <div
          style={{
            padding: "8px 12px",
            borderRadius: "6px",
            marginBottom: "10px",
            background: Msg.type === "success" ? "#dcfce7" : "#fee2e2",
            color: Msg.type === "success" ? "#15803d" : "#b91c1c",
          }}
        >
          {Msg.text}
          <button style={{ marginLeft: "10px", cursor: "pointer" }} onClick={() => setMsg(null)}>
            ✕
          </button>
        </div>
      )}

      {/* ---------------- MEASUREMENTS ---------------- */}
      <h3>{t.mätpunkter}</h3>
      <div className="mätprotokoll-hint">{lang === "sv" ? "Om toleransfältet lämnas tomt används ISO 2768-m automatiskt för linjära mått 0,5–4000 mm. Ange egen numerisk tolerans, t.ex. ±0,05 eller +0,10/-0,05, om ritningen anger en sådan. För ISO 286, ange H6–H9 (hål) eller h6–h9 (axel), t.ex. nominellt Ø20 och tolerans H7. För tolk: skriv ”tolk” och välj OK/Ej OK." : "If the tolerance field is left blank, ISO 2768-m is applied automatically to linear dimensions from 0.5 to 4000 mm. Enter a numerical tolerance, e.g. ±0.05 or +0.10/-0.05, when the drawing specifies one. For ISO 286, enter H6–H9 (hole) or h6–h9 (shaft), e.g. nominal Ø20 and tolerance H7. For inspection using a thread gauge, pin gauge or other gauge: enter “tolk” in the tolerance field and select OK/Not OK for each part."}</div>

      <div className="mätprotokoll-table-wrapper" style={{ overflowX: "auto", marginBottom: "15px" }}>
        <table
          className="mätprotokoll-table"
          style={{ width: "100%", borderCollapse: "collapse", minWidth: "1350px" }}
        >
          <thead>
            <tr>
              {t.tableHeaders.map((header, i) => (
                <th key={`${header}-${i}`} style={{ padding: "8px", textAlign: "left" }}>
                  {header}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {measurements.map((row, index) => (
              <tr key={index}>
                {[
                  ["mätpunkt", t.ph.mätpunkt],
                  ["dimensionskrav", t.ph.dimensionskrav],
                  ["plustolerans", t.ph.plustolerans],
                  ["resultat_1", t.ph.resultat],
                  ["resultat_2", t.ph.resultat],
                  ["resultat_3", t.ph.resultat],
                  ["resultat_4", t.ph.resultat],
                  ["resultat_5", t.ph.resultat],
                ].map(([field, placeholder]) => (
                  <td key={field} style={{ padding: "4px" }}>
                    {field.startsWith("resultat_") && isGaugeTolerance(row.plustolerans) ? (
                      <select
                        value={row[field]}
                        onChange={(e) => updateMeasurement(index, field, e.target.value)}
                        style={{ width: "100%", boxSizing: "border-box" }}
                      >
                        <option value="">—</option>
                        <option value="OK">OK</option>
                        <option value="Ej OK">Ej OK</option>
                      </select>
                    ) : (
                      <>
                        <input
                          type="text"
                          value={row[field]}
                          placeholder={placeholder}
                          onChange={(e) => updateMeasurement(index, field, e.target.value)}
                          style={{ width: "100%", boxSizing: "border-box" }}
                        />
                        {field === "plustolerans" && formatToleranceLimits(row) && (
                          <div style={{ fontSize: "0.75rem", marginTop: "3px", color: "var(--text)", whiteSpace: "nowrap" }}>
                            {formatToleranceLimits(row)}
                          </div>
                        )}
                      </>
                    )}
                  </td>
                ))}

                <td style={{ padding: "4px", minWidth: "110px" }}>
                  {["resultat_1", "resultat_2", "resultat_3", "resultat_4", "resultat_5"].map((field, i) => {
                    if (!row[field]) return null;
                    const status = getMeasurementStatus(row, field);
                    return (
                      <div key={field} style={{ whiteSpace: "nowrap", fontWeight: 600, color: status === "Godkänd" ? "#15803d" : status === "Underkänd" ? "#b91c1c" : "var(--text)" }}>
                        D{i + 1}: {status || "Ej bedömd"}
                      </div>
                    );
                  })}
                </td>

                {/* Mätinstrument - dropdown. Sparat värde alltid svenskt,
                    visad text översätts. */}
                <td style={{ padding: "4px" }}>
                  <select
                    value={row.matinstrumentId || row.matinstrument}
                    onChange={(e) => {
                      const selectedTool = measuringTools.find((tool) => tool._id === e.target.value);
                      if (selectedTool) {
                        setMeasurements((prev) => prev.map((item, i) => i === index ? {
                          ...item,
                          matinstrumentId: selectedTool._id,
                          matinstrument: `${selectedTool.toolNumber} – ${selectedTool.type}`,
                          matinstrumentSnapshot: {
                            toolNumber: selectedTool.toolNumber,
                            type: selectedTool.type,
                            lastControlDate: selectedTool.lastControlDate || "",
                            controlBlocked: Boolean(selectedTool.controlBlocked),
                          },
                        } : item));
                      } else {
                        updateMeasurement(index, "matinstrument", e.target.value);
                        updateMeasurement(index, "matinstrumentId", "");
                        updateMeasurement(index, "matinstrumentSnapshot", null);
                      }
                    }}
                    style={{ width: "100%", boxSizing: "border-box" }}
                  >
                    <option value="">{t.valjInstrument}</option>
                    {row.matinstrumentId && !measuringTools.some((tool) => tool._id === row.matinstrumentId) && (
                      <option value={row.matinstrumentId}>
                        {(row.matinstrumentSnapshot?.toolNumber && row.matinstrumentSnapshot?.type)
                          ? row.matinstrumentSnapshot.toolNumber + " – " + row.matinstrumentSnapshot.type
                          : row.matinstrument || (lang === "sv" ? "Sparat mätinstrument" : "Saved measuring instrument")}
                        {lang === "sv" ? " (inte i din instrumentlista)" : " (not in your instrument list)"}
                      </option>
                    )}
                    <optgroup label={lang === "sv" ? "Registrerade mätverktyg" : "Registered measuring tools"}>
                      {measuringTools.map((tool) => (
                        <option key={tool._id} value={tool._id}>
                          {tool.toolNumber} – {tool.type}{tool.controlBlocked ? (lang === "sv" ? " (spärrat)" : " (blocked)") : ""}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label={lang === "sv" ? "Instrumenttyp / manuellt" : "Instrument type / manual"}>
                    {MATINSTRUMENT_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {lang === "en" ? MATINSTRUMENT_LABELS_EN[opt] || opt : opt}
                      </option>
                    ))}
                    </optgroup>
                  </select>
                </td>

                <td style={{ padding: "4px", minWidth: "220px" }}>
                  <textarea
                    value={row.kommentar}
                    placeholder={t.ph.kommentar}
                    rows={2}
                    onChange={(e) => updateMeasurement(index, "kommentar", e.target.value)}
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      resize: "vertical",
                      fontFamily: "inherit",
                      fontSize: "inherit",
                      padding: "4px",
                    }}
                  />
                </td>

                <td style={{ padding: "4px", textAlign: "center" }}>
                  <button
                    className="btn-danger"
                    type="button"
                    onClick={() => removeMeasurement(index)}
                    disabled={measurements.length === 1}
                  >
                    X
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ---------------- BUTTONS ---------------- */}
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
        <button className="btn-secondary" onClick={addMeasurement}>
          {t.addMeasurement}
        </button>

        <button className="btn-primary" onClick={saveToDb} disabled={isSavingDb}>
          {isSavingDb ? t.saving : t.saveDraft}
        </button>

        <button className="btn-secondary" onClick={openPanel}>
          {t.openSaved}
        </button>

        <button className="btn-primary" onClick={savePDF}>
          {t.savePdf}
        </button>

        <button className="btn-secondary" onClick={clearForm}>
          {t.newReport}
        </button>
      </div>

      {/* ---------------- ÖPPNA SPARAT PROTOKOLL ---------------- */}
      {showOpenPanel && (
        <div className="mätprotokoll-openpanel">
			<div className="mätprotokoll-openpanel-filter">
			  <input
				type="text"
				placeholder={t.filterPlaceholder}
				value={openFilter}
				onChange={(e) => setOpenFilter(e.target.value)}
			  />

			  <label className="mätprotokoll-openpanel-sort">
				{t.dateFrom}
				<input
				  type="date"
				  value={openDateFrom}
				  onChange={(e) => setOpenDateFrom(e.target.value)}
				/>
			  </label>

			  <label className="mätprotokoll-openpanel-sort">
				{t.dateTo}
				<input
				  type="date"
				  value={openDateTo}
				  onChange={(e) => setOpenDateTo(e.target.value)}
				/>
			  </label>

			  <label className="mätprotokoll-openpanel-sort">
				{t.sortBy}
				<select value={openSortBy} onChange={(e) => setOpenSortBy(e.target.value)}>
				  <option value="ordernr">{t.ordernr}</option>
				  <option value="artikelnummer">{t.artikelnummer}</option>
				</select>
			  </label>

			  <button
				type="button"
				className="sortdir"
				onClick={() => setOpenSortDir((d) => (d === "asc" ? "desc" : "asc"))}
				title="Byt sorteringsordning"
			  >
				{openSortDir === "asc" ? t.sortAsc : t.sortDesc}
			  </button>
			</div>

          {openListLoading ? (
            <p>{t.loadingList}</p>
          ) : savedList.length === 0 ? (
            <p>{canEdit ? t.noneSavedAdmin : t.noneSavedUser}</p>
          ) : filteredSortedList.length === 0 ? (
            <p className="mätprotokoll-openpanel-empty">{t.noMatch}</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ color: "var(--header-text)", textAlign: "left", padding: "6px" }}>{t.colOrderArt}</th>
                  <th style={{ color: "var(--header-text)", textAlign: "left", padding: "6px" }}>{t.colBenamning}</th>
                  <th style={{ color: "var(--header-text)", textAlign: "left", padding: "6px" }}>{t.colKund}</th>
                  <th style={{ color: "var(--header-text)", textAlign: "left", padding: "6px" }}>{t.colSenast}</th>
                  <th style={{ color: "var(--header-text)", textAlign: "left", padding: "6px" }}>{t.colUpprattad}</th>
                  <th style={{ color: "var(--header-text)", textAlign: "left", padding: "6px" }}>{t.colPdf}</th>
                  <th style={{ padding: "6px" }}></th>
                </tr>
              </thead>
              <tbody>
                {filteredSortedList.map((doc) => (
                  <tr key={doc.matprotokollId}>
                    <td style={{ padding: "6px" }}>
                      {doc.form?.ordernr} / {doc.form?.artikelnummer}
                    </td>
                    <td style={{ padding: "6px" }}>{doc.form?.benamning || "-"}</td>
                    <td style={{ padding: "6px" }}>{doc.form?.kund || "-"}</td>
                    <td style={{ padding: "6px", whiteSpace: "nowrap" }}>
                      {doc.updatedAt
                        ? new Date(doc.updatedAt).toLocaleString(lang === "sv" ? "sv-SE" : "en-GB", {
                            year: "numeric",
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "-"}
                      {doc.updatedBy ? ` (${doc.updatedBy})` : ""}
                    </td>
                    <td style={{ padding: "6px" }}>{doc.form?.upprattadAv || "-"}</td>
                    <td style={{ padding: "6px" }}>{doc.pdfSaved ? t.yes.toUpperCase() : t.no.toUpperCase()}</td>
                    <td style={{ padding: "6px" }}>
                      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                        <button className="btn-primary" onClick={() => openSaved(doc.matprotokollId)}>
                          {t.open}
                        </button>

                        {currentUser.role !== "view" &&
                          (confirmDeleteId === doc.matprotokollId ? (
                            <>
                              <span style={{ fontSize: "0.85rem", alignSelf: "center" }}>{t.sure}</span>
                              <button
                                className="btn-danger"
                                onClick={() => deleteSaved(doc.matprotokollId)}
                                disabled={isDeleting}
                              >
                                {t.yes}
                              </button>
                              <button className="btn-primary" onClick={() => setConfirmDeleteId(null)}>
                                {t.no}
                              </button>
                            </>
                          ) : (
                            <button
                              className="btn-danger"
                              onClick={() => setConfirmDeleteId(doc.matprotokollId)}
                            >
                              {t.delete}
                            </button>
                          ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <br />
      <div className="mätprotokoll-info-text">
        <p>
          <strong>{lang === "sv" ? "Tips:" : "Tips:"}</strong>
          <br />
        </p>
        {lang === "sv" ? (
          <p>
            Om du vill välja plats manuellt
            <br />
            Gå till Edge/Chrome: <i>Inställningar → Nedladdningar → Fråga var varje fil ska sparas innan nedladdning</i>
          </p>
        ) : (
          <p>
            If you want to choose the location manually
            <br />
            Go to Edge/Chrome: <i>Settings → Downloads → Ask where to save each file before downloading</i>
          </p>
        )}
      </div>
    </div>
  );
}