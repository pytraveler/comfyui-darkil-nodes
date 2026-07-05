// Pure grammar/tokenizer for the darkilPromptBuilder mini-language.
// No DOM / ComfyUI imports so it can be unit-tested in Node. Mirrors the backend
// grammar in nodes/text/prompt_builder.py + nodes/text/utilities.py exactly.
// User-facing strings live in prompt_builder_i18n.js; EN is the default here.

import { getStrings } from "./prompt_builder_i18n.js";

const EN = getStrings("en");

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

// Directive canonical name -> { aliases }. Mirrors _DIRECTIVE_FUNCS.
export const DIRECTIVES = {
    spaceless:         { aliases: ["sl"] },
    lower:             { aliases: ["lw"] },
    upper:             { aliases: ["up"] },
    title:             { aliases: ["tl"] },
    sentence:          { aliases: ["snt"] },
    trim:              { aliases: ["tr"] },
    dedent:            { aliases: ["dd"] },
    collapse_newlines: { aliases: ["cnl"] },
    strip_punct:       { aliases: ["sp"] },
    unescape_html:     { aliases: ["uneh"] },
    list:              { aliases: ["cl"] },
    list_rtrim:        { aliases: ["clr"] },
    list_and:          { aliases: ["la"] },
};

// Every directive token (name AND alias) -> { canonical, desc } (EN desc).
export const DIRECTIVE_LOOKUP = (() => {
    const map = {};
    for (const [name, info] of Object.entries(DIRECTIVES)) {
        map[name] = { canonical: name, desc: EN.dir[name] };
        for (const a of info.aliases) map[a] = { canonical: name, desc: EN.dir[name] };
    }
    return map;
})();

// Placeholder TYPE alias groups (mirrors the arrays in simple_prompt_builder.js).
export const TYPE_GROUPS = {
    combo:   { aliases: ["COMBO", "CMB", "SELECT", "SEL"] },
    bool:    { aliases: ["B", "BOOL", "BOOLEAN", "FLAG", "FLG", "CHECK"] },
    int:     { aliases: ["INT", "INTEGER", "NUM", "NUMBER"] },
    float:   { aliases: ["REAL", "FLOAT", "REAL1", "FLOAT1", "REAL2", "FLOAT2", "REAL3", "FLOAT3", "REAL4", "FLOAT4", "REAL5", "FLOAT5"] },
    slider:  { aliases: ["SLIDER", "SLIDER1", "SLIDER2", "SLIDER3", "SLIDER4", "SLIDER5"] },
    knob:    { aliases: ["KNOB", "KNOB1", "KNOB2", "KNOB3", "KNOB4", "KNOB5"] },
};

export const TYPE_LOOKUP = (() => {
    const map = {};
    for (const [kind, info] of Object.entries(TYPE_GROUPS)) {
        for (const a of info.aliases) map[a] = { kind, desc: EN.typeDesc[kind] };
    }
    return map;
})();

// Names that clash with the node's own widgets / backend-reserved keys, so a
// placeholder or toggle must not use them (mirrors reserved words + widget names
// in prompt_builder.py / simple_prompt_builder.js).
export const RESERVED_NAMES = new Set([
    "prompt", "compiled_prompt", "extra_compiled", "cachedValues",
    "promptTextActive", "extraActive", "promptVisible", "COMFY_LOCALE_SETTING",
]);

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------
// Emits only the special (delimiter/atomic) tokens with source ranges; the
// renderer fills the gaps with plain text. Token families:
//   placeholder | directiveOpen | directiveClose | toggleOpen | toggleClose
//   blockOpen | blockClose | comment
// Delimiters are highlighted; wrapped content is tokenized independently, so a
// placeholder inside a directive/toggle still lights up. Comments are atomic and
// take precedence (backend strips them first).

const RE = {
    blockComment: /\/\*[\s\S]*?\*\//y,
    lineComment:  /\/\/.*/y,
    hashComment:  /#.*/y,
    placeholder:  /\{\{[^{}]*\}\}/y,
    directive:    /\{%([a-zA-Z_]+)( stop)?%\}/y,
    toggle:       /\[\[(\/)?([^\]:/[]+)(?::([^\]\[]+))?\]\]/y,
    block:        /\[%(\/)?(extra|vars)%\]/y,
};

function stickyMatch(re, text, i) {
    re.lastIndex = i;
    return re.exec(text);
}

