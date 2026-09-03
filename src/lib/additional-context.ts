// 消息附加上下文（message-context-mentions）的唯一格式实现点：发送侧把 chips 与
// 划词引用序列化为 content 开头的 <additional_context> XML 块（design D3），渲染侧
// 解析剥离还原为 chips（design D4）。两侧共用本文件，避免格式漂移。
//
// 序列化「严格」：固定 section 顺序（attachments → skills → mcps）、路径统一补 ./
// 前缀、属性转义、去重；解析「宽容但锚定」：仅认 content 开头（允许前导空白）且结构
// 完整合法的块，否则返回 null 走原样 Markdown 渲染——用户手打的同形 XML 出现在中间
// 位置或结构残缺时是正文的一部分，宁可不渲染不能误吞（design D4）。

export type AttachmentKind = 'file' | 'dir' | 'skill' | 'mcp';

export interface AttachmentItem {
  kind: AttachmentKind;
  /** file/dir：工作区相对路径（内部统一不带 ./ 前缀，序列化时补）；skill/mcp 不用。 */
  path?: string;
  /** skill 名，或 mcp 的 tool_name。 */
  name?: string;
  /** mcp 专用：工具所属 server（同名 tool 可来自不同 server，必须随行）。 */
  server?: string;
}

export type QuotedRole = 'user' | 'agent';

export interface QuotedReference {
  /** 被引用消息的 msg_index，前端直接回传为 turn。 */
  turn: number;
  /** 契约展示口径：assistant 统一写作 agent。 */
  role: QuotedRole;
  text: string;
}

export interface ParsedAdditionalContext {
  items: AttachmentItem[];
  /** 划词引用；与 items 一样按文档顺序还原。 */
  references: QuotedReference[];
  /** 剥离块后剩余的正文（可能带块后的换行）。 */
  rest: string;
}

// `>` 虽非属性转义必需，但统一转义可让属性值不出现裸 `>`，解析侧的
// `[^>]*?` 标签内扫描才不会提前截断（如文件名含 `>` 的现实输入）。
const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};
const UNESCAPES: Record<string, string> = {
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&amp;': '&',
};

