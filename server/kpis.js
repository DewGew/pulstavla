/*
 * Nyckeltal (KPI) – definitioner, värden per dag, manuell inmatning och
 * import från Excel/CSV. Allt går att styra från webbgränssnittet.
 *
 * Datamodell
 *   kpis       { _id, name, unit, decimals, target, goodDirection, tolerance, description }
 *   kpiValues  { _id, kpiId, date: "YYYY-MM-DD", value: number }   (ett värde per nyckeltal och dag)
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const pn = (db, method, ...args) =>
  new Promise((resolve, reject) =>
    db[method](...args, (err, res) => (err ? reject(err) : resolve(res)))
  );

function isoDate(d) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

// Tar emot Date, "2026-11-10", "2026-11-10 08:00", "10/11/2026" eller "10.11.2026".
export function parseDate(v) {
  if (v instanceof Date && !isNaN(v)) return isoDate(v);
  if (typeof v !== "string") return null;
  const s = v.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

// "12,5", "1 234,5", 12.5 -> 12.5
export function parseNumber(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const s = v.replace(/\s/g, "").replace("%", "").replace(",", ".");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}


// Egen CSV-läsare: svensk Excel sparar ofta ";" som avgränsare, "," som decimaltecken
// och Windows-1252 som teckenkodning, vilket SheetJS inte hanterar pålitligt.
export function parseCsv(buf) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    text = new TextDecoder("windows-1252").decode(buf);
  }
  text = text.replace(/^\uFEFF/, "");
  const firstLine = text.split(/\r?\n/, 1)[0];
  const count = (ch) => firstLine.split(ch).length - 1;
  const delim = [";", "\t", ","].sort((a, b) => count(b) - count(a))[0];

  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);

  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()])));
}

const norm = (s) => String(s ?? "").trim().toLowerCase();

function cleanKpi(body, { partial = false } = {}) {
  const out = {};
  const str = (k, max) => {
    if (body[k] !== undefined) out[k] = String(body[k] ?? "").trim().slice(0, max);
  };
  str("name", 80);
  str("unit", 20);
  str("description", 300);
  if (body.decimals !== undefined) out.decimals = Math.min(4, Math.max(0, parseInt(body.decimals, 10) || 0));
  if (body.target !== undefined) out.target = body.target === "" || body.target === null ? null : parseNumber(body.target);
  if (body.tolerance !== undefined) out.tolerance = Math.min(100, Math.max(0, parseNumber(body.tolerance) ?? 10));
  if (body.goodDirection !== undefined) out.goodDirection = body.goodDirection === "lower" ? "lower" : "higher";
  if (!partial) {
    out.unit ??= "";
    out.description ??= "";
    out.decimals ??= 0;
    out.target ??= null;
    out.tolerance ??= 10;
    out.goodDirection ??= "higher";
  }
  return out;
}

export default function registerKpis({
  app, io, Datastore, xlsx, fs,
  requireAuth, requireAdmin, requireEditor,
  upload, validateUploadedFile, kpiImportFileTypes,
}) {
  const kpisDB = new Datastore({ filename: "./db/kpis.db", autoload: true });
  const valuesDB = new Datastore({ filename: "./db/kpiValues.db", autoload: true });
  kpisDB.persistence.setAutocompactionInterval(10 * 60 * 1000);
  valuesDB.persistence.setAutocompactionInterval(10 * 60 * 1000 + 15000);
  valuesDB.ensureIndex({ fieldName: "kpiId" });

  const notify = () => io.emit("kpiUpdated", { at: Date.now() });

  async function upsertValue(kpiId, date, value) {
    await pn(valuesDB, "update", { kpiId, date }, { kpiId, date, value, updatedAt: Date.now() }, { upsert: true });
  }

  /* ---------- Lista nyckeltal inkl. senaste värden ---------- */
  app.get("/kpis", requireAuth, async (req, res) => {
    try {
      const kpis = await pn(kpisDB, "find", {});
      const since = isoDate(new Date(Date.now() - 400 * 86400000));
      const vals = await pn(valuesDB, "find", { date: { $gte: since } });
      const byKpi = new Map();
      for (const v of vals) {
        if (!byKpi.has(v.kpiId)) byKpi.set(v.kpiId, []);
        byKpi.get(v.kpiId).push(v);
      }
      const out = kpis
        .map((k) => {
          const list = (byKpi.get(k._id) || []).sort((a, b) => (a.date < b.date ? 1 : -1));
          return {
            ...k,
            latest: list[0] ? { date: list[0].date, value: list[0].value } : null,
            previous: list[1] ? { date: list[1].date, value: list[1].value } : null,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name, "sv"));
      res.json(out);
    } catch (err) {
      console.error("GET /kpis:", err);
      res.status(500).json({ error: "Kunde inte läsa nyckeltal" });
    }
  });

  /* ---------- Historik för ett nyckeltal ---------- */
  app.get("/kpis/:id/values", requireAuth, async (req, res) => {
    try {
      const days = Math.min(730, Math.max(1, parseInt(req.query.days, 10) || 30));
      const since = isoDate(new Date(Date.now() - days * 86400000));
      const vals = await pn(valuesDB, "find", { kpiId: req.params.id, date: { $gte: since } });
      res.json(vals.map(({ date, value }) => ({ date, value })).sort((a, b) => (a.date < b.date ? -1 : 1)));
    } catch {
      res.status(500).json({ error: "Kunde inte läsa värden" });
    }
  });

  /* ---------- Definitioner (admin) ---------- */
  app.post("/kpis", requireAuth, requireAdmin, async (req, res) => {
    const data = cleanKpi(req.body || {});
    if (!data.name) return res.status(400).json({ error: "Namn saknas" });
    try {
      const dup = await pn(kpisDB, "findOne", { name: data.name });
      if (dup) return res.status(409).json({ error: "Ett nyckeltal med det namnet finns redan" });
      const doc = await pn(kpisDB, "insert", data);
      notify();
      res.status(201).json(doc);
    } catch {
      res.status(500).json({ error: "Kunde inte skapa nyckeltal" });
    }
  });

  app.put("/kpis/:id", requireAuth, requireAdmin, async (req, res) => {
    const data = cleanKpi(req.body || {}, { partial: true });
    if (data.name === "") return res.status(400).json({ error: "Namn saknas" });
    try {
      const n = await pn(kpisDB, "update", { _id: req.params.id }, { $set: data });
      if (!n) return res.sendStatus(404);
      notify();
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: "Kunde inte spara nyckeltal" });
    }
  });

  app.delete("/kpis/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      await pn(kpisDB, "remove", { _id: req.params.id }, {});
      await pn(valuesDB, "remove", { kpiId: req.params.id }, { multi: true });
      notify();
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: "Kunde inte ta bort nyckeltal" });
    }
  });

  /* ---------- Manuell inmatning (redigerare) ---------- */
  app.put("/kpis/:id/values/:date", requireAuth, requireEditor, async (req, res) => {
    const { id, date } = req.params;
    if (!DATE_RE.test(date)) return res.status(400).json({ error: "Ogiltigt datum (ÅÅÅÅ-MM-DD)" });
    const value = parseNumber(req.body?.value);
    if (value === null) return res.status(400).json({ error: "Ogiltigt värde" });
    try {
      if (!(await pn(kpisDB, "findOne", { _id: id }))) return res.sendStatus(404);
      await upsertValue(id, date, value);
      notify();
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: "Kunde inte spara värde" });
    }
  });

  app.delete("/kpis/:id/values/:date", requireAuth, requireEditor, async (req, res) => {
    try {
      await pn(valuesDB, "remove", { kpiId: req.params.id, date: req.params.date }, {});
      notify();
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: "Kunde inte ta bort värde" });
    }
  });

  /*
   * ---------- Import från Excel/CSV (admin) ----------
   * Format 1 (lång):  kolumner  Nyckeltal | Datum | Värde
   * Format 2 (bred):  första kolumnen Datum, övriga kolumner = ett nyckeltal vardera
   * Okända nyckeltal skapas automatiskt. Befintliga värden för samma dag skrivs över.
   */
  app.post(
    "/kpis/import",
    requireAuth,
    requireAdmin,
    upload.single("file"),
    validateUploadedFile(kpiImportFileTypes),
    async (req, res) => {
      const filePath = req.file.path;
      try {
        const buf = fs.readFileSync(filePath);
        let rows;
        if (/\.csv$/i.test(req.file.originalname || "")) {
          rows = parseCsv(buf);
        } else {
          const wb = xlsx.read(buf, { type: "buffer", cellDates: true });
          rows = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "", raw: true });
        }
        if (!rows.length) return res.status(400).json({ error: "Filen innehåller inga rader" });

        const headers = Object.keys(rows[0]);
        const find = (names) => headers.find((h) => names.includes(norm(h)));
        const kCol = find(["nyckeltal", "kpi", "namn", "name"]);
        const dCol = find(["datum", "date", "dag"]) || headers[0];
        const vCol = find(["värde", "varde", "value", "utfall"]);

        const kpis = await pn(kpisDB, "find", {});
        const byName = new Map(kpis.map((k) => [norm(k.name), k]));
        const created = [];
        const getKpi = async (name) => {
          const key = norm(name);
          if (!key) return null;
          if (byName.has(key)) return byName.get(key);
          const doc = await pn(kpisDB, "insert", cleanKpi({ name: String(name).trim() }));
          byName.set(key, doc);
          created.push(doc.name);
          return doc;
        };

        let imported = 0;
        const skipped = [];
        const handle = async (kpiName, dateRaw, valueRaw, line) => {
          const date = parseDate(dateRaw);
          const value = parseNumber(valueRaw);
          if (!date || value === null) {
            if (String(valueRaw).trim() !== "") skipped.push(line);
            return;
          }
          const kpi = await getKpi(kpiName);
          if (!kpi) return skipped.push(line);
          await upsertValue(kpi._id, date, value);
          imported++;
        };

        if (kCol && vCol) {
          for (let i = 0; i < rows.length; i++) await handle(rows[i][kCol], rows[i][dCol], rows[i][vCol], i + 2);
        } else if (headers.length >= 2) {
          const cols = headers.filter((h) => h !== dCol);
          for (let i = 0; i < rows.length; i++)
            for (const c of cols) await handle(c, rows[i][dCol], rows[i][c], i + 2);
        } else {
          return res.status(400).json({ error: "Hittade inga kolumner att importera" });
        }

        notify();
        res.json({ success: true, imported, created, skippedRows: [...new Set(skipped)].slice(0, 20) });
      } catch (err) {
        console.error("KPI-import:", err);
        res.status(400).json({ error: "Kunde inte läsa filen" });
      } finally {
        fs.unlink(filePath, () => {});
      }
    }
  );
}