export function tokenize(text) {
    const tokens = [];
    if (!text) return tokens;
    const n = text.length;
    let i = 0;

    while (i < n) {
        const ch = text[i];
        const prev = i > 0 ? text[i - 1] : "\n";
        let m;

        if (ch === "/" && text[i + 1] === "*") {
            m = stickyMatch(RE.blockComment, text, i);
            if (m) { tokens.push({ type: "comment", start: i, end: i + m[0].length }); i += m[0].length; continue; }
        }
        if (ch === "/" && text[i + 1] === "/" && (i === 0 || /\s/.test(prev))) {
            m = stickyMatch(RE.lineComment, text, i);
            tokens.push({ type: "comment", start: i, end: i + m[0].length }); i += m[0].length; continue;
        }
        if (ch === "#" && (i === 0 || prev === "\n")) {
            m = stickyMatch(RE.hashComment, text, i);
            tokens.push({ type: "comment", start: i, end: i + m[0].length }); i += m[0].length; continue;
        }
        if (ch === "{" && text[i + 1] === "{") {
            m = stickyMatch(RE.placeholder, text, i);
            if (m) { tokens.push({ type: "placeholder", start: i, end: i + m[0].length, meta: parsePlaceholderFields(m[0]) }); i += m[0].length; continue; }
        }
        if (ch === "{" && text[i + 1] === "%") {
            m = stickyMatch(RE.directive, text, i);
            if (m) {
                const name = m[1];
                const isClose = !!m[2];
                const known = Object.prototype.hasOwnProperty.call(DIRECTIVE_LOOKUP, name);
                tokens.push({ type: isClose ? "directiveClose" : "directiveOpen", start: i, end: i + m[0].length, meta: { name, known } });
                i += m[0].length; continue;
            }
        }
        if (ch === "[" && text[i + 1] === "[") {
            m = stickyMatch(RE.toggle, text, i);
            if (m) {
                const isClose = !!m[1];
                tokens.push({ type: isClose ? "toggleClose" : "toggleOpen", start: i, end: i + m[0].length, meta: { name: m[2], group: m[3] } });
                i += m[0].length; continue;
            }
        }
        if (ch === "[" && text[i + 1] === "%") {
            m = stickyMatch(RE.block, text, i);
            if (m) {
                const isClose = !!m[1];
                tokens.push({ type: isClose ? "blockClose" : "blockOpen", start: i, end: i + m[0].length, meta: { name: m[2] } });
                i += m[0].length; continue;
            }
        }

        i += 1;
    }

    return tokens;
}

// Parse the inside of a matched {{...}} for caret help. Mirrors parsePlaceholders'
// USE_INPUT rule but tolerant (used for hints only).
const BOOL_LIKE = new Set(["true", "false", "yes", "no", "on", "off", "1", "0", "+", "t", "check"]);

export function parsePlaceholderFields(raw) {
    const inner = raw.slice(2, -2);
    const parts = inner.split(":");
    if (parts.length <= 2) return { name: parts[0]?.trim() ?? "", short: true, fields: parts.length };
    const name = parts[0].trim();
    const type = (parts[1] || "STRING").trim();
    const value = (parts[2] || "").trim();
    let def, useInput;
    if (parts.length >= 5 && BOOL_LIKE.has(parts[parts.length - 1].trim().toLowerCase())) {
        useInput = parts[parts.length - 1].trim();
        def = parts.slice(3, -1).join(":").trim();
    } else {
        def = parts.slice(3).join(":").trim();
        useInput = "false";
    }
    return { name, type, value, def, useInput, short: false, fields: parts.length };
}

// ---------------------------------------------------------------------------
// Caret-context help
// ---------------------------------------------------------------------------

export function describeAt(text, index, L = EN) {
    const tokens = tokenize(text);
    for (const t of tokens) {
        if (index >= t.start && index <= t.end) return describeToken(t, L);
    }
    return "";
}

