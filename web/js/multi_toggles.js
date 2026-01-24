import { app } from "../../scripts/app.js";


const NODE_ID = "darkilMultiToggles";
const DEF_LAST_WORD = "";
const DEF_DELIMITER = ", ";


function _get_is_radio_toggle(node) {
    return node?.properties?.is_radio_toggles || false;
}
function _get_last_word_prop(node) {
    return node?.properties?.last_word || "";
}
function _get_delimiter_prop(node) {
    return node?.properties?.delimiter || ", ";
}
function _get_trim_values(node) {
    return node?.properties?.trim_values || false;
}

function _updateWidgets(node, changed_text, hidden_widget) {
    if (!node || !node.widgets) return;

    const oldToggles = node.widgets.filter(
        w => w.type === "toggle" && w.name !== "is_radio_toggle"
    );
    for (const w of oldToggles) {
        node.removeWidget(w);
    }

    const selectedSet = new Set(JSON.parse(hidden_widget.value || "[]"));

    if (!changed_text) return;

    const tokens = _get_trim_values(node) ? changed_text.split(/\s*[;|]+\s*/) : changed_text.split(/[;|]+/);
    if (!tokens.length) return;

    const parseToken = token => {
        const parts = token.split("::");
        if (parts.length === 2) {
            return {
                label: parts[0].trim(),
                value: _get_trim_values(node) ? parts[1].trim() : parts[1]
            };
        }
        const trimmed = _get_trim_values(node) ? token.trim() : token;
        return { label: trimmed, value: trimmed };
    };

    tokens.forEach(rawToken => {
        if (!rawToken) return;               

        const { label, value } = parseToken(rawToken);

        const w = node.addWidget("toggle", label, false, checked => {
            if (_get_is_radio_toggle(node)) {
                node.widgets
                    .filter(cw => cw.type === "toggle" && cw !== w)
                    .forEach(cw => (cw.value = false));

                selectedSet.clear();
                if (checked) selectedSet.add(value);
            } else {
                checked ? selectedSet.add(value) : selectedSet.delete(value);
            }

            hidden_widget.value = JSON.stringify([...selectedSet]);

            node.setDirtyCanvas(true, true);
        });

        if (w && selectedSet.has(value)) {
            w.value = true;
        }
    });
}


app.registerExtension({ 
	name: "darkil_nodes_logic." + NODE_ID,
    
	async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== NODE_ID) {
            return
        }
        
        const origOnNodeCreated = nodeType.prototype.onNodeCreated;
        const origOnPropChanged = nodeType.prototype.onPropertyChanged;

        nodeType.prototype.onNodeCreated = async function () {            
            const me = origOnNodeCreated?.apply(this);     
            
            this.serialize_widgets = true;
            
            const _default_compute_size = () => [0, -4];

            const hidden_widget = this.addWidget("string", "selected", "[]");
            hidden_widget.hidden = true;
            hidden_widget.computeSize = _default_compute_size;
            
            const hidden_w_last_word = this.addWidget("string", "last_word", DEF_LAST_WORD);
            hidden_w_last_word.hidden = true;
            hidden_w_last_word.computeSize = _default_compute_size;
            
            const hidden_w_delimiter = this.addWidget("string", "delimiter", DEF_DELIMITER);
            hidden_w_delimiter.hidden = true;
            hidden_w_delimiter.computeSize = _default_compute_size;
            
            this.properties = this.properties || {};
            this.properties.text_for_toggles = this.properties.text_for_toggles || "nope";
            this.properties.is_radio_toggles = this.properties.is_radio_toggles || false;
            this.properties.last_word = this.properties.last_word || DEF_LAST_WORD;
            this.properties.delimiter = this.properties.delimiter || DEF_DELIMITER;
            this.properties.trim_values = this.properties.trim_values || false;
            
            const node = this; 
            
            this.onPropertyChanged = function (propName) {
                origOnPropChanged?.apply(this, arguments);
                if (["text_for_toggles", "is_radio_toggles", "trim_values"].includes(propName)) {
                    _updateWidgets(node, node.properties?.text_for_toggles, hidden_widget);
                } else if (["last_word", "delimiter"].includes(propName)) {
                    if (propName === "last_word") hidden_w_last_word.value = _get_last_word_prop(node);
                    if (propName === "delimiter") hidden_w_delimiter.value = _get_delimiter_prop(node);
                }
                
            };
            
            requestAnimationFrame(async () => {
                _updateWidgets(node, node.properties?.text_for_toggles, hidden_widget);
                hidden_w_last_word.value = _get_last_word_prop(node);
                hidden_w_delimiter.value = _get_delimiter_prop(node);
            });
            
            
            return me;
        }
        
        return nodeType;
    },
    
})