function escapeXml(value: string): string {
  return value.replace(/[&<>"]/g, (c) => ESCAPES[c]);
}

// &amp; 必须最后还原，避免二次转义序列被错误折叠。
function unescapeXml(value: string): string {
  return value.replace(/&(?:lt|gt|quot|amp);/g, (s) => UNESCAPES[s] ?? s);
}

// 序列化输出统一带 ./ 前缀（design D3，前后端约定）；入口允许 ./、/ 或裸相对路径。
function toPrefixedPath(path: string): string {
  return `./${path.replace(/^\.?\//, '')}`;
}

// 内部统一存工作区相对路径（去 ./ 与 / 前缀），渲染展示与去重键都基于它，round-trip 稳定。
function toCanonicalPath(path: string): string {
  return path.replace(/^\.?\//, '');
}

function itemKey(item: AttachmentItem): string {
  if (item.kind === 'file' || item.kind === 'dir') {
    return `${item.kind}:${toCanonicalPath(item.path ?? '')}`;
  }
  if (item.kind === 'skill') return `skill:${item.name ?? ''}`;
  return `mcp:${item.name ?? ''}@${item.server ?? ''}`;
}

// 去重（spec：重复附加不产生重复项）：同 kind 下按路径 / 名字 / (tool, server) 归一。
export function dedupeItems(items: AttachmentItem[]): AttachmentItem[] {
  const seen = new Set<string>();
  const out: AttachmentItem[] = [];
  for (const item of items) {
    const key = itemKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

// 序列化为 <additional_context> 块文本；附件与引用全空返回 null（调用方保持 content 现状，
// 不产生空块——spec「无任何附加时不产生块」）。
export function serializeAdditionalContext(
  items: AttachmentItem[],
  references: QuotedReference[] = []
): string | null {
  const deduped = dedupeItems(items);
  const quoted = dedupeReferences(references);
  const files = deduped.filter((it) => it.kind === 'file' || it.kind === 'dir');
  const skills = deduped.filter((it) => it.kind === 'skill');
  const mcps = deduped.filter((it) => it.kind === 'mcp');
  if (files.length === 0 && skills.length === 0 && mcps.length === 0 && quoted.length === 0) {
    return null;
  }

  const lines: string[] = ['<additional_context>'];
  if (files.length > 0) {
    lines.push('    <attachments>');
    for (const it of files) {
      const kind = it.kind === 'dir' ? 'dir' : 'file';
      lines.push(`        <path type="${kind}">${escapeXml(toPrefixedPath(it.path ?? ''))}</path>`);
    }
    lines.push('    </attachments>');
  }
  if (skills.length > 0) {
    lines.push('    <skills>');
    for (const it of skills) {
      lines.push(`        <skill name="${escapeXml(it.name ?? '')}" />`);
    }
    lines.push('    </skills>');
  }
  if (mcps.length > 0) {
    lines.push('    <mcps>');
    for (const it of mcps) {
      lines.push(
        `        <mcp tool_name="${escapeXml(it.name ?? '')}" server="${escapeXml(it.server ?? '')}" />`
      );
    }
    lines.push('    </mcps>');
  }
  if (quoted.length > 0) {
    // 同一 (turn, role) 的多条划词聚合为一个 quotes 分组；quote id 是分组内的
    // 1-based 顺序号，因此不放入内部模型，避免消费方改写顺序时元数据漂移。
    const groups = new Map<
      string,
      { turn: number; role: QuotedRole; references: QuotedReference[] }
    >();
    for (const reference of quoted) {
      const key = `${reference.turn}:${reference.role}`;
      const group = groups.get(key);
      if (group) {
        group.references.push(reference);
      } else {
        groups.set(key, { turn: reference.turn, role: reference.role, references: [reference] });
      }
    }

    lines.push('    <quoted_context>');
    for (const group of groups.values()) {
      lines.push(`        <quotes turn="${group.turn}" role="${group.role}" type="fragments">`);
      group.references.forEach((reference, index) => {
        lines.push(`            <quote id="${index + 1}">${escapeXml(reference.text)}</quote>`);
      });
      lines.push('        </quotes>');
    }
    lines.push('    </quoted_context>');
  }
  lines.push('</additional_context>');
  return lines.join('\n');
}

// 引用按 (turn, role, text) 精确去重；同一划词重复点「引用」不重复入参。
export function dedupeReferences(references: QuotedReference[]): QuotedReference[] {
  const seen = new Set<string>();
  const out: QuotedReference[] = [];
  for (const reference of references) {
    const key = `${reference.turn}:${reference.role}:${reference.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(reference);
  }
  return out;
}

// 属性串严格解析：整个串必须由 name="value" + 空白构成（顺序不敏感），出现裸 token
// 即非法 → 整块判不合法。未知属性忽略（宽容），必需属性缺失才判非法。
function parseAttrsStrict(raw: string): Record<string, string> | null {
  const attrs: Record<string, string> = {};
  let rest = raw;
  // 标签内捕获组会带上分隔空白（如 ` type="file"`），所以每个属性前先吃掉空白。
  const re = /^\s*([a-zA-Z_][\w-]*)\s*=\s*"([^"]*)"\s*/;
  while (rest.length > 0) {
    const m = re.exec(rest);
    if (!m) return null;
    attrs[m[1]] = m[2];
    rest = rest.slice(m[0].length);
  }
  return attrs;
}

// 自闭合或空内容成对标签（<tag ... /> 与 <tag ...></tag> 等价）。
function emptyTagRe(tag: string): RegExp {
  return new RegExp(`<${tag}\\b([^>]*?)(?:/>|></${tag}>)`, 'g');
}

function collectAttachments(body: string, items: AttachmentItem[]): boolean {
  const re = /<path\b([^>]*?)>([\s\S]*?)<\/path>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const attrs = parseAttrsStrict(m[1]);
    if (!attrs || (attrs.type !== 'file' && attrs.type !== 'dir')) return false;
    const text = unescapeXml(m[2]);
    if (text.trim() === '') return false;
    items.push({ kind: attrs.type, path: toCanonicalPath(text) });
  }
  // 标签之间只允许空白，其余内容视为结构非法。
  return body.replace(re, '').trim() === '';
}

function collectEmptyTags(
  body: string,
  tag: string,
  build: (attrs: Record<string, string>) => AttachmentItem | null,
  items: AttachmentItem[]
): boolean {
  const re = emptyTagRe(tag);
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const attrs = parseAttrsStrict(m[1]);
    if (!attrs) return false;
    const item = build(attrs);
    if (!item) return false;
    items.push(item);
  }
  return body.replace(re, '').trim() === '';
}

// 解析 content 开头的合法块；不匹配 / 结构残缺 / 属性非法一律返回 null（渲染方按
// 现状原样渲染，spec「非开头或残缺 XML 原样渲染」）。
export function parseAdditionalContext(content: string): ParsedAdditionalContext | null {
  // 惰性内层停在第一个闭合标签：正文里若再出现同形闭合标签，属于 rest，不影响本块。
  const m = /^\s*<additional_context>([\s\S]*?)<\/additional_context>([\s\S]*)$/.exec(content);
  if (!m) return null;

  let remaining = m[1];
  const items: AttachmentItem[] = [];
  const references: QuotedReference[] = [];

  // quoted_context 是唯一的引用容器；内部 quotes 按 turn/role 分组，quote 在分组内编号。
  // 先摘除整个容器，再校验剩余节点只属于下方三个 section。未知标签仍会让整块原样渲染。
  const wrapperMatches = remaining.match(/<quoted_context\b/g);
  if (wrapperMatches && wrapperMatches.length > 1) return null;
  const wrapperRe = /<quoted_context>([\s\S]*?)<\/quoted_context>/;
  const wm = wrapperRe.exec(remaining);
  if (wm) {
    const wrapperBody = wm[1];
    let hasQuotes = false;
    const quotesRe = /<quotes\b([^>]*?)>([\s\S]*?)<\/quotes>/g;
    let qm: RegExpExecArray | null;
    while ((qm = quotesRe.exec(wrapperBody)) !== null) {
      hasQuotes = true;
      const groupAttrs = parseAttrsStrict(qm[1]);
      const rawTurn = groupAttrs?.turn;
      const turn = rawTurn === undefined ? Number.NaN : Number(rawTurn);
      if (
        !groupAttrs ||
        (groupAttrs.role !== 'user' && groupAttrs.role !== 'agent') ||
        groupAttrs.type !== 'fragments' ||
        rawTurn === undefined ||
        !/^\d+$/.test(rawTurn) ||
        !Number.isSafeInteger(turn) ||
        turn < 1
      ) {
        return null;
      }

      const quoteIds = new Set<number>();
      let hasQuote = false;
      const quoteRe = /<quote\b([^>]*?)>([\s\S]*?)<\/quote>/g;
      let im: RegExpExecArray | null;
      while ((im = quoteRe.exec(qm[2])) !== null) {
        hasQuote = true;
        const quoteAttrs = parseAttrsStrict(im[1]);
        const rawId = quoteAttrs?.id;
        const id = rawId === undefined ? Number.NaN : Number(rawId);
        const text = unescapeXml(im[2]).trim();
        if (
          !quoteAttrs ||
          rawId === undefined ||
          !/^\d+$/.test(rawId) ||
          !Number.isSafeInteger(id) ||
          id < 1 ||
          quoteIds.has(id) ||
          text === ''
        ) {
          return null;
        }
        quoteIds.add(id);
        references.push({ turn, role: groupAttrs.role, text });
      }
      // 空引用分组会让 quoted_context 成为无意义节点。
      if (!hasQuote) return null;
    }
    if (!hasQuotes || references.length === 0) return null;
    // wrapper 内 quotes 标签之外只允许空白；容器之外也不得再出现同形标签。
    if (wrapperBody.replace(quotesRe, '').trim() !== '') return null;
    if (remaining.replace(wm[0], '').includes('<quoted_context')) return null;
    remaining = remaining.replace(wm[0], '');
  }

  // 三个 section 任意顺序、各至多一次（重复出现的第二次会留在 remaining 中，
  // 被末尾的空白校验判非法）；某个 section 缺失即跳过（spec「空 section 省略」）。
  const sectionRes = ['attachments', 'skills', 'mcps'].map(
    (name) => ({ name, re: new RegExp(`<${name}>([\\s\\S]*?)</${name}>`) })
  );
  const bodies = new Map<string, string>();
  for (const { name, re } of sectionRes) {
    const sm = re.exec(remaining);
    if (!sm) continue;
    bodies.set(name, sm[1]);
    remaining = remaining.replace(sm[0], '');
  }
  if (remaining.trim() !== '') return null;

  const attachments = bodies.get('attachments');
  if (attachments !== undefined && !collectAttachments(attachments, items)) return null;
  const skills = bodies.get('skills');
  if (
    skills !== undefined &&
    !collectEmptyTags(
      skills,
      'skill',
      (attrs) => (attrs.name ? { kind: 'skill', name: attrs.name } : null),
      items
    )
  ) {
    return null;
  }
  const mcps = bodies.get('mcps');
  if (
    mcps !== undefined &&
    !collectEmptyTags(
      mcps,
      'mcp',
      (attrs) =>
        attrs.tool_name && attrs.server
          ? { kind: 'mcp', name: attrs.tool_name, server: attrs.server }
          : null,
      items
    )
  ) {
    return null;
  }

  if (items.length === 0 && references.length === 0) return null;
  return { items: dedupeItems(items), references: dedupeReferences(references), rest: m[2] };
}
