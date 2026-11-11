// A deliberately small Markdown renderer for the Reddit preview. It escapes all
// input before adding tags, so the returned HTML is safe to inject. It supports
// the subset Reddit authors use for posts and is not a full Markdown parser.
const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ESCAPES[character]);
}

function safeHref(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function renderInline(value: string): string {
  // Code spans are rendered first and replaced with placeholders so emphasis and
  // link rules cannot rewrite their contents.
  const codeSpans: string[] = [];
  let text = value.replace(/`([^`\n]+)`/g, (_match, code: string) => {
    codeSpans.push(`<code>${code}</code>`);
    return `\u0000${codeSpans.length - 1}\u0000`;
  });

  text = text
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (match, label: string, url: string) => {
      const href = safeHref(url.replace(/&amp;/g, '&'));
      if (!href) return match;
      return `<a href="${escapeHtml(href)}" target="_blank" rel="nofollow noopener noreferrer">${label}</a>`;
    })
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?]|$)/g, '$1<em>$2</em>');

  return text.replace(/\u0000(\d+)\u0000/g, (_match, index: string) => codeSpans[Number(index)] || '');
}

export function renderMarkdownPreview(markdown: string): string {
  const source = String(markdown || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, '');
  const escaped = escapeHtml(source);
  const lines = escaped.split('\n');
  const output: string[] = [];
  let index = 0;

  const isBlockStart = (line: string): boolean =>
    /^```/.test(line) ||
    /^#{1,6}\s/.test(line) ||
    /^(?:>|&gt;)\s?/.test(line) ||
    /^[-*+]\s/.test(line) ||
    /^\d+\.\s/.test(line) ||
    /^(?:---|\*\*\*)$/.test(line.trim());

  while (index < lines.length) {
    const line = lines[index];

    // Fenced code block.
    if (/^```/.test(line)) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1;
      output.push(`<pre><code>${code.join('\n')}</code></pre>`);
      continue;
    }

    if (!line.trim()) {
      index += 1;
      continue;
    }

    // Heading.
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      output.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    // Horizontal rule.
    if (/^(?:---|\*\*\*)$/.test(line.trim())) {
      output.push('<hr />');
      index += 1;
      continue;
    }

    // Blockquote.
    if (/^(?:>|&gt;)\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^(?:>|&gt;)\s?/.test(lines[index])) {
        quote.push(renderInline(lines[index].replace(/^(?:>|&gt;)\s?/, '')));
        index += 1;
      }
      output.push(`<blockquote>${quote.join('<br />')}</blockquote>`);
      continue;
    }

    // Unordered list.
    if (/^[-*+]\s/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*+]\s/.test(lines[index])) {
        items.push(renderInline(lines[index].replace(/^[-*+]\s/, '')));
        index += 1;
      }
      output.push(`<ul>${items.map((item) => `<li>${item}</li>`).join('')}</ul>`);
      continue;
    }

    // Ordered list.
    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s/.test(lines[index])) {
        items.push(renderInline(lines[index].replace(/^\d+\.\s/, '')));
        index += 1;
      }
      output.push(`<ol>${items.map((item) => `<li>${item}</li>`).join('')}</ol>`);
      continue;
    }

    // Paragraph: consume until the next block or blank line.
    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index])) {
      paragraph.push(renderInline(lines[index]));
      index += 1;
    }
    output.push(`<p>${paragraph.join('<br />')}</p>`);
  }

  return output.join('\n');
}

export default { renderMarkdownPreview };
