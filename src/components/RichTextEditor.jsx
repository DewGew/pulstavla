import { useEffect, useRef, useState } from "react";
import InlineMarkdown from "./InlineMarkdown";

export default function RichTextEditor({ value = "", onChange, rows = 4 }) {
  const textareaRef = useRef(null);
  const pendingSelection = useRef(null);
  const [showPreview, setShowPreview] = useState(true);

  useEffect(() => {
    if (!pendingSelection.current || !textareaRef.current) return;
    const { start, end } = pendingSelection.current;
    textareaRef.current.focus();
    textareaRef.current.setSelectionRange(start, end);
    pendingSelection.current = null;
  }, [value]);

  const insert = (before, after = "", placeholder = "") => {
    const field = textareaRef.current;
    if (!field) return;
    const start = field.selectionStart;
    const end = field.selectionEnd;
    const selected = value.slice(start, end) || placeholder;
    const replacement = before + selected + after;
    const next = value.slice(0, start) + replacement + value.slice(end);
    pendingSelection.current = {
      start: start + before.length,
      end: start + before.length + selected.length,
    };
    onChange(next);
  };

  const prefixLine = (prefix) => {
    const field = textareaRef.current;
    if (!field) return;
    const start = field.selectionStart;
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    pendingSelection.current = { start: lineStart + prefix.length, end: lineStart + prefix.length };
    onChange(value.slice(0, lineStart) + prefix + value.slice(lineStart));
  };

  return (
    <div className="rich-text-editor">
      <div className="rich-text-toolbar" aria-label="Textformatering">
        <button type="button" title="Fetstil" onClick={() => insert("**", "**", "fet text")}><strong>B</strong></button>
        <button type="button" title="Kursiv" onClick={() => insert("*", "*", "kursiv text")}><em>I</em></button>
        <button type="button" title="Infoga länk" onClick={() => insert("[", "](https://)", "länktext")}>Länk</button>
        <button type="button" title="Rubrik" onClick={() => prefixLine("## ")}>Rubrik</button>
        <button type="button" title="Punktlista" onClick={() => prefixLine("- ")}>• Lista</button>
        <span className="rich-text-help">Markera text först för att formatera den</span>
      </div>
      <textarea
        ref={textareaRef}
        rows={rows}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label="Textinnehåll"
      />
      <div className="rich-text-preview-toggle">
        <button type="button" onClick={() => setShowPreview((current) => !current)}>
          {showPreview ? "Dölj förhandsvisning" : "Visa förhandsvisning"}
        </button>
      </div>
      {showPreview && (
        <div className="rich-text-preview">
          <div className="rich-text-preview-label">Förhandsvisning</div>
          <InlineMarkdown text={value} />
        </div>
      )}
    </div>
  );
}
