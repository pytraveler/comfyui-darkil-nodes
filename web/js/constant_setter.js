import { app } from "../../scripts/app.js";
import { setLocaleSetting } from "./utils.js";

const NODE_ID = "darkilConstantSetter";
const PROPERTIES_KEY = "nodeProperties";
const VAR_INPUT_NAME = "var_to_convert";

// Helper functions for nodeProperties cache
function getNodePropertiesWidget(node) {
    return node.widgets?.find(w => w.name === PROPERTIES_KEY);
}

function getNodePropertiesCache(widget) {
    try {
        return JSON.parse(widget?.value ?? "{}");
    }
    catch (e) {
        console.warn("Bad nodeProperties JSON – resetting.");
        widget.value = "{}";
        return {};
    }
}

function setNodePropertiesCache(widget, obj) {
    widget.value = JSON.stringify(obj);
}

function writeNodePropertyValue(node, name, value) {
    const widget = getNodePropertiesWidget(node);
    if (!widget || !name) return;
    const cache = getNodePropertiesCache(widget);
    cache[name] = value;
    setNodePropertiesCache(widget, cache);
}

// Get precision from type suffix (e.g., FLOAT3 -> 3, SLIDER2 -> 2)
function getNumberPrecision(defType) {
    const lastChar = defType?.slice(-1);
    if (lastChar && !isNaN(lastChar)) {
        return parseInt(lastChar);
    }
    return null;
}

// Map widget type string to internal widget type
function mapWidgetType(t) {
    t = t.toUpperCase();
    if (["COMBO", "CMB"].includes(t)) return "combo";
    if (["INT", "INTEGER"].includes(t)) return "number"; // precision: 0
    
    // FLOAT/REAL with optional precision (FLOAT1-FLOAT5, REAL1-REAL5)
    if (t.startsWith("FLOAT") || t.startsWith("REAL")) {
        return "number";
    }
    
    // SLIDER with optional precision (SLIDER1-SLIDER5)
    if (t.startsWith("SLIDER")) return "slider";
    
    // KNOB with optional precision (KNOB1-KNOB2)
    if (t.startsWith("KNOB")) return "knob";
    
    if (["BOOL", "BOOLEAN"].includes(t)) return "toggle";
    return "text"; // STRING и др.
}

// Map widget type string to output type
function mapOutputType(t) {
    t = t.toUpperCase();
    if (["COMBO", "CMB"].includes(t)) return "combo,string";
    if (["INT", "INTEGER"].includes(t)) return "int";
    
    // FLOAT/REAL types - output as float
    if (t.startsWith("FLOAT") || t.startsWith("REAL")) return "float";
    
    // SLIDER/KNOB types - output as float
    if (t.startsWith("SLIDER") || t.startsWith("KNOB")) return "float";
    
    if (["BOOL", "BOOLEAN"].includes(t)) return "bool";

    return "*"; // STRING и др.
}

// Widget factories based on simple_prompt_builder.js pattern
const widgetFactories = {
    combo(node, name, defVal, callback, options = {}) {
        const opts = { values: options.values || [] };
        const w = node.addWidget("combo", name, defVal, callback, opts);
        w._css_dynamic = true;
        return w;
    },
    number(node, name, defVal, callback, options = {}) {
        const precision = options.precision ?? 2;
        // Calculate step based on precision
        let step = options.step;
        if (step === undefined) {
            step = precision > 0 ? Math.pow(10, -precision) : 1;
        }
        const opts = {
            precision: precision,
            min: options.min ?? -999999,
            max: options.max ?? 999999,
            step: step,
            step2: step
        };
        const w = node.addWidget("number", name, Number(defVal) || 0, callback, opts);
        w._css_dynamic = true;
        return w;
    },
    slider(node, name, defVal, callback, options = {}) {
        const precision = options.precision ?? 0;
        // Calculate step based on precision
        let step = options.step;
        if (step === undefined) {
            step = precision > 0 ? Math.pow(10, -precision) : 1;
        }
        const opts = {
            min: options.min ?? 0,
            max: options.max ?? 100,
            step: step,
            step2: step
        };
        const w = node.addWidget("slider", name, Number(defVal) || 0, callback, opts);
        w._css_dynamic = true;
        return w;
    },
    knob(node, name, defVal, callback, options = {}) {
        const precision = options.precision ?? 0;
        // Calculate step based on precision
        let step = options.step;
        if (step === undefined) {
            step = precision > 0 ? Math.pow(10, -precision) : 1;
        }
        const opts = {
            min: options.min ?? 0,
            max: options.max ?? 100,
            step: step,
            step2: step
        };
        const w = node.addWidget("knob", name, Number(defVal) || 0, callback, opts);
        w._css_dynamic = true;
        return w;
    },
    toggle(node, name, defVal, callback) {
        const def = Boolean(defVal);
        const w = node.addWidget("toggle", name, def, callback, {});
        w._css_dynamic = true;
        return w;
    },
    text(node, name, defVal, callback) {
        const w = node.addWidget("text", name, String(defVal) || "", callback, {});
        w._css_dynamic = true;
        return w;
    }
};

