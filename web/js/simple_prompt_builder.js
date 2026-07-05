import { app } from "../../scripts/app.js";
import { setLocaleSetting } from "./utils.js";
import { attachSyntaxEditor } from "./prompt_builder_editor.js";
import { RESERVED_NAMES } from "./prompt_builder_grammar.js";
import { getStrings } from "./prompt_builder_i18n.js";

const NODE_NAME = "darkilPromptBuilder";
const CACHE_KEY = "cachedValues";
const TOGGLE_KEY = "promptVisible";
const EXTRA_TOGGLE_KEY = "extraActive";
const TEXT_TOGGLE_KEY = "promptTextActive";

const SWITCHBAR_H = 26;
const SWITCHBAR_PAD = 8;


function ignoreInjectedWidth(w) {
    Object.defineProperty(w, "width", { configurable: true, get() {}, set() {} });
    return w;
}


function roundRectPath(ctx, x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, h / 2, w / 2));
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
}


function drawSwitchBar(ctx, width, y, height, defs, states) {
    const pad = SWITCHBAR_PAD;
    const usableW = Math.max(0, width - 2 * pad);
    const cellW = defs.length ? usableW / defs.length : usableW;
    const centerY = y + height / 2;
    const trackW = 24;
    const trackH = 13;
    const knobR = trackH / 2 - 2;
    const gap = 6;
    const secondary = window.LiteGraph?.WIDGET_SECONDARY_TEXT_COLOR || "#9aa5b1";

    ctx.save();
    roundRectPath(ctx, pad, y + 3, usableW, height - 6, 6);
    ctx.fillStyle = "rgba(255,255,255,0.045)";
    ctx.fill();

    ctx.font = "11px sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    for (let i = 0; i < defs.length; i++) {
        const def = defs[i];
        const on = !!states[def.key];
        const cellX = pad + i * cellW;
        const labelW = ctx.measureText(def.label).width;
        const groupW = trackW + gap + labelW;
        const gx = cellX + Math.max(4, (cellW - groupW) / 2);

        roundRectPath(ctx, gx, centerY - trackH / 2, trackW, trackH, trackH / 2);
        if (on) { ctx.globalAlpha = 0.5; ctx.fillStyle = def.color; }
        else { ctx.globalAlpha = 1; ctx.fillStyle = "#3a3f47"; }
        ctx.fill();
        ctx.globalAlpha = 1;

        const knobX = on ? gx + trackW - trackH / 2 : gx + trackH / 2;
        ctx.beginPath();
        ctx.arc(knobX, centerY, knobR, 0, Math.PI * 2);
        ctx.fillStyle = on ? "#eef2f6" : "#8a9199";
        ctx.fill();

        ctx.fillStyle = on ? def.color : secondary;
        ctx.fillText(def.label, gx + trackW + gap, centerY + 0.5);
    }
    ctx.restore();
}


function switchCellAt(localX, localY, width, height, count) {
    if (localY < 0 || localY > height || count <= 0) return -1;
    const pad = SWITCHBAR_PAD;
    const usableW = Math.max(0, width - 2 * pad);
    if (localX < pad || localX > pad + usableW) return -1;
    const cellW = usableW / count;
    if (cellW <= 0) return -1;
    const idx = Math.floor((localX - pad) / cellW);
    return (idx < 0 || idx >= count) ? -1 : idx;
}


function stringToBoolean(v) {
    if (typeof v === "boolean") return v;
    const s = String(v).toLowerCase().trim();
    return ["true","yes","on","1","+","t","check"].includes(s);
}


function getHiddenWidgetFromNode(node) {
    return node.widgets?.find(w => w.name === CACHE_KEY);
}


function showToast(detail, severity = "warn") {
    try {
        app.extensionManager?.toast?.add({
            severity,
            summary: "Prompt Builder",
            detail,
            life: 6000,
        });
    } catch (e) {
        console.warn("[PromptBuilder]", detail);
    }
}


function getCache(widget) {
    try {
        return JSON.parse(widget?.value ?? "{}");
    }
    catch (e) {
        console.warn("Bad cache JSON – resetting.");
        showToast("Cached values were corrupted and have been reset. Widget states may need to be re-set.");
        if (widget) widget.value = "{}";
        return {};
    }
}


function setCache(widget, obj) { 
    widget.value = JSON.stringify(obj); 
}


