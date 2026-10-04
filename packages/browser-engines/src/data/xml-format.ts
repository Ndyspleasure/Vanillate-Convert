/**
 * Whitespace-only XML formatting and minification that preserves comments, CDATA, processing
 * instructions and the DOCTYPE. Well-formedness is checked first with fast-xml-parser's
 * validator so errors can point to a line and column.
 */
import { XMLValidator } from 'fast-xml-parser';

export class XmlSyntaxError extends Error {
  override name = 'XmlSyntaxError';
  readonly line: number;
  readonly column: number;

  constructor(message: string, line: number, column: number) {
    super(message);
    this.line = line;
    this.column = column;
  }
}

export function assertWellFormed(xml: string): void {
  const result = XMLValidator.validate(xml, { allowBooleanAttributes: true });
  if (result !== true) {
    throw new XmlSyntaxError(result.err.msg, result.err.line, result.err.col);
  }
}

type Token =
  | { type: 'open'; text: string; name: string }
  | { type: 'close'; text: string }
  | { type: 'selfclose'; text: string }
  | { type: 'text'; text: string }
  | { type: 'other'; text: string };

function tokenize(xml: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const take = (end: string, from: number): string => {
    const index = xml.indexOf(end, from);
    if (index < 0) throw new XmlSyntaxError(`unterminated construct, expected "${end}"`, 0, 0);
    return xml.slice(i, index + end.length);
  };
  while (i < xml.length) {
    if (xml[i] !== '<') {
      const next = xml.indexOf('<', i);
      const end = next < 0 ? xml.length : next;
      tokens.push({ type: 'text', text: xml.slice(i, end) });
      i = end;
      continue;
    }
    let text: string;
    if (xml.startsWith('<!--', i)) text = take('-->', i + 4);
    else if (xml.startsWith('<![CDATA[', i)) text = take(']]>', i + 9);
    else if (xml.startsWith('<?', i)) text = take('?>', i + 2);
    else if (xml.startsWith('<!', i)) {
      // DOCTYPE, possibly with an internal subset.
      let depth = 0;
      let j = i;
      for (; j < xml.length; j++) {
        if (xml[j] === '[') depth++;
        else if (xml[j] === ']') depth--;
        else if (xml[j] === '>' && depth <= 0) break;
      }
      text = xml.slice(i, j + 1);
    } else {
      // Element tag: find the closing '>' outside attribute quotes.
      let quote: string | null = null;
      let j = i + 1;
      for (; j < xml.length; j++) {
        const ch = xml[j];
        if (quote) {
          if (ch === quote) quote = null;
        } else if (ch === '"' || ch === "'") quote = ch;
        else if (ch === '>') break;
      }
      text = xml.slice(i, j + 1);
    }
    i += text.length;
    if (text.startsWith('</')) tokens.push({ type: 'close', text });
    else if (text.startsWith('<!') || text.startsWith('<?')) tokens.push({ type: 'other', text });
    else if (text.endsWith('/>')) tokens.push({ type: 'selfclose', text });
    else tokens.push({ type: 'open', text, name: /^<([^\s/>]+)/.exec(text)?.[1] ?? '' });
  }
  return tokens;
}

export function formatXml(xml: string, indent = '  '): string {
  assertWellFormed(xml);
  const tokens = tokenize(xml);
  const out: string[] = [];
  let depth = 0;
  for (let t = 0; t < tokens.length; t++) {
    const token = tokens[t]!;
    const pad = indent.repeat(depth);
    if (token.type === 'text') {
      const trimmed = token.text.trim();
      if (trimmed !== '') out.push(pad + trimmed);
      continue;
    }
    if (token.type === 'open') {
      // Keep simple elements on one line: <a>text</a>
      const next = tokens[t + 1];
      const after = tokens[t + 2];
      if (next?.type === 'text' && after?.type === 'close' && !next.text.includes('\n')) {
        out.push(pad + token.text + next.text.trim() + after.text);
        t += 2;
        continue;
      }
      if (next?.type === 'close') {
        out.push(pad + token.text + next.text);
        t += 1;
        continue;
      }
      out.push(pad + token.text);
      depth++;
      continue;
    }
    if (token.type === 'close') {
      depth = Math.max(0, depth - 1);
      out.push(indent.repeat(depth) + token.text);
      continue;
    }
    out.push(pad + token.text);
  }
  return `${out.join('\n')}\n`;
}

export function minifyXml(xml: string): string {
  assertWellFormed(xml);
  return tokenize(xml)
    .filter((token) => !(token.type === 'other' && token.text.startsWith('<!--')))
    .map((token) =>
      token.type === 'text' ? (token.text.trim() === '' ? '' : token.text.trim()) : token.text,
    )
    .join('');
}
