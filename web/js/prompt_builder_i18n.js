// Localization strings for the darkilPromptBuilder editor. Pure module (no DOM /
// ComfyUI imports) so grammar can use its EN dictionary as the default and stay
// unit-testable. `getStrings(locale)` returns a locale dict with EN fallback.

const en = {
    dir: {
        spaceless: "Collapse all whitespace runs to a single space and trim.",
        lower: "Convert the wrapped text to lowercase.",
        upper: "Convert the wrapped text to UPPERCASE.",
        title: "Title-Case Each Word.",
        sentence: "Capitalize the first letter of each sentence.",
        trim: "Remove leading/trailing whitespace.",
        dedent: "Remove the common leading indentation.",
        collapse_newlines: "Squeeze multiple consecutive newlines into one.",
        strip_punct: "Delete all punctuation characters.",
        unescape_html: "Decode HTML entities (&amp; -> &, &lt; -> < ...).",
        list: "Clean list: drop empty lines and strip leading spaces.",
        list_rtrim: "Clean list and trim both sides of each line.",
        list_and: "Join lines with commas; the last joiner becomes ' and '.",
    },
    typeDesc: {
        combo: "Combo (dropdown) — VALUE is a ';'-separated option list, DEFAULT is the selected one.",
        bool: "Boolean toggle — VALUE/DEFAULT are true/false.",
        int: "Integer — VALUE is min, DEFAULT is max.",
        float: "Float — VALUE is min, DEFAULT is max; trailing digit sets decimal precision.",
        slider: "Slider — VALUE is min, DEFAULT is max; trailing digit sets precision.",
        knob: "Knob — VALUE is min, DEFAULT is max; trailing digit sets precision.",
        string: "String placeholder — VALUE is current, DEFAULT is the fallback.",
    },
    d: {
        phShort: (name) => `Placeholder reference {{${name}}} — reuses a value declared elsewhere.`,
        phFull: (name, type, kindDesc, socket) => `Placeholder "${name}" [${type}] — ${kindDesc}${socket}`,
        socket: () => " Creates an input socket.",
        directive: (c, isClose, desc) => `Directive "${c}" (${isClose ? "closes" : "opens"}) — ${desc}`,
        directiveUnknown: (name) => `Unknown directive "${name}". Formatting directives wrap text as {%name%}…{%name stop%}.`,
        toggleOpen: (name, group) => group
            ? `Toggle "${name}" in group "${group}" (mutually exclusive) — wrapped block is kept only when the toggle is on.`
            : `Toggle "${name}" — wrapped block is kept only when the toggle is on.`,
        toggleClose: (name) => `End of toggle "${name}".`,
        blockExtra: () => "Extra block — processed as a second output when 'Extra enabled' is on.",
        blockVars: () => "Vars block — ignored by the backend (notes/scratch area).",
        blockClose: (name) => `End of ${name} block.`,
        comment: () => "Comment — removed before processing.",
    },
    v: {
        reservedTag: (n) => `"${n}" is a reserved name — rename the tag.`,
        reservedPh: (n) => `"${n}" is a reserved name — rename the placeholder.`,
        closeNoOpenToggle: (n) => `Closing [[/${n}]] has no matching [[${n}]].`,
        closeNoOpenBlock: (n) => `Closing [%/${n}%] has no matching [%${n}%].`,
        unknownDirective: (n) => `Unknown directive "${n}".`,
        stopNoOpen: (n) => `{%${n} stop%} has no matching {%${n}%}.`,
        phFields: () => "Placeholder needs NAME:TYPE:VALUE:DEFAULT (4 fields).",
        unclosedToggle: (n) => `Unclosed toggle [[${n}]] — add [[/${n}]].`,
        unclosedBlock: (n) => `Unclosed [%${n}%] block — add [%/${n}%].`,
        unclosedDirective: (n) => `Unclosed {%${n}%} — add {%${n} stop%}.`,
        unclosedPlaceholder: () => "Unclosed placeholder — add }}.",
        unclosedComment: () => "Unclosed /* comment — add */.",
    },
    ui: {
        title: "prompt",
        switches: { view: "EDITOR", main: "PROMPT", extra: "EXTRA" },
        insert: "Insert ▾",
        vars: "Vars ▾",
        legendBtn: "?",
        insertTitle: "Insert a placeholder, toggle or directive",
        varsTitle: "Insert a reference to a declared variable",
        legendTitle: "Color legend",
        hint: "Tip: use “Insert” to add placeholders, toggles and directives.",
        issues: (n, msg) => `⚠ ${n} issue${n > 1 ? "s" : ""}: ${msg}`,
        noVars: "No declared variables yet.",
        sec: { placeholder: "Placeholder", toggle: "Toggle", directive: "Directive", block: "Block", other: "Other", insertVar: "Insert variable", legend: "Legend" },
        snip: {
            "String": "String", "Integer": "Integer", "Float": "Float", "Combo": "Combo",
            "Slider": "Slider", "Knob": "Knob", "Boolean": "Boolean", "Toggle": "Toggle",
            "Grouped (radio)": "Grouped (radio)", "Extra block": "Extra block", "Vars block": "Vars block", "Comment": "Comment",
        },
        legendRows: {
            ph: "Placeholder {{…}}", tag: "Toggle [[…]]", dir: "Directive {%…%}",
            block: "Block [%…%]", comment: "Comment", reserved: "Reserved name",
        },
    },
};