export function describeToken(t, L = EN) {
    switch (t.type) {
        case "placeholder": {
            const f = t.meta || {};
            if (f.short) return L.d.phShort(f.name);
            const ti = TYPE_LOOKUP[(f.type || "").toUpperCase()];
            const kind = ti ? L.typeDesc[ti.kind] : L.typeDesc.string;
            const socket = f.useInput && BOOL_LIKE.has(f.useInput.toLowerCase()) && /^(true|yes|on|1|\+|t|check)$/i.test(f.useInput) ? L.d.socket() : "";
            return L.d.phFull(f.name, f.type, kind, socket);
        }
        case "directiveOpen":
        case "directiveClose": {
            const d = DIRECTIVE_LOOKUP[t.meta.name];
            if (!d) return L.d.directiveUnknown(t.meta.name);
            return L.d.directive(d.canonical, t.type === "directiveClose", L.dir[d.canonical]);
        }
        case "toggleOpen":
            return L.d.toggleOpen(t.meta.name, t.meta.group);
        case "toggleClose":
            return L.d.toggleClose(t.meta.name);
        case "blockOpen":
            return t.meta.name === "extra" ? L.d.blockExtra() : L.d.blockVars();
        case "blockClose":
            return L.d.blockClose(t.meta.name);
        case "comment":
            return L.d.comment();
        default:
            return "";
    }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validate(text, L = EN) {
    const problems = [];
    if (!text) return problems;
    const tokens = tokenize(text);
    const v = L.v;

    // Pair openers/closers for toggles, blocks, directives.
    const toggleStack = [];
    const blockStack = [];
    const directiveStack = [];

    for (const t of tokens) {
        if (t.type === "toggleOpen") {
            toggleStack.push(t);
            if (RESERVED_NAMES.has(t.meta.name)) problems.push({ start: t.start, end: t.end, severity: "reserved", message: v.reservedTag(t.meta.name) });
        }
        else if (t.type === "toggleClose") {
            const idx = findLast(toggleStack, o => o.meta.name === t.meta.name);
            if (idx === -1) problems.push({ start: t.start, end: t.end, severity: "error", message: v.closeNoOpenToggle(t.meta.name) });
            else toggleStack.splice(idx, 1);
        } else if (t.type === "blockOpen") blockStack.push(t);
        else if (t.type === "blockClose") {
            const idx = findLast(blockStack, o => o.meta.name === t.meta.name);
            if (idx === -1) problems.push({ start: t.start, end: t.end, severity: "error", message: v.closeNoOpenBlock(t.meta.name) });
            else blockStack.splice(idx, 1);
        } else if (t.type === "directiveOpen") {
            if (!t.meta.known) problems.push({ start: t.start, end: t.end, severity: "error", message: v.unknownDirective(t.meta.name) });
            else directiveStack.push(t);
        } else if (t.type === "directiveClose") {
            if (!t.meta.known) { problems.push({ start: t.start, end: t.end, severity: "error", message: v.unknownDirective(t.meta.name) }); continue; }
            const idx = findLast(directiveStack, o => o.meta.name === t.meta.name);
            if (idx === -1) problems.push({ start: t.start, end: t.end, severity: "error", message: v.stopNoOpen(t.meta.name) });
            else directiveStack.splice(idx, 1);
        } else if (t.type === "placeholder") {
            const f = t.meta;
            if (!f.short && f.fields < 4) problems.push({ start: t.start, end: t.end, severity: "warn", message: v.phFields() });
            if (f.name && RESERVED_NAMES.has(f.name)) problems.push({ start: t.start, end: t.end, severity: "reserved", message: v.reservedPh(f.name) });
        }
    }

    for (const o of toggleStack) problems.push({ start: o.start, end: o.end, severity: "error", message: v.unclosedToggle(o.meta.name) });
    for (const o of blockStack) problems.push({ start: o.start, end: o.end, severity: "error", message: v.unclosedBlock(o.meta.name) });
    for (const o of directiveStack) problems.push({ start: o.start, end: o.end, severity: "error", message: v.unclosedDirective(o.meta.name) });

    // Unclosed atomic openers not consumed as a token.
    scanUnclosed(text, tokens, "{{", "}}", problems, v.unclosedPlaceholder());
    scanUnclosed(text, tokens, "/*", "*/", problems, v.unclosedComment());

    return problems;
}

function scanUnclosed(text, tokens, open, close, problems, message) {
    let from = 0;
    while (true) {
        const at = text.indexOf(open, from);
        if (at === -1) break;
        from = at + open.length;
        if (tokens.some(t => t.start <= at && at < t.end)) continue; // already inside a real token
        if (text.indexOf(close, at + open.length) === -1) {
            problems.push({ start: at, end: Math.min(text.length, at + open.length), severity: "error", message });
            break;
        }
    }
}

function findLast(arr, pred) {
    for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) return i;
    return -1;
}

// ---------------------------------------------------------------------------
// Rendering (pure -> HTML string, testable)
// ---------------------------------------------------------------------------

const TOKEN_CLASS = {
    placeholder: "spb-tok-ph",
    directiveOpen: "spb-tok-dir",
    directiveClose: "spb-tok-dir",
    toggleOpen: "spb-tok-tag",
    toggleClose: "spb-tok-tag",
    blockOpen: "spb-tok-block",
    blockClose: "spb-tok-block",
    comment: "spb-tok-comment",
};

