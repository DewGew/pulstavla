import { uid, defaultProps, WIDGET_TYPES } from "./registry.jsx";

const w = (type, props = {}) => ({
  id: uid(), type, w: WIDGET_TYPES[type].size.w, h: WIDGET_TYPES[type].size.h,
  props: { ...defaultProps(type), ...props },
});

/*
 * Startlayout när inga dashboards sparats ännu. Motsvarar den tidigare
 * fasta översikten så att inget försvinner vid uppgradering. Från och med
 * nu ändras allt i webbgränssnittet ("Redigera dashboard").
 */
export function buildDefaultConfig() {
  return {
    rotateSeconds: 0,
    items: [
      {
        id: "oversikt",
        name: "Översikt",
        inRotation: true,
        widgets: [
          w("structuredText", { textwidgetid: "info_sections", title: "Information" }),
          w("quality", { crossId: "safety", title: "Miljö/Säkerhet", green: "Ok", yellow: "Varning", red: "Problem" }),
          w("quality", { crossId: "quality", title: "Kvalité", green: "OK", yellow: "Int. Avvikelse", red: "Ext. Avvikelse" }),
          w("presence"),
          w("resources"),
          w("productionOrders"),
          w("orders"),
          w("editableText", { textwidgetid: "fanvaro" }),
          w("structuredText", { textwidgetid: "arbetstider", title: "Arbetstider" }),
          w("lunch", { footerOrder: "Hanna Svensson", price: "112" }),
          w("qualityCost"),
          w("activities"),
        ],
      },
    ],
  };
}
