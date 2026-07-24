import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_ID = "darkilShowAny";
const MIN_WIDTH = 260;
const DISPLAY_NAME = "showany_display";
const VIEW_MODE_NAME = "view_mode";
const VIEW_COMBO_NAME = "view";
const BOOL_HEIGHT = 96;
const EQ_HEIGHT = 150;
const EQ_MARGIN = 14;
const EQ_PAD_TOP = 18;
const EQ_PAD_BOTTOM = 16;
const STACK_ROW_H = 64;
const STACK_PAGE = 10;
const STACK_BTN_H = 24;

function viewURL(info) {
    const params = new URLSearchParams({
        filename: info.filename || "",
        subfolder: info.subfolder || "",
        type: info.type || "temp",
    });
    const rand = app.getRandParam ? app.getRandParam() : "";
    return api.apiURL(`/view?${params}${rand}`);
}

function fmtNum(v) {
    if (!isFinite(v)) return String(v);
    if (v !== 0 && (Math.abs(v) >= 100000 || Math.abs(v) < 0.001)) return v.toExponential(1);
    return String(Math.round(v * 1000) / 1000);
}

function ignoreInjectedWidth(w) {
    Object.defineProperty(w, "width", { configurable: true, get() {}, set() {} });
    return w;
}

function getWidget(node, name) {
    return node.widgets?.find(w => w.name === name);
}

function textHeight(text) {
    const lines = (String(text ?? "").match(/\n/g) || []).length + 1;
    return Math.min(360, Math.max(80, lines * 16 + 18));
}

function clearDisplay(node) {
    const reg = node.__showAny;
    if (!reg) return;
    for (const w of reg.widgets) {
        const i = node.widgets ? node.widgets.indexOf(w) : -1;
        if (i >= 0) node.widgets.splice(i, 1);
        try { w.onRemove?.(); } catch (e) {}
        try { w.element?.remove?.(); } catch (e) {}
    }
    reg.widgets = [];
    node.imgs = undefined;
    node.images = undefined;
}

function fitNode(node) {
    const reg = node.__showAny;
    const apply = () => {
        const min = node.computeSize();
        const w = Math.max(node.size[0], MIN_WIDTH, min[0]);
        const h = reg && reg.fill ? Math.max(node.size[1], min[1]) : min[1];
        node.setSize([w, h]);
        node.setDirtyCanvas(true, true);
    };
    apply();
    requestAnimationFrame(apply);
}

function addDomDisplay(node, el, h, type, fill) {
    el.style.width = "100%";
    el.style.height = "100%";
    const w = node.addDOMWidget(DISPLAY_NAME, type || "div", el, {
        serialize: false,
        hideOnZoom: false,
    });
    w.serialize = false;
    w.computeLayoutSize = fill
        ? () => ({ minHeight: h, minWidth: 0 })
        : () => ({ minHeight: h, maxHeight: h, minWidth: 0 });
    node.__showAny.fill = !!fill;
    node.__showAny.widgets.push(w);
    return w;
}

function addCopyButton(node, getText) {
    const btn = node.addWidget("button", "Copy", null, () => {
        try { navigator.clipboard?.writeText(String(getText() ?? "")); } catch (e) {}
    });
    btn.serialize = false;
    node.__showAny.widgets.push(btn);
}

function makeCopyBar(getText) {
    const btn = document.createElement("button");
    btn.textContent = "Copy";
    btn.style.cssText = "flex:0 0 auto;height:22px;margin-top:4px;cursor:pointer;"
        + "background:#2b2b2b;color:#ddd;border:1px solid #3a3a3a;border-radius:4px;font:12px Arial;";
    btn.onclick = () => {
        try { navigator.clipboard?.writeText(String(getText() ?? "")); } catch (e) {}
    };
    return btn;
}

function buildText(node, text) {
    const box = document.createElement("div");
    box.style.cssText = "width:100%;box-sizing:border-box;display:flex;flex-direction:column;";
    const ta = document.createElement("textarea");
    ta.readOnly = true;
    ta.spellcheck = false;
    ta.value = String(text ?? "");
    ta.style.cssText = "flex:1 1 auto;width:100%;box-sizing:border-box;resize:none;"
        + "background:#1c1c1c;color:#ddd;border:1px solid #3a3a3a;border-radius:4px;"
        + "font:12px monospace;padding:6px;outline:none;";
    box.appendChild(ta);
    box.appendChild(makeCopyBar(() => ta.value));
    addDomDisplay(node, box, textHeight(text) + 26, "text", true);
}

