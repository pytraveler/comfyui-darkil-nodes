import { app } from "../../scripts/app.js";
import { setLocaleSetting } from "./utils.js";

const NODE_NAME = "darkilPromptBuilder";
const CACHE_KEY = "cachedValues";
const TOGGLE_KEY = "promptVisible";
const EXTRA_TOGGLE_KEY = "extraActive";
const TEXT_TOGGLE_KEY = "promptTextActive";


function stringToBoolean(v) {
    if (typeof v === "boolean") return v;
    const s = String(v).toLowerCase().trim();
    return ["true","yes","on","1","+","t","check"].includes(s);
}


function getHiddenWidgetFromNode(node) {
    return node.widgets?.find(w => w.name === CACHE_KEY);
}


function getCache(widget) {
    try { 
        return JSON.parse(widget?.value ?? "{}"); 
    }
    catch (e) { 
        console.warn("Bad cache JSON – resetting."); 
        widget.value="{}"; 
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


function parsePlaceholders(text) {
    if (!text) return [];
    const matches = text.matchAll(/\{\{([^}]*)\}\}/g);
    const out = [];

    for (const m of matches) {
        const parts = m[1].split(":");
        if (parts.length < 5) continue;
        const [name, type = "STRING", value = "", def = "", use_input = "false"] = parts;
        if (!name) continue;               // ignore malformed
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
    const regex = /\[\[([^:\]/]+)(?::([^\/\]]+))?\]\]([\s\S]*?)\[\[\/?\1\]\]/g;
    const out = [];
    let m;
    while ((m = regex.exec(text)) !== null) {
        const name = m[1].trim();
        const group = m[2] ? m[2].trim() : undefined;
        if (name) out.push({ name, group });
    }
    return out;
}


function stripComments(text) {
    if (!text) return "";
    // Block comments: /* ... */
    text = text.replace(/\/\*[\s\S]*?\*\//g, "");
    // Line comments starting with //
    text = text.replace(/\/\/.*$/gm, "");
    // Line comments starting with #
    text = text.replace(/^#.*$/gm, "");
    return text;
}


function parseExtraBlock(text) {
    const regex = /\[\%extra\%\]([\s\S]*?)\[\%\/?extra\%\]/;
    const m = regex.exec(text);
    return m ? m[1] : "";
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
        if (p.value) opts.min = parseInt(p.value);
        if (p.default) opts.max = parseInt(p.default);
        const def = p.value || p.default || 0;
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
            
            function turnPromptWidgetVisible(v) {
                if (!stringToBoolean(v) && !promptWidget.hidden) {
                    promptWidget.hidden = true;
                    promptWidget.computeSize = () => [0, -4];
                } else if (stringToBoolean(v) && promptWidget.hidden) {
                    promptWidget.hidden = false;
                    promptWidget.computeSize = origPromptWidgetComputeSize;
                }
            }
            
            function getToggleDrawValue(widget, option_on_text = 'enabled', option_off_text = 'ignored') {
                return (ctx, x) => {
                    ctx.fillStyle = widget.value ? widget.text_color : widget.secondary_text_color;
                    ctx.textAlign = 'right';
                    ctx.fontVariantCaps = "all-petite-caps";
                    const value = widget.value
                        ? widget.options.on || option_on_text
                        : widget.options.off || option_off_text;
                    ctx.fillText(value, x, widget.labelBaseline);
                    ctx.fontVariantCaps = "normal";
                };
            }
            
            function getToggleDrawLabel(widget) {
                return (ctx, x) => {
                    ctx.fillStyle = widget.secondary_text_color;
                    ctx.fontVariantCaps = "all-petite-caps";
                    const { displayName } = widget
                    if (displayName) ctx.fillText(displayName, x, widget.labelBaseline);
                    ctx.fontVariantCaps = "normal";
                };
            }
            
            
            // Toggle for showing/hiding the main prompt widget
            const toggle_prompt_widget = this.addWidget("toggle", TOGGLE_KEY, true, 
                v => {
                    writeWidgetCacheValue(getHiddenWidgetFromNode(_this_node), TOGGLE_KEY, v);
                    turnPromptWidgetVisible(v);
                });
            toggle_prompt_widget.label = "[Main] Prompt visibled";
            toggle_prompt_widget.drawValue = getToggleDrawValue(toggle_prompt_widget, 'shown', 'hidden');
            toggle_prompt_widget.drawLabel = getToggleDrawLabel(toggle_prompt_widget);
            
            // Prompt block activation toggle
            const promptToggleTextWidget = this.addWidget("toggle", TEXT_TOGGLE_KEY, true,
                v => {
                    writeWidgetCacheValue(getHiddenWidgetFromNode(_this_node), TEXT_TOGGLE_KEY, v);
                });
            promptToggleTextWidget.label = "[Main] Prompt enabled";
            promptToggleTextWidget.drawValue = getToggleDrawValue(promptToggleTextWidget);
            promptToggleTextWidget.drawLabel = getToggleDrawLabel(promptToggleTextWidget);
            writeWidgetCacheValue(hidden_widget, TEXT_TOGGLE_KEY, promptToggleTextWidget.value);
            
            // Extra block activation toggle
            const extraToggleWidget = this.addWidget("toggle", EXTRA_TOGGLE_KEY, false,
                v => {
                    writeWidgetCacheValue(getHiddenWidgetFromNode(_this_node), EXTRA_TOGGLE_KEY, v);
                });
            extraToggleWidget.label = "[Main] Extra enabled";
            extraToggleWidget.drawValue = getToggleDrawValue(extraToggleWidget);
            extraToggleWidget.drawLabel = getToggleDrawLabel(extraToggleWidget);
            writeWidgetCacheValue(hidden_widget, EXTRA_TOGGLE_KEY, extraToggleWidget.value);
            
            if (!this._spb_dynamicNames) {
                this._spb_dynamicNames = new Set();
            }

            function connectOrAddInput(node, widget, i_type) {
                if (!node && !widget && !widget.name && !i_type) return ;
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
                const cleanPrompt = stripComments(promptWidget.value);
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
                
                const allPlaceholders = [...placeholders, ...extraPlaceholders];
                const allToggles = [...toggles, ...extraToggles];
                
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
                    if (w && !cache[w.name]) cache[w.name] = w.value;
                    w.label = `[[ ${t.name} ]]`;
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
                    if (w && !cache[w.name]) cache[w.name] = w.value;

                    if (p.use_input === true && w) {
                        connectOrAddInput(node, w, i_type);
                    }

                });

                setCache(hidden_widget, cache);
                node.setDirtyCanvas(true, true);
            }
            
            function hidePromptWidgetIfNeed() {
                if (toggle_prompt_widget) {
                    const widget_index = _this_node.widgets.findIndex(w => w?.name === toggle_prompt_widget.name);
                    const saved_value = _this_node.widgets_values && widget_index !== -1 ? _this_node.widgets_values[widget_index] : false;
                    turnPromptWidgetVisible(saved_value);
                }
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
                        if (promptToggleTextWidget && cache[TEXT_TOGGLE_KEY] !== undefined) {
                            promptToggleTextWidget.value = stringToBoolean(cache[TEXT_TOGGLE_KEY]);
                        }
                        
                        // Restore extra block toggle state
                        if (extraToggleWidget && cache[EXTRA_TOGGLE_KEY] !== undefined) {
                            extraToggleWidget.value = stringToBoolean(cache[EXTRA_TOGGLE_KEY]);
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
            });
            return ret;
        };
    },
});
