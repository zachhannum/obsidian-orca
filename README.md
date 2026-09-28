# Orca

Orca is a book designer inside Obsidian. Each chapter is a Markdown note, and one book note stores the book details and the design. You preview the typeset book and export it to PDF without leaving Obsidian.

The docs and a live demo of the design panel are at [orca.typeworks.dev](https://orca.typeworks.dev).

![Orca in Obsidian, with a chapter note, the design panel and the typeset page](https://raw.githubusercontent.com/zachhannum/obsidian-orca/main/site/src/shots/landing-dark-1440.png)

## What orca does

- Chapters stay notes. The book note lists the chapters in reading order, as links. Its properties are the title, the author, the other metadata and the design.
- You write chapters in Markdown. Switch the pane to the preview to see the typeset book, open at the page you are writing.
- The design panel has a control for the trim size, the margins, the type, the headings and more. The preview updates with each change.
- The design panel writes CSS for you, and you can add your own rules to the book note. In inspect mode, a click on the page shows the CSS that styles that text, and which rules take effect.
- Export writes the PDF from the pages on screen. Preflight finds missing fonts and images before you export.

## Get started

Orca runs in Obsidian on the desktop, version 1.7.2 or later.

1. Install orca. The [install page](https://orca.typeworks.dev/start/install/) has the steps.
2. In the file tree, right-click the folder that holds your chapters.
3. Select `Create book from these notes`.

[Make a book](https://orca.typeworks.dev/start/make-a-book/) continues from there. The [design section](https://orca.typeworks.dev/design/overview/) explains each control in the panel.

## The engine

Orca sets the pages with [fleuron](https://github.com/zachhannum/fleuron), a typesetting engine that runs as WebAssembly inside the plugin. Orca makes no network requests.

## Contributing

Bug reports and ideas go in [the issues](https://github.com/zachhannum/obsidian-orca/issues). To build orca from source, read [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
