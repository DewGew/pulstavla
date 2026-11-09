function renderInline(line, keyPrefix) {
  const pattern = /(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*)/g;
  const nodes = [];
  let last = 0;
  let match;
  while ((match = pattern.exec(line)) !== null) {
    if (match.index > last) nodes.push(line.slice(last, match.index));
    if (match[2] && match[3]) {
      try {
        const url = new URL(match[3]);
        nodes.push(url.protocol === "http:" || url.protocol === "https:" ? <a key={keyPrefix + match.index} href={url.href} target="_blank" rel="noopener noreferrer">{match[2]}</a> : match[0]);
      } catch { nodes.push(match[0]); }
    } else if (match[4]) nodes.push(<strong key={keyPrefix + match.index}>{match[4]}</strong>);
    else nodes.push(<em key={keyPrefix + match.index}>{match[5]}</em>);
    last = match.index + match[0].length;
  }
  if (last < line.length) nodes.push(line.slice(last));
  return nodes;
}

export default function InlineMarkdown({ text = "" }) {
  const lines = String(text ?? "").split("\n");
  const output = [];
  let listItems = [];
  const flushList = () => {
    if (listItems.length) {
      output.push(<ul key={"list-" + output.length}>{listItems}</ul>);
      listItems = [];
    }
  };
  lines.forEach((line, index) => {
    const item = line.match(/^\s*[-*]\s+(.+)$/);
    if (item) {
      listItems.push(<li key={index}>{renderInline(item[1], "i" + index + "-")}</li>);
      return;
    }
    flushList();
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) output.push(<h4 key={index}>{renderInline(heading[1], "h" + index + "-")}</h4>);
    else if (line.trim()) output.push(<span key={index}>{renderInline(line, "t" + index + "-")}{index < lines.length - 1 ? "\n" : ""}</span>);
    else if (index < lines.length - 1) output.push(<br key={index} />);
  });
  flushList();
  return <>{output}</>;
}
