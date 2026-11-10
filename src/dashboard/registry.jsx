import ClockWidget from "../components/ClockWidget";
import GreenCross from "../components/GreenCross";
import ActivitiesWidget from "../components/ActivitiesWidget";
import PresenceWidget from "../components/PresenceWidget";
import EditableTextWidget from "../components/EditableTextWidget";
import StructuredTextWidget from "../components/StructuredTextWidget";
import ResourceWidget from "../components/ResourceWidget";
import LunchWidget from "../components/LunchWidget";
import OrderWidget from "../components/OrderWidget";
import ProductionOrderWidget from "../components/ProductionOrderWidget";
import QualityCostWidget from "../components/QualityCostWidget";
import { KpiCard, KpiChart, KpiGauge, KpiList } from "./KpiWidgets";

/*
 * Widgetregister. Varje widgettyp beskriver:
 *   label / icon / desc  – visas i "Lägg till widget"
 *   size                 – standardstorlek i rutnätet (w = kolumner av 12, h = rader)
 *   fields               – inställningsformulär som byggs automatiskt i webbgränssnittet
 *   render(props, ctx)   – ctx = { user, canEdit, settings, setPause }
 * Fält-typer: text | number | select | bool | kpi | kpis
 */
export const WIDGET_TYPES = {
  /* ---------- Nyckeltal ---------- */
  kpi: {
    group: "Nyckeltal", label: "Nyckeltal", icon: "🎯", desc: "Stort värde med mål, trend och färgstatus",
    size: { w: 3, h: 2 },
    fields: [
      { key: "kpiId", label: "Nyckeltal", type: "kpi" },
      { key: "title", label: "Rubrik (valfri)", type: "text" },
      { key: "showSpark", label: "Visa minidiagram", type: "bool", default: true },
    ],
    render: (p) => <KpiCard kpiId={p.kpiId} title={p.title} showSpark={p.showSpark !== false} />,
  },
  kpiChart: {
    group: "Nyckeltal", label: "Diagram", icon: "📈", desc: "Utveckling över tid, med målnivå",
    size: { w: 6, h: 3 },
    fields: [
      { key: "kpiId", label: "Nyckeltal", type: "kpi" },
      { key: "title", label: "Rubrik (valfri)", type: "text" },
      { key: "days", label: "Antal dagar bakåt", type: "number", default: 30 },
      { key: "style", label: "Typ", type: "select", default: "line", options: [["line", "Linje"], ["bar", "Staplar"]] },
    ],
    render: (p) => <KpiChart kpiId={p.kpiId} title={p.title} days={p.days} style={p.style} />,
  },
  kpiGauge: {
    group: "Nyckeltal", label: "Mätare", icon: "⏱️", desc: "Halvcirkelmätare mot målet",
    size: { w: 3, h: 3 },
    fields: [
      { key: "kpiId", label: "Nyckeltal", type: "kpi" },
      { key: "title", label: "Rubrik (valfri)", type: "text" },
      { key: "min", label: "Min", type: "number", default: 0 },
      { key: "max", label: "Max (tomt = automatiskt)", type: "number" },
    ],
    render: (p) => <KpiGauge kpiId={p.kpiId} title={p.title} min={p.min} max={p.max} />,
  },
  kpiList: {
    group: "Nyckeltal", label: "Nyckeltalslista", icon: "📋", desc: "Flera nyckeltal i en tabell med statusprick",
    size: { w: 4, h: 3 },
    fields: [
      { key: "title", label: "Rubrik", type: "text", default: "Nyckeltal" },
      { key: "kpiIds", label: "Nyckeltal (inget val = alla)", type: "kpis" },
    ],
    render: (p) => <KpiList kpiIds={p.kpiIds || []} title={p.title} />,
  },

  /* ---------- Produktion ---------- */
  productionOrders: {
    group: "Produktion", label: "Tillverkningsorder", icon: "🏭", desc: "Pågående tillverkningsorder",
    size: { w: 3, h: 3 }, fields: [], render: () => <ProductionOrderWidget />,
  },
  orders: {
    group: "Produktion", label: "Kundorder", icon: "📦", desc: "Kundorder och leveranser",
    size: { w: 3, h: 3 }, fields: [], render: () => <OrderWidget />,
  },
  quality: {
    group: "Produktion", label: "Grönt kors", icon: "➕", desc: "Dagsstatus per månad (t.ex. Säkerhet, Kvalitet)",
    size: { w: 3, h: 4 },
    fields: [
      { key: "crossId", label: "Id (unik per kors, t.ex. safety)", type: "text", default: "safety" },
      { key: "title", label: "Rubrik", type: "text", default: "Miljö/Säkerhet" },
      { key: "green", label: "Grön betyder", type: "text", default: "Ok" },
      { key: "yellow", label: "Gul betyder", type: "text", default: "Varning" },
      { key: "red", label: "Röd betyder", type: "text", default: "Problem" },
    ],
    render: (p, c) => (
      <div className="widget green-cross-widget">
        <h3>{p.title}</h3>
        <GreenCross crossId={p.crossId} user={c.user} green={p.green} yellow={p.yellow} red={p.red} />
      </div>
    ),
  },
  qualityCost: {
    group: "Produktion", label: "Kvalitetskostnad", icon: "💸", desc: "Kostnad för kvalitetsbrister mot föregående år",
    size: { w: 3, h: 3 }, fields: [],
    render: (p, c) => (
      <QualityCostWidget
        canEdit={c.canEdit}
        onEditingChange={c.setPause}
        PREV_YEAR_TOTAL={c.settings?.system?.qual || 0}
        PREV_YEAR_TOTAL_2={c.settings?.system?.qual2 || 0}
        YEAR_LABEL={c.settings?.system?.yearLabel || "2024/2026"}
      />
    ),
  },

  /* ---------- Personal & information ---------- */
  presence: { group: "Personal", label: "Närvaro", icon: "🧑‍🤝‍🧑", desc: "Vem är på plats", size: { w: 3, h: 4 }, fields: [], render: (p, c) => <PresenceWidget currentUser={c.user} /> },
  resources: { group: "Personal", label: "Resurser", icon: "🗓️", desc: "Bemanning och resurser", size: { w: 3, h: 4 }, fields: [], render: (p, c) => <ResourceWidget currentUser={c.user} /> },
  activities: { group: "Personal", label: "Aktiviteter", icon: "✅", desc: "Aktivitetslista", size: { w: 3, h: 3 }, fields: [], render: () => <ActivitiesWidget /> },
  structuredText: {
    group: "Information", label: "Textblock med rubriker", icon: "📝", desc: "Redigerbar text med underrubriker",
    size: { w: 3, h: 3 },
    fields: [
      { key: "textwidgetid", label: "Id (unikt)", type: "text", default: "info_sections" },
      { key: "title", label: "Rubrik", type: "text", default: "Information" },
    ],
    render: (p, c) => (
      <StructuredTextWidget
        textwidgetid={p.textwidgetid}
        initialTitle={p.title}
        initialSections={[{ subtitle: "Undertitel 1", text: "Text 1" }, { subtitle: "Undertitel 2", text: "Text 2" }]}
        canEdit={c.canEdit}
        onEditingChange={c.setPause}
      />
    ),
  },
  editableText: {
    group: "Information", label: "Fritext", icon: "✏️", desc: "Redigerbar textruta",
    size: { w: 3, h: 3 },
    fields: [{ key: "textwidgetid", label: "Id (unikt)", type: "text", default: "fanvaro" }],
    render: (p, c) => <EditableTextWidget textwidgetid={p.textwidgetid} canEdit={c.canEdit} onEditingChange={c.setPause} />,
  },
  clock: {
    group: "Information", label: "Klocka & väder", icon: "🕐", desc: "Tid, datum och väder för vald plats",
    size: { w: 3, h: 2 },
    fields: [
      { key: "lat", label: "Latitud (tomt = systeminställning)", type: "number" },
      { key: "lon", label: "Longitud (tomt = systeminställning)", type: "number" },
    ],
    render: (p, c) => (
      <ClockWidget
        lat={p.lat ?? c.settings?.system?.lat ?? 56.1612}
        lon={p.lon ?? c.settings?.system?.lon ?? 15.5869}
        canEdit={c.canEdit}
        onEditingChange={c.setPause}
      />
    ),
  },
  lunch: {
    group: "Information", label: "Lunchmeny", icon: "🍽️", desc: "Veckans lunch",
    size: { w: 3, h: 3 },
    fields: [
      { key: "footerOrder", label: "Beställs hos", type: "text" },
      { key: "price", label: "Pris", type: "text" },
    ],
    render: (p) => <LunchWidget footerOrder={p.footerOrder || ""} price={p.price || ""} />,
  },
};

export function defaultProps(type) {
  const out = {};
  for (const f of WIDGET_TYPES[type]?.fields || []) if (f.default !== undefined) out[f.key] = f.default;
  return out;
}

export const uid = () => Math.random().toString(36).slice(2, 10);

export function newWidget(type) {
  const t = WIDGET_TYPES[type];
  return { id: uid(), type, w: t.size.w, h: t.size.h, props: defaultProps(type) };
}
