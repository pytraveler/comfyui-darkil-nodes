// Syntax-highlighting overlay for the darkilPromptBuilder "prompt" textarea.
// Augments the existing STRING widget's <textarea> in place (transparent text +
// highlight backdrop + a header toolbar + a caret-context help strip) so the
// original widget stays the sole owner of value/serialization/callback/restore.

import {
    tokenize,
    validate,
    describeAt,
    describeToken,
    renderHighlightHTML,
    buildInsertion,
    variableReference,
    collectVariables,
    autocompleteContext,
    autocompleteSuggestions,
    buildCompletion,
    SNIPPETS,
    DIRECTIVE_SNIPPETS,
} from "./prompt_builder_grammar.js";
import { getStrings } from "./prompt_builder_i18n.js";

const STYLE_ID = "darkil-spb-editor-style";
const HEADER_H = 22;
const HELP_H = 20;

const LEGEND_KEYS = [
    ["spb-tok-ph", "ph"],
    ["spb-tok-tag", "tag"],
    ["spb-tok-dir", "dir"],
    ["spb-tok-block", "block"],
    ["spb-tok-comment", "comment"],
    ["spb-tok-reserved", "reserved"],
];

function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
.spb-ed-backdrop{
    position:absolute; inset:0; margin:0; overflow:hidden;
    white-space:pre-wrap; word-break:break-word; pointer-events:none;
    color:#c9d1d9; background:transparent; z-index:0;
}
.spb-ed-host{ position:relative; }
.spb-ed-host textarea{ position:relative; z-index:1; background:transparent !important; }
.spb-tok-ph{ color:#4aa3df; }
.spb-tok-tag{ color:#5bbf6a; }
.spb-tok-dir{ color:#c08be6; }
.spb-tok-block{ color:#e0913a; }
.spb-tok-comment{ color:#7d8a99; font-style:italic; }
.spb-tok-error{ text-decoration:underline wavy #e0533a; text-underline-offset:2px; }
.spb-tok-reserved{ color:#e0533a; text-decoration:line-through; }
.spb-ed-header{
    position:absolute; top:0; left:0; right:0; z-index:3; box-sizing:border-box;
    display:flex; gap:4px; align-items:center; justify-content:flex-end;
    padding:2px 6px; min-height:${HEADER_H}px;
    background:rgba(20,22,26,0.92); border-bottom:1px solid #333a44;
    pointer-events:auto; font:11px/1.4 sans-serif;
}
.spb-ed-title{ margin-right:auto; color:#6e7681; font-size:10px; text-transform:uppercase; letter-spacing:.05em; }
.spb-ed-btn{
    background:#2b2f36; color:#c9d1d9; border:1px solid #444c56; border-radius:4px;
    padding:1px 7px; cursor:pointer; user-select:none; font:inherit;
}
.spb-ed-btn:hover{ background:#3a404a; }
.spb-ed-help{
    position:absolute; left:0; right:0; bottom:0; z-index:3; box-sizing:border-box;
    padding:2px 8px; min-height:${HELP_H - 2}px; font:11px/1.4 sans-serif;
    color:#9aa5b1; background:rgba(20,22,26,0.82); border-top:1px solid #333a44;
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis; pointer-events:none;
}
.spb-ed-help.spb-ed-warn{ color:#e0a04a; }
.spb-ed-pop{
    position:absolute; z-index:20; top:${HEADER_H + 2}px; right:3px; max-height:280px; overflow:auto;
    background:#22262c; border:1px solid #444c56; border-radius:6px; padding:4px 0;
    box-shadow:0 6px 18px rgba(0,0,0,0.45); font:12px/1.5 sans-serif; min-width:180px;
    pointer-events:auto;
}
.spb-ed-pop .sec{ padding:3px 10px 1px; color:#6e7681; text-transform:uppercase; font-size:10px; letter-spacing:.05em; }
.spb-ed-pop .item{ padding:3px 12px; color:#c9d1d9; cursor:pointer; white-space:nowrap; }
.spb-ed-pop .item:hover{ background:#31363f; }
.spb-ed-pop .item small{ color:#7d8a99; margin-left:6px; }
.spb-ed-pop .muted{ padding:3px 12px; color:#6e7681; font-style:italic; }
.spb-ed-legrow{ display:flex; align-items:center; gap:6px; padding:2px 12px; white-space:nowrap; }
.spb-ed-legrow i{ width:10px; height:10px; border-radius:2px; display:inline-block; background:currentColor; }
.spb-ed-tip{
    position:absolute; z-index:25; max-width:380px; pointer-events:none; display:none;
    background:#22262c; border:1px solid #444c56; border-radius:5px; padding:4px 8px;
    box-shadow:0 4px 14px rgba(0,0,0,0.45); font:11px/1.5 sans-serif; color:#c9d1d9;
    white-space:normal;
}
.spb-ed-ac{
    position:absolute; z-index:30; max-height:200px; overflow:auto; display:none;
    background:#22262c; border:1px solid #444c56; border-radius:6px; padding:3px 0;
    box-shadow:0 6px 18px rgba(0,0,0,0.45); font:12px/1.5 sans-serif; min-width:160px;
    pointer-events:auto;
}
.spb-ed-ac .item{ padding:2px 10px; color:#c9d1d9; cursor:pointer; white-space:nowrap; }
.spb-ed-ac .item.sel{ background:#314560; }
.spb-ed-ac .item:hover{ background:#31363f; }
.spb-ed-ac .item small{ color:#7d8a99; margin-left:6px; }
@media (prefers-color-scheme: light){
    .spb-ed-backdrop{ color:#1f2328; }
    .spb-tok-ph{ color:#0a66c2; } .spb-tok-tag{ color:#2f8a3f; } .spb-tok-dir{ color:#8250df; }
    .spb-tok-block{ color:#bc4c00; } .spb-tok-comment{ color:#6e7781; } .spb-tok-reserved{ color:#cf222e; }
    .spb-ed-btn{ background:#eef1f4; color:#1f2328; border-color:#d0d7de; }
    .spb-ed-btn:hover{ background:#e2e6ea; }
    .spb-ed-header{ background:rgba(246,248,250,0.95); border-bottom-color:#d0d7de; }
    .spb-ed-help{ color:#57606a; background:rgba(246,248,250,0.9); border-top-color:#d0d7de; }
    .spb-ed-pop, .spb-ed-tip, .spb-ed-ac{ background:#ffffff; border-color:#d0d7de; color:#1f2328; }
    .spb-ed-pop .item, .spb-ed-ac .item{ color:#1f2328; }
    .spb-ed-pop .item:hover, .spb-ed-ac .item:hover{ background:#f0f3f6; }
    .spb-ed-ac .item.sel{ background:#d8e6f6; }
}`;
    document.head.appendChild(style);
}

const COPIED_STYLES = [
    "fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "letterSpacing",
    "textTransform", "tabSize", "paddingTop", "paddingRight", "paddingLeft", "paddingBottom", "textIndent",
];

function syncBackdropStyle(ta, backdrop) {
    const cs = getComputedStyle(ta);
    for (const p of COPIED_STYLES) backdrop.style[p] = cs[p];
}

function escapeText(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// The DOM-widget wrapper is scaled with CSS transform (canvas zoom), so screen
// (client) coordinates must be converted into the wrapper's local space before
// being used for absolutely-positioned children.
function localPoint(wrapper, clientX, clientY) {
    const wr = wrapper.getBoundingClientRect();
    const scale = wrapper.offsetWidth ? (wr.width / wrapper.offsetWidth) : 1;
    return {
        x: (clientX - wr.left) / scale,
        y: (clientY - wr.top) / scale,
        scale,
    };
}

// Find the (textNode, offset) pair at a character index inside the backdrop and
// return its caret rect, or null when unavailable (non-browser environments).
function rectAtIndex(backdrop, index) {
    if (typeof document.createRange !== "function" || !backdrop.childNodes) return null;
    let remaining = index;
    const walk = (el) => {
        for (const n of el.childNodes) {
            if (n.nodeType === 3) {
                const len = n.textContent.length;
                if (remaining <= len) return { node: n, offset: remaining };
                remaining -= len;
            } else if (n.childNodes && n.childNodes.length) {
                const r = walk(n);
                if (r) return r;
            }
        }
        return null;
    };
    const found = walk(backdrop);
    if (!found) return null;
    try {
        const range = document.createRange();
        range.setStart(found.node, found.offset);
        range.setEnd(found.node, found.offset);
        return range.getBoundingClientRect();
    } catch (e) {
        return null;
    }
}

// ---------------------------------------------------------------------------

export function attachSyntaxEditor(node, promptWidget, opts = {}) {
    ensureStyles();

    const L = getStrings(opts.locale);

    const state = {
        visible: true, ta: null, backdrop: null, header: null, help: null,
        pop: null, docHandler: null, tries: 0,
        tokens: [], tip: null, ac: null, acItems: [], acSel: 0, acCtx: null,
    };

    function render() {
        const { ta, backdrop } = state;
        if (!ta || !backdrop) return;
        if (backdrop.parentElement !== ta.parentElement) ta.parentElement.appendChild(backdrop);
        const text = ta.value ?? "";
        const problems = validate(text, L);
        const shown = text + "\n";
        state.tokens = tokenize(shown);
        backdrop.innerHTML = renderHighlightHTML(shown, problems);
        backdrop.scrollTop = ta.scrollTop;
        backdrop.scrollLeft = ta.scrollLeft;
        updateHelp(problems);
    }

    function updateHelp(problems) {
        const { ta, help } = state;
        if (!ta || !help) return;
        const idx = ta.selectionStart ?? 0;
        const desc = describeAt(ta.value ?? "", idx, L);
        if (desc) {
            help.textContent = desc;
            help.classList.remove("spb-ed-warn");
            return;
        }
        const probs = problems || validate(ta.value ?? "", L);
        const issues = probs.filter(p => p.severity === "error" || p.severity === "reserved");
        if (issues.length) {
            help.textContent = L.ui.issues(issues.length, issues[0].message);
            help.classList.add("spb-ed-warn");
        } else {
            help.textContent = opts.hint || L.ui.hint;
            help.classList.remove("spb-ed-warn");
        }
    }

    function applyInsertion(finalText, selStart, selEnd) {
        const { ta } = state;
        if (!ta) return;
        const s = ta.selectionStart ?? ta.value.length;
        const e = ta.selectionEnd ?? s;
        ta.focus();
        if (typeof ta.setRangeText === "function") ta.setRangeText(finalText, s, e, "end");
        else ta.value = ta.value.slice(0, s) + finalText + ta.value.slice(e);
        ta.selectionStart = s + selStart;
        ta.selectionEnd = s + selEnd;
        ta.dispatchEvent(new Event("input", { bubbles: true }));
        render();
    }

    function insert(template) {
        const { ta } = state;
        if (!ta) return;
        const s = ta.selectionStart ?? ta.value.length;
        const e = ta.selectionEnd ?? s;
        const selected = ta.value.slice(s, e);
        const { text, selStart, selEnd } = buildInsertion(template, selected);
        applyInsertion(text, selStart, selEnd);
    }

    function insertVar(name) {
        const ref = variableReference(name);
        applyInsertion(ref, ref.length, ref.length);
    }

    function closePopup() {
        if (state.pop) { state.pop.remove(); state.pop = null; }
        if (state.docHandler) { document.removeEventListener("mousedown", state.docHandler); state.docHandler = null; }
    }

    function makePopup() {
        closePopup();
        hideAutocomplete();
        const pop = document.createElement("div");
        pop.className = "spb-ed-pop";
        // Attach to the wrapper (not the header) so it stacks above the help strip.
        (state.ta?.parentElement || state.header).appendChild(pop);
        state.pop = pop;
        state.docHandler = (ev) => {
            if (state.pop && !state.pop.contains(ev.target) && !state.header.contains(ev.target)) closePopup();
        };
        document.addEventListener("mousedown", state.docHandler);
        return pop;
    }

    function addSection(pop, title) { const d = document.createElement("div"); d.className = "sec"; d.textContent = title; pop.appendChild(d); }
    function addItem(pop, label, desc, onPick) {
        const d = document.createElement("div");
        d.className = "item";
        d.innerHTML = `${escapeText(label)}${desc ? `<small>${escapeText(desc)}</small>` : ""}`;
        d.addEventListener("mousedown", (ev) => { ev.preventDefault(); onPick(); closePopup(); });
        pop.appendChild(d);
    }

    const snipLabel = (label) => L.ui.snip[label] || label;

    function openInsertMenu() {
        const pop = makePopup();
        addSection(pop, L.ui.sec.placeholder);
        for (const s of SNIPPETS.placeholders) addItem(pop, snipLabel(s.label), "", () => insert(s.template));
        addSection(pop, L.ui.sec.toggle);
        for (const s of SNIPPETS.toggles) addItem(pop, snipLabel(s.label), "", () => insert(s.template));
        addSection(pop, L.ui.sec.directive);
        for (const s of DIRECTIVE_SNIPPETS) addItem(pop, s.label, L.dir[s.label] || s.desc, () => insert(s.template));
        addSection(pop, L.ui.sec.block);
        for (const s of SNIPPETS.blocks) addItem(pop, snipLabel(s.label), "", () => insert(s.template));
        addSection(pop, L.ui.sec.other);
        addItem(pop, snipLabel(SNIPPETS.comment.label), "", () => insert(SNIPPETS.comment.template));
    }

    function openVarsMenu() {
        const pop = makePopup();
        addSection(pop, L.ui.sec.insertVar);
        const vars = collectVariables(state.ta?.value ?? "");
        if (!vars.length) {
            const d = document.createElement("div"); d.className = "muted"; d.textContent = L.ui.noVars;
            pop.appendChild(d);
            return;
        }
        for (const name of vars) addItem(pop, `{{${name}}}`, "", () => insertVar(name));
    }

    function openLegend() {
        const pop = makePopup();
        addSection(pop, L.ui.sec.legend);
        for (const [cls, key] of LEGEND_KEYS) {
            const row = document.createElement("div");
            row.className = "spb-ed-legrow " + cls;
            const sw = document.createElement("i");
            row.appendChild(sw);
            const txt = document.createElement("span"); txt.textContent = L.ui.legendRows[key];
            row.appendChild(txt);
            pop.appendChild(row);
        }
    }

    function toggleMenu(fn) { if (state.pop) closePopup(); else fn(); }

    function makeButton(label, title, onClick) {
        const b = document.createElement("div");
        b.className = "spb-ed-btn";
        b.textContent = label;
        if (title) b.title = title;
        b.addEventListener("mousedown", (ev) => { ev.preventDefault(); ev.stopPropagation(); onClick(); });
        return b;
    }

    // ---------------- hover tooltips ----------------

    function hideTip() { if (state.tip) state.tip.style.display = "none"; }

    function onHover(ev) {
        const { backdrop, tip, ta } = state;
        if (!backdrop || !tip || !ta || typeof backdrop.querySelectorAll !== "function") return;
        const wrapper = ta.parentElement;
        if (!wrapper || typeof wrapper.getBoundingClientRect !== "function") return;
        const spans = backdrop.querySelectorAll("span[data-ti]");
        let hit = null;
        for (const sp of spans) {
            for (const r of sp.getClientRects()) {
                if (ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) {
                    hit = sp;
                    break;
                }
            }
            if (hit) break;
        }
        if (!hit) { hideTip(); return; }
        const token = state.tokens[Number(hit.dataset.ti)];
        const desc = token ? describeToken(token, L) : "";
        if (!desc) { hideTip(); return; }
        const p = localPoint(wrapper, ev.clientX, ev.clientY);
        tip.textContent = desc;
        tip.style.display = "block";
        tip.style.left = Math.max(4, Math.min(p.x + 12, wrapper.clientWidth - 200)) + "px";
        tip.style.top = (p.y + 16) + "px";
    }

    // ---------------- autocomplete ----------------

    function hideAutocomplete() {
        if (state.ac) state.ac.style.display = "none";
        state.acItems = [];
        state.acCtx = null;
        state.acSel = 0;
    }

    function renderAcSelection() {
        const children = state.ac ? Array.from(state.ac.children) : [];
        children.forEach((el, i) => {
            if (i === state.acSel) el.classList.add("sel");
            else el.classList.remove("sel");
        });
    }

    function acceptAutocomplete() {
        const { ta, acCtx, acItems, acSel } = state;
        if (!ta || !acCtx || !acItems.length) return false;
        const choice = acItems[acSel] || acItems[0];
        const caret = ta.selectionStart ?? ta.value.length;
        const { start, end, insert: ins, caretTo } = buildCompletion(ta.value, caret, acCtx, choice.value);
        ta.focus();
        if (typeof ta.setRangeText === "function") ta.setRangeText(ins, start, end, "end");
        else ta.value = ta.value.slice(0, start) + ins + ta.value.slice(end);
        ta.selectionStart = ta.selectionEnd = caretTo;
        hideAutocomplete();
        ta.dispatchEvent(new Event("input", { bubbles: true }));
        render();
        return true;
    }

    function updateAutocomplete() {
        const { ta, ac, backdrop } = state;
        if (!ta || !ac) return;
        const caret = ta.selectionStart ?? 0;
        if (caret !== ta.selectionEnd) { hideAutocomplete(); return; }
        const ctx = autocompleteContext(ta.value ?? "", caret);
        const items = autocompleteSuggestions(ta.value ?? "", ctx, L);
        if (!ctx || !items.length) { hideAutocomplete(); return; }
        state.acCtx = ctx;
        state.acItems = items;
        state.acSel = 0;
        ac.innerHTML = "";
        items.slice(0, 12).forEach((it, i) => {
            const d = document.createElement("div");
            d.className = "item" + (i === 0 ? " sel" : "");
            d.innerHTML = `${escapeText(it.label)}${it.desc ? `<small>${escapeText(it.desc)}</small>` : ""}`;
            d.addEventListener("mousedown", (ev) => { ev.preventDefault(); state.acSel = i; acceptAutocomplete(); });
            ac.appendChild(d);
        });
        ac.style.display = "block";
        // Position near the caret when we can measure it; else under the header.
        const wrapper = ta.parentElement;
        const rect = backdrop ? rectAtIndex(backdrop, caret) : null;
        if (rect && wrapper && typeof wrapper.getBoundingClientRect === "function") {
            const p = localPoint(wrapper, rect.left, rect.bottom);
            ac.style.left = Math.max(4, Math.min(p.x, wrapper.clientWidth - 180)) + "px";
            ac.style.top = (p.y + 4) + "px";
            ac.style.right = "auto";
        } else {
            ac.style.left = "8px";
            ac.style.top = (HEADER_H + 4) + "px";
            ac.style.right = "auto";
        }
    }

    function onKeyDown(ev) {
        if (!state.ac || state.ac.style.display !== "block") return;
        if (ev.key === "ArrowDown") {
            state.acSel = Math.min(state.acSel + 1, Math.min(state.acItems.length, 12) - 1);
            renderAcSelection();
        } else if (ev.key === "ArrowUp") {
            state.acSel = Math.max(state.acSel - 1, 0);
            renderAcSelection();
        } else if (ev.key === "Enter" || ev.key === "Tab") {
            if (!acceptAutocomplete()) return;
        } else if (ev.key === "Escape") {
            hideAutocomplete();
        } else {
            return;
        }
        ev.preventDefault();
        ev.stopPropagation();
    }

    // ---------------- setup ----------------

    function setup(ta) {
        if (ta.dataset.spbEditor === "1") { state.ta = ta; return; }
        const wrapper = ta.parentElement;
        if (!wrapper) return false;
        ta.dataset.spbEditor = "1";
        state.ta = ta;
        if (getComputedStyle(wrapper).position === "static") wrapper.classList.add("spb-ed-host");

        const backdrop = document.createElement("div");
        backdrop.className = "spb-ed-backdrop";
        wrapper.insertBefore(backdrop, ta);
        state.backdrop = backdrop;

        const header = document.createElement("div");
        header.className = "spb-ed-header";
        const title = document.createElement("div"); title.className = "spb-ed-title"; title.textContent = L.ui.title;
        header.appendChild(title);
        header.appendChild(makeButton(L.ui.insert, L.ui.insertTitle, () => toggleMenu(openInsertMenu)));
        header.appendChild(makeButton(L.ui.vars, L.ui.varsTitle, () => toggleMenu(openVarsMenu)));
        header.appendChild(makeButton(L.ui.legendBtn, L.ui.legendTitle, () => toggleMenu(openLegend)));
        wrapper.appendChild(header);
        state.header = header;

        const help = document.createElement("div");
        help.className = "spb-ed-help";
        wrapper.appendChild(help);
        state.help = help;

        const tip = document.createElement("div");
        tip.className = "spb-ed-tip";
        wrapper.appendChild(tip);
        state.tip = tip;

        const ac = document.createElement("div");
        ac.className = "spb-ed-ac";
        wrapper.appendChild(ac);
        state.ac = ac;

        const cs0 = getComputedStyle(ta);
        ta.style.paddingTop = `calc(${cs0.paddingTop} + ${HEADER_H}px)`;
        ta.style.paddingBottom = `calc(${cs0.paddingBottom} + ${HELP_H}px)`;
        syncBackdropStyle(ta, backdrop);
        ta.style.color = "transparent";
        ta.style.caretColor = cs0.getPropertyValue("--input-text") || "#e6edf3";

        const onInput = () => { render(); updateAutocomplete(); };
        const onScroll = () => { backdrop.scrollTop = ta.scrollTop; backdrop.scrollLeft = ta.scrollLeft; hideTip(); hideAutocomplete(); };
        const onCaret = () => { updateHelp(); };
        const onClick = () => { updateHelp(); hideAutocomplete(); };
        const onLeave = () => hideTip();
        const onBlur = () => setTimeout(() => { if (document.activeElement !== ta) hideAutocomplete(); }, 150);
        ta.addEventListener("input", onInput);
        ta.addEventListener("scroll", onScroll);
        ta.addEventListener("keyup", onCaret);
        ta.addEventListener("click", onClick);
        ta.addEventListener("select", onCaret);
        ta.addEventListener("mousemove", onHover);
        ta.addEventListener("mouseleave", onLeave);
        ta.addEventListener("keydown", onKeyDown);
        ta.addEventListener("blur", onBlur);
        state.cleanup = () => {
            ta.removeEventListener("input", onInput);
            ta.removeEventListener("scroll", onScroll);
            ta.removeEventListener("keyup", onCaret);
            ta.removeEventListener("click", onClick);
            ta.removeEventListener("select", onCaret);
            ta.removeEventListener("mousemove", onHover);
            ta.removeEventListener("mouseleave", onLeave);
            ta.removeEventListener("keydown", onKeyDown);
            ta.removeEventListener("blur", onBlur);
        };

        render();
        return true;
    }

    function tryAttach() {
        if (state.ta && state.ta.dataset.spbEditor === "1" && state.backdrop) return;
        const ta = promptWidget?.element || promptWidget?.inputEl;
        if (ta && ta.parentElement) {
            try {
                if (setup(ta) !== false) return;
            } catch (err) {
                console.warn("[PromptBuilder] editor attach failed:", err);
                if (state.ta) state.ta.style.color = "";
                return;
            }
        }
        if (state.tries++ < 120) requestAnimationFrame(tryAttach);
    }

    tryAttach();

    return {
        refresh: () => render(),
        setVisible: (v) => {
            state.visible = !!v;
            const disp = v ? "" : "none";
            if (state.backdrop) state.backdrop.style.display = disp;
            if (state.header) state.header.style.display = v ? "flex" : "none";
            if (state.help) state.help.style.display = disp;
            if (!v) { closePopup(); hideTip(); hideAutocomplete(); }
            if (v) render();
        },
        destroy: () => {
            closePopup();
            state.cleanup?.();
            state.backdrop?.remove();
            state.header?.remove();
            state.help?.remove();
            state.tip?.remove();
            state.ac?.remove();
            if (state.ta) {
                state.ta.style.color = "";
                state.ta.style.paddingTop = "";
                state.ta.style.paddingBottom = "";
                delete state.ta.dataset.spbEditor;
            }
        },
    };
}