export function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderHighlightHTML(text, problems = []) {
    const tokens = tokenize(text);
    let html = "";
    let pos = 0;
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.start > pos) html += escapeHtml(text.slice(pos, t.start));
        const hasReserved = problems.some(p => p.severity === "reserved" && p.start < t.end && p.end > t.start);
        const hasErr = problems.some(p => p.severity === "error" && p.start < t.end && p.end > t.start);
        let cls = TOKEN_CLASS[t.type];
        if (hasReserved) cls += " spb-tok-reserved";
        else if (hasErr) cls += " spb-tok-error";
        html += `<span class="${cls}" data-ti="${i}">${escapeHtml(text.slice(t.start, t.end))}</span>`;
        pos = t.end;
    }
    if (pos < text.length) html += escapeHtml(text.slice(pos));
    return html;
}

// ---------------------------------------------------------------------------
// Insert-palette snippets.
// Template markers:
//   {name:default} — an identifier slot; filled from a single-word selection,
//                    else `default`. Repeated markers with the same text stay in
//                    sync (e.g. a toggle open + close tag).
//   {body}         — a content slot; filled from a multi-word (prose) selection.
//   {cursor}       — explicit final caret position (zero-width).
// ---------------------------------------------------------------------------

export const SNIPPETS = {
    placeholders: [
        { label: "String",  template: "{{{name:myvar}:STRING:{cursor}:default:false}}" },
        { label: "Integer", template: "{{{name:count}:INT:0:100:false}}" },
        { label: "Float",   template: "{{{name:scale}:FLOAT2:0:1:false}}" },
        { label: "Combo",   template: "{{{name:choice}:COMBO:optionA;optionB;optionC:optionA:false}}" },
        { label: "Slider",  template: "{{{name:strength}:SLIDER2:0:1:false}}" },
        { label: "Knob",    template: "{{{name:value}:KNOB2:0:1:false}}" },
        { label: "Boolean", template: "{{{name:enabled}:BOOL:true:false:false}}" },
    ],
    toggles: [
        { label: "Toggle",          template: "[[{name:tag}]]{body}[[/{name:tag}]]" },
        { label: "Grouped (radio)", template: "[[{name:option}:group]]{body}[[/{name:option}]]" },
    ],
    blocks: [
        { label: "Extra block", template: "[%extra%]\n{body}\n[%/extra%]" },
        { label: "Vars block",  template: "[%vars%]\n{body}\n[%/vars%]" },
    ],
    comment: { label: "Comment", template: "// {body}" },
};

// Directive snippets, generated from the canonical names (EN desc; the editor
// re-localizes the description at render time).
export const DIRECTIVE_SNIPPETS = Object.keys(DIRECTIVES).map(name => ({
    label: name,
    desc: EN.dir[name],
    template: `{%${name}%}{body}{%${name} stop%}`,
}));

const INSERT_MARKER = /\{(name:[^}]*|body|cursor)\}/g;

// Is a selection a single "word" usable as an identifier (no spaces/delimiters)?
export function isIdentifierLike(sel) {
    const t = (sel || "").trim();
    return t.length > 0 && !/[\s{}[\]:%|]/.test(t);
}

// Build an insertion from a template + current selection text.
// Returns { text, selStart, selEnd } (offsets within `text`).
export function buildInsertion(template, selectedText) {
    const sel = selectedText || "";
    const word = isIdentifierLike(sel) ? sel.trim() : null;
    let out = "";
    let last = 0;
    let nameStart = -1, nameEnd = -1, bodyStart = -1, bodyEnd = -1, cursorPos = -1;

    INSERT_MARKER.lastIndex = 0;
    let m;
    while ((m = INSERT_MARKER.exec(template)) !== null) {
        out += template.slice(last, m.index);
        last = m.index + m[0].length;
        const tok = m[1];
        if (tok.startsWith("name:")) {
            const def = tok.slice(5);
            const name = word || def;
            if (nameStart === -1) { nameStart = out.length; nameEnd = out.length + name.length; }
            out += name;
        } else if (tok === "body") {
            bodyStart = out.length;
            out += word ? "" : sel;
            bodyEnd = out.length;
        } else if (tok === "cursor") {
            cursorPos = out.length;
        }
    }
    out += template.slice(last);

    let selStart, selEnd;
    if (!word && nameStart !== -1) {
        selStart = nameStart; selEnd = nameEnd;          // no selection -> let user name it
    } else if (bodyStart !== -1) {
        selStart = bodyStart; selEnd = bodyEnd;          // prose -> land in the body
    } else if (cursorPos !== -1) {
        selStart = selEnd = cursorPos;
    } else {
        selStart = selEnd = out.length;
    }
    return { text: out, selStart, selEnd };
}