function writeWidgetCacheValue(widget, name, value) {
    if (!widget || !name) return;
    const cache = getCache(widget);
    cache[name] = value;
    setCache(widget, cache);
}


const BOOL_LIKE = new Set(["true", "false", "yes", "no", "on", "off", "1", "0", "+", "t", "check"]);

function parsePlaceholders(text) {
    if (!text) return [];
    const matches = text.matchAll(/\{\{([^}]*)\}\}/g);
    const out = [];

    for (const m of matches) {
        const parts = m[1].split(":");
        if (parts.length < 4) continue;    // NAME:TYPE:VALUE:DEFAULT[:USE_INPUT]
        const name = parts[0];
        const type = parts[1] || "STRING";
        const value = parts[2] || "";
        let def, use_input;
        if (parts.length >= 5 && BOOL_LIKE.has(parts[parts.length - 1].trim().toLowerCase())) {
            use_input = parts[parts.length - 1];
            def = parts.slice(3, -1).join(":");
        } else {
            def = parts.slice(3).join(":");
            use_input = "false";
        }
        if (!name.trim()) continue;        // ignore malformed
        out.push({
            name: name.trim(),
            type: type.trim().toUpperCase(),
            value: value.trim(),
            default: def.trim(),
            use_input: stringToBoolean(use_input)
        });
    }
    return out;
}


function parseToggleTags(text) {
    if (!text) return [];
    const paired = /\[\[([^:\]/[]+)(?::([^\]/[]+))?\]\]([\s\S]*?)\[\[\/?\1\]\]/g;
    const out = [];
    const seen = new Set();
    let scan = text;
    let changed = true;
    while (changed) {
        changed = false;
        paired.lastIndex = 0;
        scan = scan.replace(paired, (full, name, group, inner) => {
            name = name.trim();
            const grp = group ? group.trim() : undefined;
            const key = `${name} ${grp || ""}`;
            if (name && !seen.has(key)) {
                seen.add(key);
                out.push({ name, group: grp });
            }
            changed = true;
            return inner;   // unwrap to expose nested tags on the next pass
        });
    }
    return out;
}


