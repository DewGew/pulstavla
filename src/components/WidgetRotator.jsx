import { useEffect, useState } from "react";
import "./WidgetRotator.css";

export default function WidgetRotator({
  interval = 10000,
  paused = false,
  children
}) {
  const [index, setIndex] = useState(0);
  const items = Array.isArray(children) ? children : [children];

  useEffect(() => {
    if (paused || items.length <= 1) return;

    const timer = setInterval(() => {
      setIndex((prev) => (prev + 1) % items.length);
    }, interval);

    return () => clearInterval(timer);
  }, [paused, items.length, interval]);

  const prev = () => {
    setIndex((i) => (i - 1 + items.length) % items.length);
  };

  const next = () => {
    setIndex((i) => (i + 1) % items.length);
  };

  return (
    <div className={`widget-rotator${paused ? " rotator-editing" : ""}`}>
      
      {/* Navigation */}
      {items.length > 1 && (
        <div className="rotator-controls">
          <button onClick={prev} className="rotator-btn">
            ◀
          </button>

          <button onClick={next} className="rotator-btn">
            ▶
          </button>
        </div>
      )}

      {/* Items */}
      {items.map((child, i) => (
        <div
          key={i}
          className={`rotator-item ${i === index ? "active" : ""}`}
        >
          {child}
        </div>
      ))}
    </div>
  );
}