function makeSmallBtn(label, onClick) {
    const b = document.createElement("button");
    b.textContent = label;
    b.style.cssText = "height:20px;padding:0 8px;cursor:pointer;background:#2b2b2b;color:#ddd;"
        + "border:1px solid #3a3a3a;border-radius:4px;font:11px Arial;";
    b.onclick = onClick;
    return b;
}

function jsonValStr(v) {
    if (v === null) return "null";
    if (typeof v === "string") return `"${v}"`;
    return String(v);
}

function jsonValColor(v) {
    if (v === null) return "#999";
    if (typeof v === "string") return "#c8e6c9";
    if (typeof v === "number") return "#e0a458";
    if (typeof v === "boolean") return "#c58af9";
    return "#ddd";
}

function jsonNode(key, value) {
    if (value !== null && typeof value === "object") {
        const details = document.createElement("details");
        details.open = true;
        details.style.cssText = "margin-left:10px;";
        const summary = document.createElement("summary");
        summary.style.cssText = "cursor:pointer;color:#9ecbff;";
        const isArr = Array.isArray(value);
        const n = isArr ? value.length : Object.keys(value).length;
        summary.textContent = (key !== null ? key + " " : "") + (isArr ? `[${n}]` : `{${n}}`);
        details.appendChild(summary);
        const entries = isArr ? value.map((v, i) => [i, v]) : Object.entries(value);
        for (const [k, v] of entries) details.appendChild(jsonNode(k, v));
        return details;
    }
    const row = document.createElement("div");
    row.style.cssText = "margin-left:22px;white-space:normal;word-break:break-word;";
    if (key !== null) {
        const ks = document.createElement("span");
        ks.style.color = "#9ecbff";
        ks.textContent = key + ": ";
        row.appendChild(ks);
    }
    const vs = document.createElement("span");
    vs.style.color = jsonValColor(value);
    vs.textContent = jsonValStr(value);
    row.appendChild(vs);
    return row;
}

function buildJson(node, text) {
    const reg = node.__showAny;
    if (reg.jsonRaw === undefined) reg.jsonRaw = false;

    let obj = null;
    let parsed = false;
    let pretty = String(text ?? "");
    try { obj = JSON.parse(pretty); pretty = JSON.stringify(obj, null, 2); parsed = true; } catch (e) {}

    const box = document.createElement("div");
    box.style.cssText = "width:100%;box-sizing:border-box;display:flex;flex-direction:column;";

    const bar = document.createElement("div");
    bar.style.cssText = "flex:0 0 auto;display:flex;gap:4px;margin-bottom:4px;";

    const content = document.createElement("div");
    content.style.cssText = "flex:1 1 auto;overflow:auto;background:#1c1c1c;border:1px solid #3a3a3a;"
        + "border-radius:4px;padding:6px;font:12px monospace;color:#c8e6c9;";

    const render = () => {
        content.textContent = "";
        if (!parsed || reg.jsonRaw) {
            content.style.whiteSpace = "pre";
            const pre = document.createElement("pre");
            pre.style.cssText = "margin:0;white-space:pre;";
            pre.textContent = pretty;
            content.appendChild(pre);
        } else {
            content.style.whiteSpace = "normal";
            content.appendChild(jsonNode(null, obj));
        }
    };

    if (parsed) {
        const toggle = makeSmallBtn(reg.jsonRaw ? "Tree" : "Raw", () => {
            reg.jsonRaw = !reg.jsonRaw;
            toggle.textContent = reg.jsonRaw ? "Tree" : "Raw";
            render();
        });
        bar.appendChild(toggle);
    }
    bar.appendChild(makeSmallBtn("Copy", () => {
        try { navigator.clipboard?.writeText(pretty); } catch (e) {}
    }));

    render();
    box.appendChild(bar);
    box.appendChild(content);
    addDomDisplay(node, box, textHeight(pretty) + 30, "json", true);
}

