export default function InlineMarkdown({ text = "" }) {
  const content = String(text ?? "");
  const parts = [];
  let lastIndex = 0;
  let match;
  const linkPattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

  while ((match = linkPattern.exec(content)) !== null) {
    const [markdown, label, rawUrl] = match;

    if (match.index > lastIndex) {
      parts.push(content.slice(lastIndex, match.index));
    }

    try {
      const url = new URL(rawUrl);
      if (url.protocol === "http:" || url.protocol === "https:") {
        parts.push(
          <a
            key={match.index}
            href={url.href}
            target="_blank"
            rel="noopener noreferrer"
          >
            {label}
          </a>
        );
      } else {
        parts.push(markdown);
      }
    } catch {
      parts.push(markdown);
    }

    lastIndex = match.index + markdown.length;
  }

  if (lastIndex < content.length) {
    parts.push(content.slice(lastIndex));
  }

  return <>{parts.length ? parts : content}</>;
}