function stripComments(text) {
    if (typeof text !== "string") return text == null ? "" : String(text);
    if (!text) return "";
    // Block comments: /* ... */
    text = text.replace(/\/\*[\s\S]*?\*\//g, "");
    // Line comments starting with // (only at line start or after whitespace, so URLs stay intact)
    text = text.replace(/(?:^|(?<=\s))\/\/.*$/gm, "");
    // Line comments starting with #
    text = text.replace(/^#.*$/gm, "");
    return text;
}


function parseExtraBlock(text) {
    const regex = /\[\%extra\%\]([\s\S]*?)\[\%\/?extra\%\]/;
    const m = regex.exec(text);
    return m ? m[1] : "";
}


// Enforce mutual exclusivity of grouped toggles: within a group keep the first
// enabled one (document order) and disable the rest. Used to repair state on load.
function reconcileToggleGroups(node, cache) {
    const seen = new Set();
    for (const w of node.widgets) {
        if (!w._spb_dynamic || w.type !== "toggle" || !w._spb_group) continue;
        if (stringToBoolean(w.value)) {
            if (seen.has(w._spb_group)) {
                w.value = false;
                cache[w.name] = false;
            } else {
                seen.add(w._spb_group);
            }
        }
    }
}


const typesCombo = ["COMBO","CMB","SELECT","SEL"];
const typesBoolean = ["B","BOOL","BOOLEAN","FLAG","FLG","CHECK"];
const typesInteger = ["INT","INTEGER","NUM","NUMBER"];
const typesFloat = ["REAL","FLOAT","REAL1","FLOAT1","REAL2","FLOAT2",
                    "REAL3","FLOAT3","REAL4","FLOAT4","REAL5","FLOAT5"];
const typesSlider = ["SLIDER"];
const typesSliderFloat = ["SLIDER1","SLIDER2","SLIDER3","SLIDER4","SLIDER5"];
const typesKnob = ["KNOB"];
const typesKnobFloat = ["KNOB1","KNOB2","KNOB3","KNOB4","KNOB5"];


function mapWidgetType(t) {
    const up = t.toUpperCase();
    if (typesCombo.includes(up)) return "combo";
    if (typesInteger.includes(up)) return "int";
    if (typesFloat.includes(up)) return "float";
    if (typesSlider.includes(up)) return "slider";
    if (typesSliderFloat.includes(up)) return "slider";
    if (typesBoolean.includes(up)) return "toggle";
    if (typesKnob.includes(up)) return "knob";
    if (typesKnobFloat.includes(up)) return "knob";
    return "string";
}


function mapInputsType(t) {
    const up = t.toUpperCase();
    if (typesCombo.includes(up)) return "combo";
    if (typesInteger.includes(up)) return "int";
    if (typesFloat.includes(up)) return "float";
    if (typesSlider.includes(up)) return "int";
    if (typesSliderFloat.includes(up)) return "float";
    if (typesBoolean.includes(up)) return "bool";
    if (typesKnob.includes(up)) return "int";
    if (typesKnobFloat.includes(up)) return "float";
    return "string";
}


function getNumberPrecision(defType, minimumValue = 1) {
    return Math.max(minimumValue, Number(defType?.slice(-1)) || minimumValue);
}


function getNumberStep(numberPrecision) {
    const raw = Number(numberPrecision);
    if (!Number.isFinite(raw) || raw <= 0) {
        return 1; // by default
    }
    const precision = Math.trunc(raw);
    return Math.pow(10, -precision);
}


function getNumberPrecisionAndStep(defType, minimumPrecision = 1) {
    const precision = getNumberPrecision(defType, minimumPrecision);
    return {
        precision: precision,
        step2: getNumberStep(precision)
    };
}


function getMinMaxForNumber(p, parser = Number) {
    const result = {};

    // ---- MIN -------------------------------------------------
    if ('value' in p && p.value != null) {             
        const v = parser(p.value);
        if (!Number.isNaN(v)) result.min = v;            
    }

    // ---- MAX -------------------------------------------------
    if ('default' in p && p.default != null) {
        const d = parser(p.default);
        if (!Number.isNaN(d)) result.max = d;
    }

    return result;
}


const widgetFactories = {
    combo(node, p) {
        const values = p.value.split(";").map(v=>v.trim()).filter(Boolean);
        const opts = { values };
        const def  = p.default?.trim() || values[0] || "";
        const w = node.addWidget("combo", p.name, def,
            v => writeWidgetCacheValue(getHiddenWidgetFromNode(node), p.name, v), 
            opts);
        w._spb_dynamic = true;
        return w;
    },
    int(node, p) {
        const opts = {
            precision: 0
        };
        const min = parseInt(p.value);
        const max = parseInt(p.default);
        if (!Number.isNaN(min)) opts.min = min;
        if (!Number.isNaN(max)) opts.max = max;
        const def = !Number.isNaN(min) ? min : (!Number.isNaN(max) ? max : 0);
        const w = node.addWidget("number", p.name, def,
            v => writeWidgetCacheValue(getHiddenWidgetFromNode(node), p.name, v),
            opts);
        w._spb_dynamic = true; 
        return w;
    },
    float(node, p) {
        const opts = Object.assign(getNumberPrecisionAndStep(p.type), getMinMaxForNumber(p));
        const def = Number(p.value) || Number(p.default) || 0;
        const w = node.addWidget("number", p.name, def,
            v => writeWidgetCacheValue(getHiddenWidgetFromNode(node), p.name, v),
            opts);
        w._spb_dynamic = true; 
        return w;
    },
    slider(node, p) {
        const opts = Object.assign(getNumberPrecisionAndStep(p.type, 0), getMinMaxForNumber(p));
        const def = Number(p.value) || Number(p.default) || 0;
        const w = node.addWidget("slider", p.name, def,
            v => writeWidgetCacheValue(getHiddenWidgetFromNode(node), p.name, v),
            opts);
        w._spb_dynamic = true; 
        return w;
    },
    knob(node, p) {
        const opts = Object.assign(getNumberPrecisionAndStep(p.type, 0), getMinMaxForNumber(p));
        const def = Number(p.value) || Number(p.default) || 0;
        const w = node.addWidget("knob", p.name, def,
            v => writeWidgetCacheValue(getHiddenWidgetFromNode(node), p.name, v),
            opts);
        w._spb_dynamic = true; 
        return w;
    },
    toggle(node, p) {
        const opts = {};
        const def = stringToBoolean(p.value) || stringToBoolean(p.default) || false;
        const w = node.addWidget("toggle", p.name, def,
            v => {
                // Write value to cache
                writeWidgetCacheValue(getHiddenWidgetFromNode(node), p.name, v);
                // Enforce group exclusivity if a group is defined and toggle is turned on
                const _group = w._spb_group || p.group;
                if (v && _group) {
                    const hiddenW = getHiddenWidgetFromNode(node);
                    const cache = getCache(hiddenW);
                    for (const widget of node.widgets) {
                        if (
                            widget._spb_dynamic &&
                            widget.type === "toggle" &&
                            widget !== w &&
                            widget._spb_group === _group
                        ) {
                            if (cache) cache[widget.name] = false;
                            widget.value = false;
                            // console.log(`Widget ${widget.name} turn off.`);
                        }
                    }
                    if (cache && hiddenW) setCache(hiddenW, cache);
                }
            },
            opts);
        w._spb_dynamic = true; 
        if (p.group) { 
            w._spb_group = p.group;
            for (const widget of node.widgets) {
                if (
                    widget._spb_dynamic &&
                    widget.type === "toggle" &&
                    widget !== w &&
                    widget._spb_group === p.group &&
                    widget.value === true
                ) {
                    w.value = false;
                }
            }
        }
        return w;
    }
};


function createDynamicWidget(node, placeholder) {
    const key = mapWidgetType(placeholder.type);
    const factory = widgetFactories[key];
    if (factory) return factory(node, placeholder);

    // fallback – simple text
    const def = placeholder.value || placeholder.default || "";
    const w = node.addWidget("string", placeholder.name, def,
        v => writeWidgetCacheValue(getHiddenWidgetFromNode(node), placeholder.name, v));
    w._spb_dynamic=true;
    return w;
}


app.registerExtension({
    name: `darkil_nodes_text.${NODE_NAME}`,

    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== NODE_NAME) return;

        const origOnNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const ret = origOnNodeCreated?.apply(this);
            this.serialize_widgets = true;   

            const _this_node = this;

            // Hidden widget for caching dynamic values
            const hidden_widget = this.addWidget("string", CACHE_KEY, "{}", () => {});
            hidden_widget.hidden = true;
            hidden_widget.computeSize = () => [0, -4];
            
            // Prompt input widget
            const promptWidget = this.widgets?.find(w => w.name === "prompt");
            if (!promptWidget) return;
            
            // Store original size for toggling visibility
            const origPromptWidgetComputeSize = promptWidget.computeSize;
            let syntaxEditor = null;
            let savedShownHeight = null;
            let promptShown = true;
            let applyingSize = false;
            let editorInitialized = false;

            // Persist the editor height in node.properties so it survives a reload.
            // Single writer: only a real user resize (after init) records the height —
            // no computeSize-based thresholds, they shift while widgets populate.
            function saveEditorHeight(h) {
                if (!_this_node.properties) _this_node.properties = {};
                _this_node.properties.editorHeight = h;
            }
            function readEditorHeight() {
                const h = Number(_this_node.properties?.editorHeight);
                return Number.isFinite(h) && h > 40 ? h : null;
            }
            // Best-known shown height: this session's value, then the persisted one,
            // else a floor (widget layout + a comfortable editor allowance).
            function desiredShownHeight() {
                const known = savedShownHeight ?? readEditorHeight();
                if (known != null) return known;
                const base = (_this_node.computeSize?.()?.[1]) || 200;
                return base + 160;
            }

            const origOnResize = this.onResize;
            this.onResize = function (size) {
                origOnResize?.call(this, size);
                if (editorInitialized && !applyingSize && promptShown && size) {
                    savedShownHeight = size[1];
                    saveEditorHeight(size[1]);
                }
            };

            function turnPromptWidgetVisible(v) {
                const show = stringToBoolean(v);
                syntaxEditor?.setVisible(show);
                if (show === promptShown) return;   // already in the desired state
                promptShown = show;
                promptWidget.hidden = !show;
                promptWidget.computeSize = show ? origPromptWidgetComputeSize : () => [0, -4];
                applyingSize = true;
                if (show) {
                    const h = desiredShownHeight();
                    _this_node.setSize([_this_node.size[0], h]);
                    savedShownHeight = h;
                } else {
                    // Collapse to just the remaining widgets; keep the user width.
                    const computed = _this_node.computeSize?.();
                    if (computed) _this_node.setSize([_this_node.size[0], computed[1]]);
                }
                applyingSize = false;
                _this_node.setDirtyCanvas(true, true);
            }

            // Compact inline switch bar — replaces the three full-width toggle
            // widgets ("Prompt visible", "Prompt enabled", "Extra enabled") with a
            // single row of three switches so they read as one distinct control.
            const switchStates = {
                [TOGGLE_KEY]: true,
                [TEXT_TOGGLE_KEY]: true,
                [EXTRA_TOGGLE_KEY]: false,
            };

            function currentLocale() {
                try { return app.ui.settings.getSettingValue("Comfy.Locale") || "en"; } catch (e) { return "en"; }
            }

            function buildSwitchDefs(locale) {
                const s = getStrings(locale).ui.switches;
                return [
                    { key: TOGGLE_KEY, label: s.view, color: "#4aa3df", onToggle: v => turnPromptWidgetVisible(v) },
                    { key: TEXT_TOGGLE_KEY, label: s.main, color: "#5bbf6a" },
                    { key: EXTRA_TOGGLE_KEY, label: s.extra, color: "#e0913a" },
                ];
            }

            let switchDefs = buildSwitchDefs(currentLocale());

            const switchBar = {
                name: "_spb_switchbar",
                type: "custom",
                value: "",
                serialize: false,
                _localeKey: currentLocale(),
                computeSize(width) { return [width, SWITCHBAR_H]; },
                draw(ctx, node, widgetWidth, widgetY, height) {
                    this.last_y = widgetY;
                    this.last_width = widgetWidth;
                    const loc = currentLocale();
                    if (loc !== this._localeKey) { this._localeKey = loc; switchDefs = buildSwitchDefs(loc); }
                    drawSwitchBar(ctx, widgetWidth, widgetY, SWITCHBAR_H, switchDefs, switchStates);
                },
                mouse(event, pos, node) {
                    const type = event.type || "";
                    if (!type.endsWith("down")) return false;
                    const width = this.last_width || node.size[0];
                    const localY = pos[1] - (this.last_y ?? 0);
                    const idx = switchCellAt(pos[0], localY, width, SWITCHBAR_H, switchDefs.length);
                    if (idx < 0) return false;
                    const def = switchDefs[idx];
                    const nv = !switchStates[def.key];
                    switchStates[def.key] = nv;
                    writeWidgetCacheValue(getHiddenWidgetFromNode(node), def.key, nv);
                    if (def.onToggle) def.onToggle(nv);
                    node.setDirtyCanvas(true, true);
                    return true;
                },
            };

            this.widgets.push(ignoreInjectedWidth(switchBar));
            writeWidgetCacheValue(hidden_widget, TOGGLE_KEY, switchStates[TOGGLE_KEY]);
            writeWidgetCacheValue(hidden_widget, TEXT_TOGGLE_KEY, switchStates[TEXT_TOGGLE_KEY]);
            writeWidgetCacheValue(hidden_widget, EXTRA_TOGGLE_KEY, switchStates[EXTRA_TOGGLE_KEY]);
            
            if (!this._spb_dynamicNames) {
                this._spb_dynamicNames = new Set();
            }

            function connectOrAddInput(node, widget, i_type) {
                if (!node || !widget || !widget.name || !i_type) return ;
                for (let i = node.inputs.length - 1; i >= 0; i--) {
                    if (node.inputs[i] && node.inputs[i].widget?.name === widget.name) {
                        if (node.inputs[i].widget._spb_dynamic !== true) {
                            node.inputs[i].widget = widget;
                            return widget;
                        }
                    }
                }
                return node.addInput(widget.name, i_type, {widget: widget});
            }

            function updateDynamicWidgets(node) {
                const rawPrompt = promptWidget.value;
                if (typeof rawPrompt !== "string") {
                    if (rawPrompt != null) console.warn("[PromptBuilder] prompt value is not a string, skipping update:", typeof rawPrompt, rawPrompt);
                    return;
                }
                const cleanPrompt = stripComments(rawPrompt);
                const placeholders = parsePlaceholders(cleanPrompt);
                const toggles = parseToggleTags(cleanPrompt);
                
                // Determine if extra block is active
                const cache = getCache(hidden_widget);
                const extraActive = stringToBoolean(cache[EXTRA_TOGGLE_KEY] ?? false);

                let extraPlaceholders = [];
                let extraToggles = [];
                
                if (extraActive) {
                    const extraBlockRaw = parseExtraBlock(cleanPrompt);
                    if (extraBlockRaw) {
                        // Comments already stripped globally, but strip again for safety
                        const extraClean = stripComments(extraBlockRaw);
                        extraPlaceholders = parsePlaceholders(extraClean);
                        extraToggles = parseToggleTags(extraClean);
                    }
                }
                
                // Reserved names collide with the node's own widgets (e.g. "prompt"),
                // which corrupts ComfyUI's by-name widget value store -> skip them.
                const allPlaceholders = [...placeholders, ...extraPlaceholders].filter(p => !RESERVED_NAMES.has(p.name));
                const allToggles = [...toggles, ...extraToggles].filter(t => !RESERVED_NAMES.has(t.name));

                const neededNames = new Set([
                    ...allToggles.map(t => t.name),
                    ...allPlaceholders.map(p => p.name)
                ]);
                
                
                // Remove widgets that are no longer referenced.
                for (let i = node.widgets.length - 1; i >= 0; i--) {
                    const w = node.widgets[i];
                    if (w === promptWidget || !w._spb_dynamic) continue;
                    if (!neededNames.has(w.name)) { 
                        const found_input_slot = node.findInputSlot(w.name);
                        node.removeWidget(w);
                        node._spb_dynamicNames.delete(w.name);
                        delete cache[w.name];
                        if (found_input_slot !== -1) node.removeInput(found_input_slot);                        
                    }
                }

                // Add / update toggle groups widgets.
                allToggles.forEach(t => {
                    const exists = node.widgets.find(w => w.name === t.name && w._spb_dynamic);
                    if (exists) {
                        // Ensure cache entry exists
                        if (exists.name in cache) exists.value = stringToBoolean(cache[exists.name]);
                        if (t.group && exists._spb_group !== t.group) {
                            cache[exists.name] = false
                            exists._spb_group = t.group;
                            exists.value = false;
                        } else if (!t.group && exists._spb_group) {
                            delete exists._spb_group;
                        } 
                        return ;
                    }
                    // Create new toggle widget (default enabled)
                    const p = { name: t.name, value: true, default: true, group: t.group };
                    const w = widgetFactories.toggle(node, p);
                    node._spb_dynamicNames.add(t.name);
                    if (w) {
                        // Restore a previously saved state instead of discarding it (incl. saved `false`).
                        if (w.name in cache) w.value = stringToBoolean(cache[w.name]);
                        else cache[w.name] = w.value;
                        w.label = `[[ ${t.name} ]]`;
                    }
                });
                
                node.setDirtyCanvas(true, true);

                // Add missing widgets for placeholders.
                allPlaceholders.forEach(p => {
                    const exists = node.widgets.find(w => w.name === p.name && w._spb_dynamic);
                    if (exists) {
                        if (exists.type === "combo") {
                            const new_values = p.value.split(";").map(v => v.trim()).filter(v => v.length > 0);
                            const old_values = exists.options.values;
                            try {
                                if (JSON.stringify(new_values) !== JSON.stringify(old_values)) exists.options.values = new_values;
                            } catch (error) {
                                console.log(error);
                            }
                        } else if (["number", "slider", "knob"].includes(exists.type)) {
                            exists.options.min = exists.options.precision === 0 ? parseInt(p.value) : parseFloat(p.value);
                            exists.options.max = exists.options.precision === 0 ? parseInt(p.default) : parseFloat(p.default);
                            if (isNaN(exists.options.min)) {
                                delete exists.options.min;
                            } else {
                                if (exists.options.min > exists.value) {
                                    cache[exists.name] = exists.options.min;
                                    exists.value = exists.options.min;
                                }
                                
                            }
                            if (isNaN(exists.options.max)) {
                                delete exists.options.max;
                            } else {
                                if (exists.options.max < exists.value) {
                                    cache[exists.name] = exists.options.max;
                                    exists.value = exists.options.max;
                                }
                            }
                        }
                        
                        if (exists.name in cache) exists.value = cache[exists.name];
                        
                        const i_type = mapInputsType(p.type);
                        const found_input_slot = node.findInputSlot(exists.name);
                        if (p.use_input === false && found_input_slot !== -1) {    
                            node.removeInput(found_input_slot);       
                        } else if (p.use_input === true && found_input_slot === -1) {
                            connectOrAddInput(node, exists, i_type);
                        }
                        return ;
                    }

                    const i_type = mapInputsType(p.type);
                    const w = createDynamicWidget(node, p);
                    node._spb_dynamicNames.add(p.name);
                    if (w) {
                        // Restore a previously saved value instead of discarding it (incl. saved 0 / "" / false).
                        if (w.name in cache) w.value = w.type === "toggle" ? stringToBoolean(cache[w.name]) : cache[w.name];
                        else cache[w.name] = w.value;
                    }

                    if (p.use_input === true && w) {
                        connectOrAddInput(node, w, i_type);
                    }

                });

                reconcileToggleGroups(node, cache);
                setCache(hidden_widget, cache);
                node.setDirtyCanvas(true, true);
            }
            
            function hidePromptWidgetIfNeed() {
                // Source of truth is the cache (written by the switch callback), NOT
                // widgets_values by index — dynamic widgets shift indices and desync it.
                const cache = getCache(hidden_widget);
                const v = cache[TOGGLE_KEY] !== undefined
                    ? stringToBoolean(cache[TOGGLE_KEY])
                    : switchStates[TOGGLE_KEY];
                switchStates[TOGGLE_KEY] = v;
                turnPromptWidgetVisible(v);
            }
            
            // Restore cached values and extra toggle state on load
            let valuesInitialized = false;
            function initValues() {
                if (!valuesInitialized && hidden_widget) {
                    const widget_index = _this_node.widgets.findIndex(w => w?.name === hidden_widget.name);
                    const saved_values = _this_node.widgets_values && widget_index !== -1 ? _this_node.widgets_values[widget_index] : "";
                    // if (saved_values && ["", "{}"].includes(hidden_widget.value.trim())) {
                    if (saved_values) {
                        valuesInitialized = true;
                        hidden_widget.value = saved_values;
                        // const allValues = hidden_widget.value ? JSON.parse(hidden_widget.value) : {};
                        const cache = getCache(hidden_widget);
                        for (let i = _this_node.widgets.length - 1; i >= 0; i--) {
                            const w = _this_node.widgets[i];
                            if (w.name === "prompt" || !(w.name in cache)) continue;
                            if (!w._spb_dynamic) continue;
                            if (cache[w.name] !== undefined) w.value = cache[w.name];
                        }
                        
                        // Restore text block toggle state
                        if (cache[TEXT_TOGGLE_KEY] !== undefined) {
                            switchStates[TEXT_TOGGLE_KEY] = stringToBoolean(cache[TEXT_TOGGLE_KEY]);
                        }

                        // Restore extra block toggle state
                        if (cache[EXTRA_TOGGLE_KEY] !== undefined) {
                            switchStates[EXTRA_TOGGLE_KEY] = stringToBoolean(cache[EXTRA_TOGGLE_KEY]);
                        }
                        
                        setCache(hidden_widget, cache);
                        hidePromptWidgetIfNeed();
                    }
                };
            }
            
            promptWidget.callback = (value) => {
                initValues();
                if (value) {
                    updateDynamicWidgets(_this_node);
                }
            };


            requestAnimationFrame(() => {
                initValues();
                updateDynamicWidgets(_this_node);
                setLocaleSetting(_this_node);
                try {
                    let locale = "en";
                    try { locale = app.ui.settings.getSettingValue("Comfy.Locale") || "en"; } catch (e) {}
                    syntaxEditor = attachSyntaxEditor(_this_node, promptWidget, { locale });
                } catch (e) {
                    console.warn("[PromptBuilder] syntax editor unavailable:", e);
                }
                // On load: node.size is ComfyUI's authoritative saved height, so trust
                // it and only intervene if the editor is actually collapsed. Remember
                // the persisted height for the hidden case (to restore it on show).
                if (promptShown) {
                    const base = (_this_node.computeSize?.()?.[1]) || 200;
                    if (_this_node.size[1] < base + 40) {
                        applyingSize = true;
                        _this_node.setSize([_this_node.size[0], Math.max(desiredShownHeight(), base + 160)]);
                        applyingSize = false;
                        _this_node.setDirtyCanvas(true, true);
                    }
                    savedShownHeight = _this_node.size[1];
                } else {
                    savedShownHeight = readEditorHeight();
                }
                editorInitialized = true;
            });
            return ret;
        };
    },
});
