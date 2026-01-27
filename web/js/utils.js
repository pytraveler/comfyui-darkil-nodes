import { app } from "../../scripts/app.js";

const DEFAULT_LOCALE_SETTING_NAME = "COMFY_LOCALE_SETTING";

export function setLocaleSetting(node) {
    if (typeof node?.addWidget === 'function') {
        const currentLocale = app.ui.settings.getSettingValue('Comfy.Locale');
        if (currentLocale) {
            const found = node.widgets.find(w => w.name === DEFAULT_LOCALE_SETTING_NAME);
            if (!found) {
                    const w = node.addWidget("string", DEFAULT_LOCALE_SETTING_NAME, "en", () => {}, {});
                    w.value = String(currentLocale);
                    w.hidden = true;
                    w.computeSize = () => [0, -4];
                    return w;
            } else {
                found.value = String(currentLocale);
                found.hidden = true;
                found.computeSize = () => [0, -4];
                return found;
            }
        }   
    }
}