// Get widget type and create appropriate widget
function createDynamicWidget(node, propName, constType, defaultValue) {
    const widgetType = mapWidgetType(constType);
    const factory = widgetFactories[widgetType];
    const constUpper = constType.toUpperCase();
    
    // Get precision from type suffix (e.g., FLOAT3 -> 3)
    const precision = getNumberPrecision(constType);
    
    if (factory) {
        let options = {};
        
        // Add type-specific options
        if (widgetType === "combo") {
            const valuesStr = node.properties?.values || "";
            options.values = valuesStr.split(';').map(v => v.trim()).filter(Boolean);
        } else if (widgetType === "number") {
            if (["INT", "INTEGER"].includes(constUpper)) {
                options.precision = 0;
                options.step = 1;
            } else {
                // FLOAT/REAL with optional precision
                options.precision = precision ?? 2;
                options.step = precision !== null ? Math.pow(10, -precision) : 0.01;
            }
            if (node.properties?.minimum || node.properties?.minimum === 0) options.min = node.properties?.minimum;
            if (node.properties?.maximum || node.properties?.maximum === 0) options.max = node.properties?.maximum;
        } else if (widgetType === "slider" || widgetType === "knob") {
            options.min = node.properties?.minimum ?? 0;
            options.max = node.properties?.maximum ?? 100;
            options.precision = precision ?? 0;
        }
        
        return factory(node, propName, defaultValue, (value) => {
            writeNodePropertyValue(node, "default_value", value);
        }, options);
    }
    
    // Fallback to text widget
    return widgetFactories.text(node, propName, defaultValue, (value) => {
        writeNodePropertyValue(node, "default_value", value);
    });
}

// Initialize values from saved state
function initValues(_this_node, hidden_widget) {
    let valuesInitialized = false;
    
    return function initValuesInner() {
        if (!valuesInitialized && hidden_widget) {
            const widget_index = _this_node.widgets.findIndex(w => w?.name === hidden_widget.name);
            const saved_values = _this_node.widgets_values && widget_index !== -1 ? _this_node.widgets_values[widget_index] : "";
            
            if (saved_values) {
                valuesInitialized = true;
                hidden_widget.value = saved_values;
                
                const cache = getNodePropertiesCache(hidden_widget);
                
                // Restore cached property values to node.properties
                if (cache.const_type !== undefined) _this_node.properties.const_type = cache.const_type;
                if (cache.minimum !== undefined) _this_node.properties.minimum = cache.minimum;
                if (cache.maximum !== undefined) _this_node.properties.maximum = cache.maximum;
                if (cache.values !== undefined) _this_node.properties.values = cache.values;
                if (cache.input_enable !== undefined) _this_node.properties.input_enable = cache.input_enable;
                
                setNodePropertiesCache(hidden_widget, cache);
                
                // Return the cached default_value for use in setupWidgets
                return cache.default_value;
            }
        }
        return null;
    };
}

// Setup all widgets based on current properties
function setupWidgets(node, initialValue = null) {
    // Remove existing dynamic widgets
    for (let i = node.widgets.length - 1; i >= 0; i--) {
        const w = node.widgets[i];
        if (w._css_dynamic) {
            node.removeWidget(w);
        }
    }
    
    const constType = node.properties.const_type || "STRING";
    // Use initialValue from cache if provided, otherwise fall back to defaults
    const defaultValue = initialValue !== null ? initialValue : (node.properties.default_value || "");
    
    // Create the main value widget
    createDynamicWidget(node, "default_value", constType, defaultValue);
    if (node && node.outputs?.[0]) node.outputs[0].type = mapOutputType(constType);
    
    node.setDirtyCanvas(true, true);
}

// Update input slot based on input_enable property
function updateInputSlot(node) {
    const inputEnable = node.properties.input_enable ?? false;
    const hasInput = node.inputs && node.inputs.some(i => i.name === VAR_INPUT_NAME);
    
    if (inputEnable && !hasInput) {
        node.addInput(VAR_INPUT_NAME, "*");
    } else if (!inputEnable && hasInput) {
        const idx = node.findInputSlot(VAR_INPUT_NAME);
        if (idx !== -1) {
            node.removeInput(idx);
        }
    }
}