function drawBoolean(ctx, width, y, value) {
    const size = 56;
    const cx = width / 2;
    const x = cx - size / 2;
    const ry = y + (BOOL_HEIGHT - size) / 2 - 6;
    const r = 12;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x + r, ry);
    ctx.arcTo(x + size, ry, x + size, ry + size, r);
    ctx.arcTo(x + size, ry + size, x, ry + size, r);
    ctx.arcTo(x, ry + size, x, ry, r);
    ctx.arcTo(x, ry, x + size, ry, r);
    ctx.closePath();
    ctx.fillStyle = value ? "#2f7d3f" : "#8a2f2f";
    ctx.fill();
    ctx.strokeStyle = value ? "#4a9d5b" : "#b45151";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    if (value) {
        ctx.moveTo(x + size * 0.26, ry + size * 0.54);
        ctx.lineTo(x + size * 0.44, ry + size * 0.72);
        ctx.lineTo(x + size * 0.76, ry + size * 0.30);
    } else {
        ctx.moveTo(x + size * 0.30, ry + size * 0.30);
        ctx.lineTo(x + size * 0.70, ry + size * 0.70);
        ctx.moveTo(x + size * 0.70, ry + size * 0.30);
        ctx.lineTo(x + size * 0.30, ry + size * 0.70);
    }
    ctx.stroke();

    ctx.fillStyle = "#dddddd";
    ctx.font = "12px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(value ? "True" : "False", cx, ry + size + 16);
    ctx.restore();
}

function buildBoolean(node, value) {
    const w = {
        name: DISPLAY_NAME,
        type: "custom",
        value: "",
        serialize: false,
        computeSize() { return [node.size[0], BOOL_HEIGHT]; },
        draw(ctx, n, width, wy) {
            drawBoolean(ctx, width, wy, value);
        },
    };
    node.widgets.push(ignoreInjectedWidth(w));
    node.__showAny.widgets.push(w);
    node.__showAny.fill = false;
}

function buildImages(node, images) {
    const list = images || [];
    if (!list.length) {
        buildText(node, "(no image)");
        return;
    }
    const single = list.length === 1;
    const box = document.createElement("div");
    box.style.cssText = "width:100%;height:100%;box-sizing:border-box;overflow:auto;"
        + "display:flex;flex-wrap:wrap;gap:4px;align-content:flex-start;justify-content:center;"
        + "background:#1c1c1c;border:1px solid #3a3a3a;border-radius:4px;padding:4px;";
    for (const info of list) {
        const im = document.createElement("img");
        im.src = viewURL(info);
        im.style.cssText = single
            ? "max-width:100%;max-height:100%;object-fit:contain;border-radius:3px;"
            : "width:calc(50% - 3px);height:auto;object-fit:contain;border-radius:3px;";
        box.appendChild(im);
    }
    addDomDisplay(node, box, single ? 240 : 260, "images", true);
}

function buildAudio(node, refs) {
    const list = refs || [];
    if (!list.length) {
        buildText(node, "(no audio)");
        return;
    }
    const box = document.createElement("div");
    box.style.cssText = "width:100%;box-sizing:border-box;display:flex;flex-direction:column;"
        + "gap:4px;justify-content:center;";
    const shown = list.slice(0, 8);
    for (const info of shown) {
        const au = document.createElement("audio");
        au.controls = true;
        au.src = viewURL(info);
        au.style.cssText = "width:100%;";
        box.appendChild(au);
    }
    addDomDisplay(node, box, shown.length * 40 + 8, "audio", false);
}

function buildVideo(node, refs) {
    const list = refs || [];
    if (!list.length) {
        buildText(node, "(no video)");
        return;
    }
    const v = document.createElement("video");
    v.controls = true;
    v.loop = true;
    v.playsInline = true;
    v.src = viewURL(list[0]);
    v.style.cssText = "width:100%;height:100%;object-fit:contain;background:#000;border-radius:4px;";
    addDomDisplay(node, v, 240, "video", true);
}