// A bare reference to an already-declared variable: {{name}}.
export function variableReference(name) {
    return `{{${name}}}`;
}

// ---------------------------------------------------------------------------
// Autocomplete (pure, testable). Context = what construct is being typed at
// the caret; suggestions = matching completions; buildCompletion = the exact
// text replacement to apply.
// ---------------------------------------------------------------------------

export function autocompleteContext(text, caret) {
    const before = text.slice(0, caret);
    let m = /\{\{([A-Za-z0-9_]*)$/.exec(before);
    if (m) return { kind: "placeholder", prefix: m[1], start: caret - m[1].length };
    m = /\{%([a-z_]*)$/i.exec(before);
    if (m) return { kind: "directive", prefix: m[1], start: caret - m[1].length };
    m = /\[\[\/([^\][:/]*)$/.exec(before);
    if (m) return { kind: "toggleClose", prefix: m[1], start: caret - m[1].length };
    m = /\[\[([^\][:/]*)$/.exec(before);
    if (m) return { kind: "toggle", prefix: m[1], start: caret - m[1].length };
    m = /\[%\/?([a-z]*)$/.exec(before);
    if (m) return { kind: "block", prefix: m[1], start: caret - m[1].length };
    return null;
}

export function autocompleteSuggestions(text, ctx, L = EN) {
    if (!ctx) return [];
    const pfx = (ctx.prefix || "").toLowerCase();
    if (ctx.kind === "placeholder") {
        return collectVariables(text)
            .filter(n => n.toLowerCase().startsWith(pfx))
            .map(n => ({ label: `{{${n}}}`, value: n, desc: "" }));
    }
    if (ctx.kind === "directive") {
        return Object.keys(DIRECTIVE_LOOKUP)
            .filter(n => n.startsWith(pfx))
            .map(n => ({ label: n, value: n, desc: L.dir[DIRECTIVE_LOOKUP[n].canonical] }));
    }
    if (ctx.kind === "toggle" || ctx.kind === "toggleClose") {
        const names = [];
        const seen = new Set();
        for (const t of tokenize(text)) {
            if (t.type === "toggleOpen" && t.meta.name && !seen.has(t.meta.name)) {
                seen.add(t.meta.name);
                names.push(t.meta.name);
            }
        }
        return names
            .filter(n => n.toLowerCase().startsWith(pfx))
            .map(n => ({ label: `[[${ctx.kind === "toggleClose" ? "/" : ""}${n}]]`, value: n, desc: "" }));
    }
    if (ctx.kind === "block") {
        return ["extra", "vars"]
            .filter(n => n.startsWith(pfx))
            .map(n => ({ label: `[%${n}%]`, value: n, desc: "" }));
    }
    return [];
}

export function buildCompletion(text, caret, ctx, value) {
    const after = text.slice(caret);
    let insert, caretTo;
    if (ctx.kind === "placeholder") {
        insert = after.startsWith("}}") ? value : value + "}}";
        caretTo = ctx.start + value.length + 2;
    } else if (ctx.kind === "directive") {
        const stop = `{%${value} stop%}`;
        if (after.includes(stop)) {
            insert = after.startsWith("%}") ? value : value + "%}";
            caretTo = ctx.start + value.length + 2;
        } else {
            insert = `${value}%}${stop}`;
            caretTo = ctx.start + value.length + 2;
        }
    } else if (ctx.kind === "toggle") {
        const close = `[[/${value}]]`;
        if (after.includes(close)) {
            insert = after.startsWith("]]") ? value : value + "]]";
        } else {
            insert = `${value}]]${close}`;
        }
        caretTo = ctx.start + value.length + 2;
    } else if (ctx.kind === "toggleClose") {
        insert = after.startsWith("]]") ? value : value + "]]";
        caretTo = ctx.start + value.length + 2;
    } else if (ctx.kind === "block") {
        insert = after.startsWith("%]") ? value : value + "%]";
        caretTo = ctx.start + value.length + 2;
    } else {
        insert = value;
        caretTo = ctx.start + value.length;
    }
    return { start: ctx.start, end: caret, insert, caretTo };
}

// Collect declared placeholder names (full form) from the text, for the Vars menu.
export function collectVariables(text) {
    const names = [];
    const seen = new Set();
    for (const t of tokenize(text)) {
        if (t.type === "placeholder" && t.meta && !t.meta.short && t.meta.name && !seen.has(t.meta.name)) {
            seen.add(t.meta.name);
            names.push(t.meta.name);
        }
    }
    return names;
}
