/** Parse provider JSON even when a tool-enabled response adds a preface or Markdown. */
export function structuredResearch(content: unknown, required: string[]): any {
  const raw = typeof content === 'string' ? content : Array.isArray(content)
    ? content.map(p => typeof p === 'string' ? p : p?.text || '').join('') : '';
  const accept = (s: string) => {
    try { const v = JSON.parse(s); return v && !Array.isArray(v) && required.every(k => k in v) ? v : null; }
    catch { return null; }
  };
  const direct = accept(raw);
  if (direct) return direct;
  let start = -1, depth = 0, quoted = false, escaped = false, result: any = null;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (start < 0) { if (c === '{') { start = i; depth = 1; quoted = false; escaped = false; } continue; }
    if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; continue; }
    if (c === '"') quoted = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) { result = accept(raw.slice(start, i + 1)) || result; start = -1; }
  }
  if (result) return result;
  throw new Error('DeepSeek returned no complete structured research object. The game was not saved.');
}