function drawBars(ctx, values, x, y, width, height, labels) {
    const textColor = window.LiteGraph?.WIDGET_TEXT_COLOR || "#ddd";
    const secondaryColor = window.LiteGraph?.WIDGET_SECONDARY_TEXT_COLOR || "#999";

    let lo = Math.min(0, ...values);
    let hi = Math.max(0, ...values);
    if (hi === lo) { hi += 1; lo -= 1; }
    const span = (hi - lo) * 0.08;
    lo -= span; hi += span;

    const trackTop = y + EQ_PAD_TOP;
    const trackH = height - EQ_PAD_TOP - EQ_PAD_BOTTOM;
    const n = values.length;
    const colW = (width - 2 * EQ_MARGIN) / n;
    const valToY = (v) => trackTop + (1 - (v - lo) / (hi - lo)) * trackH;
    const zeroY = valToY(0);
    const barW = Math.max(2, Math.min(16, colW * 0.5));
    const showLabels = labels !== false && colW >= 22;

    ctx.strokeStyle = "#3a3a3a";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + EQ_MARGIN, zeroY);
    ctx.lineTo(x + width - EQ_MARGIN, zeroY);
    ctx.stroke();

    for (let i = 0; i < n; i++) {
        const cx = x + EQ_MARGIN + colW * (i + 0.5);
        const v = values[i];
        const vy = valToY(v);
        ctx.fillStyle = v >= 0 ? "#4a9d5b" : "#b45151";
        ctx.fillRect(cx - barW / 2, Math.min(vy, zeroY), barW, Math.max(1, Math.abs(vy - zeroY)));
        if (showLabels) {
            ctx.fillStyle = textColor;
            ctx.font = "9px Arial";
            ctx.textAlign = "center";
            ctx.fillText(fmtNum(v), cx, v >= 0 ? Math.min(vy, zeroY) - 3 : Math.max(vy, zeroY) + 10);
            ctx.fillStyle = secondaryColor;
            ctx.fillText(String(i), cx, y + height - 4);
        }
    }

    ctx.fillStyle = secondaryColor;
    ctx.font = "9px Arial";
    ctx.textAlign = "left";
    ctx.fillText(fmtNum(hi), x + 3, trackTop + 7);
    ctx.fillText(fmtNum(lo), x + 3, trackTop + trackH);
}

