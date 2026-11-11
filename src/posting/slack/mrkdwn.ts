// Slack renders mrkdwn, not Markdown. This preview escapes every character
// first, so draft text can never inject HTML, then applies only the documented
// mrkdwn subset Slack understands.

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeSlackHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]);
}

const escapeAttribute = (value: string): string => escapeSlackHtml(value);

// Inline code is pulled out first so italic or bold markers inside it are left
// alone. The placeholders cannot collide with escaped text.
function styleInlineChunk(chunk: string): string {
  if (!chunk) return '';
  const code: string[] = [];
  let output = escapeSlackHtml(chunk).replace(/`([^`\n]+)`/g, (_, inner: string) => {
    const index = code.length;
    code.push(
      `<code class="rounded bg-[#161b22] px-1 py-0.5 font-mono text-[11px] text-[#e6edf3]">${inner}</code>`
    );
    return `\u0001${index}\u0001`;
  });

  output = output
    .replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>')
    .replace(/_([^_\n]+)_/g, '<em>$1</em>')
    .replace(/~([^~\n]+)~/g, '<s>$1</s>')
    .replace(/\u0001(\d+)\u0001/g, (_, index: string) => code[Number(index)] ?? '');

  return output;
}

// Slack links and references use angle brackets: <https://example.com|label>,
// <#C123|general> and <@U123>. Everything else in angle brackets stays literal.
function renderInline(raw: string): string {
  const token = /<([^<>\n]+)>/g;
  let output = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = token.exec(raw))) {
    output += styleInlineChunk(raw.slice(lastIndex, match.index));
    const inner = match[1];
    const separator = inner.indexOf('|');
    const target = separator >= 0 ? inner.slice(0, separator) : inner;
    const label = separator >= 0 ? inner.slice(separator + 1) : target;

    if (/^https?:\/\/[^\s]+$/i.test(target)) {
      output += `<a href="${escapeAttribute(target)}" target="_blank" rel="noreferrer" class="text-[#58a6ff] underline">${escapeSlackHtml(label)}</a>`;
    } else if (/^[@#][A-Za-z0-9]+$/.test(target)) {
      output += `<span class="rounded bg-[#388bfd]/20 px-1 text-[#58a6ff]">${escapeSlackHtml(label)}</span>`;
    } else {
      output += escapeSlackHtml(`<${inner}>`);
    }

    lastIndex = token.lastIndex;
  }

  output += styleInlineChunk(raw.slice(lastIndex));
  return output;
}

export function renderSlackMrkdwn(text: string): string {
  const raw = String(text ?? '').replace(/\r\n?/g, '\n');
  if (!raw.trim()) return '';

  const html: string[] = [];
  let fence: string[] | null = null;
  let quote: string[] = [];

  const flushQuote = () => {
    if (quote.length === 0) return;
    html.push(
      `<blockquote class="border-l-2 border-[#30363d] pl-2 text-[#8b949e]">${quote.join('<br />')}</blockquote>`
    );
    quote = [];
  };

  for (const line of raw.split('\n')) {
    if (/^\s*```/.test(line)) {
      if (fence) {
        html.push(
          `<pre class="overflow-x-auto rounded bg-[#161b22] p-2 font-mono text-[11px] text-[#e6edf3]"><code>${escapeSlackHtml(fence.join('\n'))}</code></pre>`
        );
        fence = null;
      } else {
        flushQuote();
        fence = [];
      }
      continue;
    }

    if (fence) {
      fence.push(line);
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      quote.push(renderInline(line.replace(/^\s*>\s?/, '')));
      continue;
    }

    flushQuote();
    html.push(renderInline(line));
  }

  // An unclosed fence still renders safely as a code block.
  if (fence) {
    html.push(
      `<pre class="overflow-x-auto rounded bg-[#161b22] p-2 font-mono text-[11px] text-[#e6edf3]"><code>${escapeSlackHtml(fence.join('\n'))}</code></pre>`
    );
  }
  flushQuote();

  return html.join('<br />');
}

export default { escapeSlackHtml, renderSlackMrkdwn };
