import { cssLanguage } from "@codemirror/lang-css";
const text = "p {\n  text-indent: 1em;\n  text-wrap: balance;\n}\n@foo bar;\n";
const tree = cssLanguage.parser.parse(text);
tree.iterate({ enter(n) { console.log(n.name, n.from, n.to, JSON.stringify(text.slice(n.from, n.to))); } });