function buildEqualizer(node, values) {
    const vals = (values || []).map(Number).filter(v => isFinite(v));
    const w = {
        name: DISPLAY_NAME,
        type: "custom",
        value: "",
        serialize: false,
        computeSize() { return [node.size[0], EQ_HEIGHT]; },
        draw(ctx, n, width, wy) {
            drawBars(ctx, vals.length ? vals : [0], 0, wy, width, EQ_HEIGHT, true);
        },
    };
    node.widgets.push(ignoreInjectedWidth(w));
    node.__showAny.widgets.push(w);
    node.__showAny.fill = false;
    addCopyButton(node, () => JSON.stringify(values));
}

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function mdInline(s) {
    s = s.replace(/`([^`]+)`/g, (m, c) => `<code style="background:#333;padding:1px 3px;border-radius:3px;">${c}</code>`);
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>");
    s = s.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, u) => {
        if (/^https?:\/\//i.test(u) || /^\//.test(u) || /^#/.test(u)) {
            return `<a href="${u}" target="_blank" rel="noopener noreferrer" style="color:#9ecbff;">${t}</a>`;
        }
        return t;
    });
    return s;
}

function mdToHtml(src) {
    const lines = String(src).replace(/\r\n?/g, "\n").split("\n");
    const out = [];
    let i = 0;
    let list = null;
    const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };

    while (i < lines.length) {
        const line = lines[i];
        if (/^```/.test(line)) {
            closeList();
            const buf = [];
            i++;
            while (i < lines.length && !/^```/.test(lines[i])) { buf.push(escapeHtml(lines[i])); i++; }
            i++;
            out.push(`<pre style="background:#111;border:1px solid #3a3a3a;border-radius:4px;padding:6px;overflow:auto;"><code>${buf.join("\n")}</code></pre>`);
            continue;
        }
        const h = /^(#{1,6})\s+(.*)$/.exec(line);
        if (h) {
            closeList();
            const lvl = h[1].length;
            out.push(`<h${lvl} style="margin:6px 0;">${mdInline(escapeHtml(h[2]))}</h${lvl}>`);
            i++; continue;
        }
        if (/^(\*\*\*|---|___)\s*$/.test(line)) {
            closeList();
            out.push(`<hr style="border:none;border-top:1px solid #3a3a3a;">`);
            i++; continue;
        }
        const bq = /^>\s?(.*)$/.exec(line);
        if (bq) {
            closeList();
            out.push(`<blockquote style="border-left:3px solid #3a3a3a;margin:4px 0;padding-left:8px;color:#aaa;">${mdInline(escapeHtml(bq[1]))}</blockquote>`);
            i++; continue;
        }
        const ul = /^[\-\*\+]\s+(.*)$/.exec(line);
        if (ul) {
            if (list !== "ul") { closeList(); out.push(`<ul style="margin:4px 0 4px 18px;">`); list = "ul"; }
            out.push(`<li>${mdInline(escapeHtml(ul[1]))}</li>`);
            i++; continue;
        }
        const ol = /^\d+\.\s+(.*)$/.exec(line);
        if (ol) {
            if (list !== "ol") { closeList(); out.push(`<ol style="margin:4px 0 4px 18px;">`); list = "ol"; }
            out.push(`<li>${mdInline(escapeHtml(ol[1]))}</li>`);
            i++; continue;
        }
        if (/^\s*$/.test(line)) {
            closeList();
            i++; continue;
        }
        closeList();
        out.push(`<p style="margin:4px 0;">${mdInline(escapeHtml(line))}</p>`);
        i++;
    }
    closeList();
    return out.join("\n");
}

function buildMarkdown(node, text) {
    const box = document.createElement("div");
    box.style.cssText = "width:100%;box-sizing:border-box;display:flex;flex-direction:column;";
    const md = document.createElement("div");
    md.style.cssText = "flex:1 1 auto;width:100%;box-sizing:border-box;overflow:auto;"
        + "background:#1c1c1c;color:#ddd;border:1px solid #3a3a3a;border-radius:4px;"
        + "padding:8px;font:13px/1.5 sans-serif;";
    md.innerHTML = mdToHtml(text);
    box.appendChild(md);
    box.appendChild(makeCopyBar(() => text));
    addDomDisplay(node, box, Math.min(420, textHeight(text) + 60) + 26, "markdown", true);
}

function drawPager(ctx, width, y, page, pages) {
    const textColor = window.LiteGraph?.WIDGET_TEXT_COLOR || "#ddd";
    ctx.fillStyle = "#2b2b2b";
    ctx.fillRect(EQ_MARGIN, y + 2, width - 2 * EQ_MARGIN, STACK_BTN_H - 4);
    ctx.fillStyle = textColor;
    ctx.font = "11px Arial";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText("◀ prev", EQ_MARGIN + 8, y + STACK_BTN_H / 2);
    ctx.textAlign = "center";
    ctx.fillText(`${page + 1} / ${pages}`, width / 2, y + STACK_BTN_H / 2);
    ctx.textAlign = "right";
    ctx.fillText("next ▶", width - EQ_MARGIN - 8, y + STACK_BTN_H / 2);
    ctx.textBaseline = "alphabetic";
}

function buildStacked(node, series) {
    const data = (series || []).map(row => (row || []).map(Number).filter(v => isFinite(v)));
    const pages = Math.max(1, Math.ceil(data.length / STACK_PAGE));
    const secondary = () => window.LiteGraph?.WIDGET_SECONDARY_TEXT_COLOR || "#999";

    const w = {
        name: DISPLAY_NAME,
        type: "custom",
        value: "",
        serialize: false,
        _page: 0,
        _btnY: 0,
        computeSize() {
            const rows = Math.min(STACK_PAGE, Math.max(1, data.length - this._page * STACK_PAGE));
            return [node.size[0], rows * STACK_ROW_H + (pages > 1 ? STACK_BTN_H : 0) + 4];
        },
        draw(ctx, n, width, wy) {
            const start = this._page * STACK_PAGE;
            const rows = data.slice(start, start + STACK_PAGE);
            for (let i = 0; i < rows.length; i++) {
                const ry = wy + i * STACK_ROW_H;
                drawBars(ctx, rows[i].length ? rows[i] : [0], 0, ry, width, STACK_ROW_H, false);
                ctx.fillStyle = secondary();
                ctx.font = "9px Arial";
                ctx.textAlign = "left";
                ctx.fillText(`#${start + i}`, 3, ry + 10);
            }
            if (pages > 1) {
                this._btnY = wy + rows.length * STACK_ROW_H + 2;
                drawPager(ctx, width, this._btnY, this._page, pages);
            }
        },
        mouse(event, pos, n) {
            if (pages <= 1) return false;
            if (!(event.type || "").endsWith("down")) return false;
            if (pos[1] < this._btnY || pos[1] > this._btnY + STACK_BTN_H) return false;
            this._page = pos[0] < node.size[0] / 2
                ? (this._page - 1 + pages) % pages
                : (this._page + 1) % pages;
            node.setSize([node.size[0], node.computeSize()[1]]);
            node.setDirtyCanvas(true, true);
            return true;
        },
    };
    node.widgets.push(ignoreInjectedWidth(w));
    node.__showAny.widgets.push(w);
    node.__showAny.fill = false;
    addCopyButton(node, () => JSON.stringify(series));
}

function toggleViewCombo(node, show) {
    const combo = getWidget(node, VIEW_COMBO_NAME);
    if (!combo) return;
    combo.hidden = !show;
    if (show) {
        delete combo.computeSize;
    } else {
        combo.computeSize = () => [0, -4];
    }
}

