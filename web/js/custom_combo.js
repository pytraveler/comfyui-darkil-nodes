import { app } from "../../scripts/app.js";

const NODE_ID = "darkilCustomCombo";


app.registerExtension({
    name: "darkil_nodes_logic." + NODE_ID,

    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== NODE_ID) return;

        const origOnNodeCreated = nodeType.prototype.onNodeCreated;
        const origOnPropChanged = nodeType.prototype.onPropertyChanged;
        
        nodeType.prototype.onNodeCreated = async function () {
            const result = await origOnNodeCreated?.apply(this, arguments);

            const node = this;
            
            this.serialize_widgets = true; 

            const selectorWidget = node.widgets.find(w => w.name === "list_selector");
            if (!selectorWidget) return;
            
            this.properties = this.properties || {};
            this.properties.text_for_combo = this.properties.text_for_combo || "nope";

            function updateSelectorWidget() {
                let raw = node.properties?.text_for_combo;

                if (raw) {
                    const values = raw.split(/\s*[;|]\s*/).map(v=>v.trim()).filter(Boolean);
                    selectorWidget.options.values = values;
                    if (!values.includes(selectorWidget.value))
                        selectorWidget.value = values[values.length - 1];
                    
                } else {
                    selectorWidget.options.values = [];
                    selectorWidget.value = "";
                }
                
                node.setDirtyCanvas(true, true);
            }
                        
            this.onPropertyChanged = function (propName) {
                origOnPropChanged?.apply(this, arguments);
                if (propName === "text_for_combo") {
                    updateSelectorWidget();
                }
            };
            
            let comboValueInitialized = false;
            requestAnimationFrame(async () => {
                if (!comboValueInitialized) {
                    comboValueInitialized = true;
                    const _value = node.widgets_values[0];
                    if (_value && selectorWidget) selectorWidget.value = _value;
                }
                updateSelectorWidget();
            });

            return result;
        };

        return nodeType;
    },
});
