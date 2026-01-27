import { app } from "../../scripts/app.js";
import { setLocaleSetting } from "./utils.js";

const NODE_IDS = ["darkilTextVariableBuilder", "darkilFilesList"]; //"darkilWan22VideoLoraListBuilder",


app.registerExtension({
    name: "darkil_simple_nodes_localization._watcher",

    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (!NODE_IDS.includes(nodeData.name)) return;

        const origOnNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = async function () {
            const result = await origOnNodeCreated?.apply(this, arguments);

            const node = this;
            // node.serialize_widgets = true;
            setLocaleSetting(node);

            requestAnimationFrame(async () => {
                // setLocaleSetting(node);
            });

            return result;
        };

        return nodeType;
    }

});