function resolveStringMode(node, payload) {
    const mode = (getWidget(node, VIEW_MODE_NAME)?.value || "auto").toLowerCase();
    if (mode === "text") return "text";
    if (mode === "markdown") return "markdown";
    if (mode === "json") return "json";
    if (payload.values) return "numlist";
    if (payload.series) return "numlists";
    return payload.json_ok ? "json" : "text";
}

function rebuild(node) {
    const reg = node.__showAny;
    if (!reg || !reg.lastPayload) return;

    clearDisplay(node);
    const payload = reg.lastPayload;
    let kind = payload.kind;

    const isString = kind === "string";
    toggleViewCombo(node, isString);
    if (isString) kind = resolveStringMode(node, payload);

    switch (kind) {
        case "json":
            buildJson(node, payload.text ?? "");
            break;
        case "boolean":
            buildBoolean(node, !!payload.value);
            break;
        case "number":
            buildText(node, payload.text ?? String(payload.value ?? ""));
            break;
        case "image":
            buildImages(node, payload.images);
            break;
        case "audio":
            buildAudio(node, payload.audio);
            break;
        case "video":
            buildVideo(node, payload.video);
            break;
        case "numlist":
            buildEqualizer(node, payload.values);
            break;
        case "numlists":
            buildStacked(node, payload.series);
            break;
        case "markdown":
            buildMarkdown(node, payload.text ?? "");
            break;
        case "text":
        default:
            buildText(node, payload.text ?? "");
            break;
    }
    fitNode(node);
}

function handleExecuted(node, message) {
    if (!node.__showAny) node.__showAny = { widgets: [], lastPayload: null, lastMessage: null };
    const raw = message?.darkil_show;
    const s = Array.isArray(raw) ? raw[0] : raw;
    if (s === undefined || s === null) return;

    let payload;
    try { payload = JSON.parse(s); } catch (e) { payload = { kind: "text", text: String(s) }; }
    if (!payload) return;

    node.__showAny.lastPayload = payload;
    node.__showAny.lastMessage = message;
    rebuild(node);
}

function ensureViewMode(node) {
    if (!getWidget(node, VIEW_MODE_NAME)) {
        const w = node.addWidget("string", VIEW_MODE_NAME, "auto", () => {});
        w.hidden = true;
        w.computeSize = () => [0, -4];
    }
    if (!getWidget(node, VIEW_COMBO_NAME)) {
        const combo = node.addWidget(
            "combo",
            VIEW_COMBO_NAME,
            "Auto",
            (v) => {
                const hw = getWidget(node, VIEW_MODE_NAME);
                if (hw) hw.value = String(v).toLowerCase();
                rebuild(node);
            },
            { values: ["Auto", "Text", "Markdown", "JSON"] }
        );
        combo.serialize = false;
        combo.hidden = true;
        combo.computeSize = () => [0, -4];
    }
}

function restoreViewMode(node) {
    const hw = getWidget(node, VIEW_MODE_NAME);
    if (!hw) return;
    const idx = node.widgets ? node.widgets.indexOf(hw) : -1;
    const saved = (node.widgets_values && idx !== -1) ? node.widgets_values[idx] : undefined;
    const mode = (typeof saved === "string" ? saved : hw.value || "auto").toLowerCase();
    hw.value = mode;
    const combo = getWidget(node, VIEW_COMBO_NAME);
    if (combo) combo.value = mode.charAt(0).toUpperCase() + mode.slice(1);
}

app.registerExtension({
    name: `darkil_nodes_logic.${NODE_ID}`,

    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== NODE_ID) return;

        const origCreated = nodeType.prototype.onNodeCreated;
        const origExecuted = nodeType.prototype.onExecuted;
        const origRemoved = nodeType.prototype.onRemoved;

        nodeType.prototype.onNodeCreated = function () {
            const r = origCreated?.apply(this, arguments);
            this.serialize_widgets = true;
            this.__showAny = { widgets: [], lastPayload: null, lastMessage: null };

            ensureViewMode(this);
            this.size[0] = Math.max(this.size[0] || 0, MIN_WIDTH);

            const node = this;
            requestAnimationFrame(() => {
                restoreViewMode(node);
                node.setDirtyCanvas(true, true);
            });
            return r;
        };

        nodeType.prototype.onExecuted = function (message) {
            const r = origExecuted?.apply(this, arguments);
            handleExecuted(this, message);
            return r;
        };

        nodeType.prototype.onRemoved = function () {
            clearDisplay(this);
            return origRemoved?.apply(this, arguments);
        };

        return nodeType;
    },
});