const ru = {
    dir: {
        spaceless: "Схлопнуть все пробелы/переносы в один пробел и обрезать края.",
        lower: "Перевести обёрнутый текст в нижний регистр.",
        upper: "Перевести обёрнутый текст в ВЕРХНИЙ РЕГИСТР.",
        title: "Каждое Слово С Заглавной Буквы.",
        sentence: "Первая буква каждого предложения — заглавная.",
        trim: "Убрать пробелы в начале и конце.",
        dedent: "Убрать общий ведущий отступ.",
        collapse_newlines: "Сжать несколько подряд идущих переносов строк в один.",
        strip_punct: "Удалить все знаки пунктуации.",
        unescape_html: "Декодировать HTML-сущности (&amp; -> &, &lt; -> < ...).",
        list: "Очистить список: убрать пустые строки и ведущие пробелы.",
        list_rtrim: "Очистить список и обрезать обе стороны каждой строки.",
        list_and: "Объединить строки запятыми; последний разделитель — « and ».",
    },
    typeDesc: {
        combo: "Combo (выпадающий список) — VALUE это список опций через «;», DEFAULT — выбранная.",
        bool: "Булев переключатель — VALUE/DEFAULT это true/false.",
        int: "Целое — VALUE это минимум, DEFAULT это максимум.",
        float: "Дробное — VALUE минимум, DEFAULT максимум; последняя цифра типа задаёт точность.",
        slider: "Слайдер — VALUE минимум, DEFAULT максимум; последняя цифра задаёт точность.",
        knob: "Ручка (knob) — VALUE минимум, DEFAULT максимум; последняя цифра задаёт точность.",
        string: "Строковый плейсхолдер — VALUE текущее значение, DEFAULT запасное.",
    },
    d: {
        phShort: (name) => `Ссылка на плейсхолдер {{${name}}} — переиспользует значение, объявленное в другом месте.`,
        phFull: (name, type, kindDesc, socket) => `Плейсхолдер «${name}» [${type}] — ${kindDesc}${socket}`,
        socket: () => " Создаёт входной сокет.",
        directive: (c, isClose, desc) => `Директива «${c}» (${isClose ? "закрытие" : "открытие"}) — ${desc}`,
        directiveUnknown: (name) => `Неизвестная директива «${name}». Директивы форматирования оборачивают текст как {%name%}…{%name stop%}.`,
        toggleOpen: (name, group) => group
            ? `Тег «${name}» в группе «${group}» (взаимоисключение) — блок остаётся только когда тег включён.`
            : `Тег «${name}» — блок остаётся только когда тег включён.`,
        toggleClose: (name) => `Конец тега «${name}».`,
        blockExtra: () => "Блок extra — обрабатывается как второй выход, когда включено «Extra enabled».",
        blockVars: () => "Блок vars — игнорируется бэкендом (заметки/черновик).",
        blockClose: (name) => `Конец блока ${name}.`,
        comment: () => "Комментарий — удаляется до обработки.",
    },
    v: {
        reservedTag: (n) => `«${n}» — зарезервированное имя, переименуй тег.`,
        reservedPh: (n) => `«${n}» — зарезервированное имя, переименуй плейсхолдер.`,
        closeNoOpenToggle: (n) => `Закрывающий [[/${n}]] без открывающего [[${n}]].`,
        closeNoOpenBlock: (n) => `Закрывающий [%/${n}%] без открывающего [%${n}%].`,
        unknownDirective: (n) => `Неизвестная директива «${n}».`,
        stopNoOpen: (n) => `{%${n} stop%} без открывающего {%${n}%}.`,
        phFields: () => "Плейсхолдер требует NAME:TYPE:VALUE:DEFAULT (4 поля).",
        unclosedToggle: (n) => `Незакрытый тег [[${n}]] — добавь [[/${n}]].`,
        unclosedBlock: (n) => `Незакрытый блок [%${n}%] — добавь [%/${n}%].`,
        unclosedDirective: (n) => `Незакрытая {%${n}%} — добавь {%${n} stop%}.`,
        unclosedPlaceholder: () => "Незакрытый плейсхолдер — добавь }}.",
        unclosedComment: () => "Незакрытый /* комментарий — добавь */.",
    },
    ui: {
        title: "промпт",
        switches: { view: "РЕДАКТОР", main: "ПРОМПТ", extra: "ЭКСТРА" },
        insert: "Вставить ▾",
        vars: "Перем. ▾",
        legendBtn: "?",
        insertTitle: "Вставить плейсхолдер, тег или директиву",
        varsTitle: "Вставить ссылку на объявленную переменную",
        legendTitle: "Легенда цветов",
        hint: "Подсказка: используй «Вставить», чтобы добавить плейсхолдеры, теги и директивы.",
        issues: (n, msg) => `⚠ замечаний (${n}): ${msg}`,
        noVars: "Пока нет объявленных переменных.",
        sec: { placeholder: "Плейсхолдер", toggle: "Тег", directive: "Директива", block: "Блок", other: "Прочее", insertVar: "Вставить переменную", legend: "Легенда" },
        snip: {
            "String": "Строка", "Integer": "Целое", "Float": "Дробное", "Combo": "Список",
            "Slider": "Слайдер", "Knob": "Ручка", "Boolean": "Булево", "Toggle": "Тег",
            "Grouped (radio)": "Группа (radio)", "Extra block": "Блок extra", "Vars block": "Блок vars", "Comment": "Комментарий",
        },
        legendRows: {
            ph: "Плейсхолдер {{…}}", tag: "Тег [[…]]", dir: "Директива {%…%}",
            block: "Блок [%…%]", comment: "Комментарий", reserved: "Зарезервировано",
        },
    },
};

export const LOCALES = { en, ru };

function merge(base, over) {
    const out = { ...base, ...over };
    for (const k of ["dir", "typeDesc", "d", "v"]) out[k] = { ...base[k], ...(over[k] || {}) };
    const bu = base.ui, ou = over.ui || {};
    out.ui = { ...bu, ...ou };
    out.ui.switches = { ...bu.switches, ...(ou.switches || {}) };
    out.ui.sec = { ...bu.sec, ...(ou.sec || {}) };
    out.ui.snip = { ...bu.snip, ...(ou.snip || {}) };
    out.ui.legendRows = { ...bu.legendRows, ...(ou.legendRows || {}) };
    return out;
}

export function getStrings(locale) {
    const code = String(locale || "en").slice(0, 2).toLowerCase();
    if (code === "en" || !LOCALES[code]) return en;
    return merge(en, LOCALES[code]);
}