app.registerExtension({
    name: "darkilConstantSetter",

    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== NODE_ID) return;

        const origOnNodeCreated = nodeType.prototype.onNodeCreated;
        const origOnPropChanged = nodeType.prototype.onPropertyChanged;

        nodeType.prototype.onNodeCreated = async function () {
            const result = await origOnNodeCreated?.apply(this, arguments);

            this.serialize_widgets = true;

            // Hidden widget for caching node properties
            const hidden_widget = this.addWidget("string", PROPERTIES_KEY, "{}", () => {});
            hidden_widget.hidden = true;
            hidden_widget.computeSize = () => [0, -4];

            // Initialize properties with defaults
            this.properties = this.properties || {};
            this.properties.const_type = this.properties.const_type || "STRING";
            this.properties.minimum = this.properties.minimum ?? 0;
            this.properties.maximum = this.properties.maximum ?? 100;
            this.properties.values = this.properties.values || "";
            this.properties.input_enable = this.properties.input_enable ?? false;
            this.properties.default_value = this.properties.default_value || "";

            const node = this;

            // Sync initial properties to cache
            const propsCache = getNodePropertiesCache(hidden_widget);
            propsCache.const_type = this.properties.const_type;
            propsCache.minimum = this.properties.minimum;
            propsCache.maximum = this.properties.maximum;
            propsCache.values = this.properties.values;
            propsCache.input_enable = this.properties.input_enable;
            propsCache.default_value = this.properties.default_value;
            setNodePropertiesCache(hidden_widget, propsCache);

            // Setup initial widgets and input slot
            setupWidgets(node);
            updateInputSlot(node);

            // Handle property changes
            this.onPropertyChanged = function (propName) {
                origOnPropChanged?.apply(this, arguments);

                // Always sync the changed property to cache
                writeNodePropertyValue(node, propName, this.properties[propName]);

                if (propName === "const_type") {
                    // Recreate all widgets when type changes
                    setupWidgets(node);
                } else if (propName === "values" && node.properties.const_type.toUpperCase() === "COMBO") {
                    // Update combo values
                    const comboWidget = node.widgets.find(w => w.name === "default_value");
                    if (comboWidget && comboWidget.type === "combo") {
                        const valuesStr = node.properties.values || "";
                        comboWidget.options.values = valuesStr.split(';').map(v => v.trim()).filter(Boolean);
                        if (!comboWidget.options.values.includes(comboWidget.value)) {
                            comboWidget.value = comboWidget.options.values[comboWidget.options.values.length - 1] || "";
                        }
                        node.setDirtyCanvas(true, true);
                    }
                } else if (propName === "input_enable") {
                    // Add or remove input slot
                    updateInputSlot(node);
                } else if (propName === "minimum" || propName === "maximum") {
                    // Update slider/knob range and sync to cache
                    const widget = node.widgets.find(w => w._css_dynamic && w.name === "default_value");
                    if (widget && (widget.type === "slider" || widget.type === "knob" || ["number"].includes(widget.type))) {
                        widget.options.min = node.properties.minimum ?? 0;
                        widget.options.max = node.properties.maximum ?? 100;
                        node.setDirtyCanvas(true, true);
                    }
                }
            };

            // Create initValues closure for delayed initialization
            const initValuesInner = initValues(this, hidden_widget);

            requestAnimationFrame(async () => {
                // First restore cached values from widgets_values
                const cachedDefaultValue = initValuesInner();
                
                // Then setup widgets with restored value if available
                setupWidgets(node, cachedDefaultValue);
                updateInputSlot(node);
                setLocaleSetting(node);
            });

            return result;
        };

        return nodeType;
    }//,

    // getNodeMenuItems(node) {
    //     if (node.comfyClass !== NODE_ID) return;

    //     // Helper to toggle input_enable property
    //     const toggleInputEnable = () => {
    //         const widget = getNodePropertiesWidget(node);
    //         if (!widget) return;
            
    //         const cache = getNodePropertiesCache(widget);
    //         cache.input_enable = !cache.input_enable;
    //         setNodePropertiesCache(widget, cache);
            
    //         node.properties.input_enable = cache.input_enable;
    //         updateInputSlot(node);
            
    //         app.graph.setDirtyCanvas(true);
    //         app.canvas.setModified(true);
    //     };

    //     // Helper to change type
    //     const changeType = (newType) => {
    //         const widget = getNodePropertiesWidget(node);
    //         if (!widget) return;
            
    //         const cache = getNodePropertiesCache(widget);
    //         cache.const_type = newType;
    //         setNodePropertiesCache(widget, cache);
            
    //         node.properties.const_type = newType;
    //         setupWidgets(node);
            
    //         app.graph.setDirtyCanvas(true);
    //         app.canvas.setModified(true);
    //     };

    //     return [
    //         {
    //             content: "Switch the input for conversion",
    //             callback: toggleInputEnable
    //         },
    //         {
    //             content: "Change the conversion type >",
    //             submenu: {
    //                 options: [
    //                     { content: "STRING", callback: () => changeType("STRING") },
    //                     { content: "INT", callback: () => changeType("INT") },
    //                     { content: "FLOAT", callback: () => changeType("FLOAT") },
    //                     { content: "SLIDER", callback: () => changeType("SLIDER") },
    //                     { content: "KNOB", callback: () => changeType("KNOB") }
    //                 ]
    //             }
    //         }
    //     ];
    // }
});