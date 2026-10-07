---
orca-book: 1
title: Twenty Thousand Leagues Under the Sea
author: Jules Verne
language: "en-GB"
date: 1871-11-16
publisher: The Orca Library
trim: 5.5in 8.5in
margin-inside: 0.95in
margin-outside: 0.7in
margin-top: 0.8in
margin-bottom: 1in
body-font: EB Garamond
body-size: 10.5pt
body-line-spacing: 14pt
body-align: justify
body-first-line-indent: 1.2em
body-hyphens: true
body-hanging-punctuation: true
heading-1-font: IM FELL English
heading-1-size: 16pt
heading-1-align: center
heading-2-size: 9pt
heading-2-align: center
heading-2-letter-spacing: 0.2em
heading-2-space-above: 7
chapter-begins: next-page
chapter-drop-cap: 3
chapter-drop-cap-font: IM FELL English
chapter-first-line-caps: small-caps
chapter-first-line-letter-spacing: 0.04em
header-left-page: author
header-right-page: chapter-title
chapter-title-from: h1
header-caps: small-caps
header-letter-spacing: 0.1em
page-number-position: bottom
suppress-head-on-openings: true
---

# Front matter

- `title-page`
- [[Copyright]] `copyright`
- `contents`

# Body

- [[Part One]] `part`
- [[A squid of colossal dimensions]]
- [[A Shifting Reef]]
- [[Pro and Con]]
- [[I Form My Resolution]]
- [[Ned Land]]
- [[At a Venture]]
- [[At Full Steam]]
- [[An Unknown Species of Whale]]
- [[Mobilis in Mobili]]
- [[Ned Land’s Tempers]]
- [[The Man of the Seas]]
- [[All by Electricity]]
- [[Some Figures]]
- [[The Black River]]
- [[A Note of Invitation]]
- [[A Walk on the Bottom of the Sea]]
- [[A Submarine Forest]]
- [[Four Thousand Leagues Under the Pacific]]
- [[Vanikoro]]
- [[Torres Straits]]
- [[A Few Days on Land]]
- [[Captain Nemo’s Thunderbolt]]
- [[Aegri Somnia]]
- [[The Coral Kingdom]]
- [[Part Two]] `part`
- [[The Indian Ocean]]
- [[A Novel Proposal of Captain Nemo’s]]
- [[A Pearl of Ten Millions]]
- [[The Red Sea]]
- [[The Arabian Tunnel]]
- [[The Grecian Archipelago]]
- [[The Mediterranean in Forty-Eight Hours]]
- [[Vigo Bay]]
- [[A Vanished Continent]]
- [[The Submarine Coal-Mines]]
- [[The Sargasso Sea]]
- [[Cachalots and Whales]]
- [[The Iceberg]]
- [[The South Pole]]
- [[Accident or Incident]]
- [[Want of Air]]
- [[From Cape Horn to the Amazon]]
- [[The Poulps]]
- [[The Gulf Stream]]
- [[From Latitude 47° 24′ to Longitude 17° 28′]]
- [[A Hecatomb]]
- [[The Last Words of Captain Nemo]]
- [[Conclusion]]

# Back matter

- [[A note on the text]] `back-matter`
- [[Colophon]] `back-matter`

```css
/* The book prints in one colour beside black. */
section.chapter h2,
section.chapter p:first-of-type::first-letter,
section.part h1,
section.title-page h1,
section.contents p.part {
  color: #1d4e5b;
}

section.chapter h2 {
  text-transform: lowercase;
  font-variant-caps: small-caps;
}

section.title-page h1 {
  font-size: 24pt;
  line-height: 30pt;
}

/* The shell stands under the title, as it stands behind each chapter's. */
section.title-page h1 {
  margin-bottom: 1.3in;
}

section.title-page h1::after {
  content: "";
  position: absolute;
  top: 2.6in;
  left: 0;
  right: 0;
  height: 0.9in;
  background-image: url("nautilus.png");
  background-size: contain;
  background-repeat: no-repeat;
  background-position: center;
  opacity: 0.8;
}

section.part p {
  text-align: center;
  text-indent: 0;
  font-size: 18pt;
  color: #1d4e5b;
}

section.title-page p,
section.contents p.part {
  text-transform: lowercase;
  font-variant-caps: small-caps;
  letter-spacing: 0.15em;
}

/* IM Fell has no small capitals, so its headings are spaced capitals. */
section.part h1 {
  text-transform: uppercase;
  letter-spacing: 0.15em;
  padding-top: 2.4in;
  font-size: 14pt;
}

/* The plate stands in the middle of the paper rather than of the
   text block, which sits toward the spine. */
section#a-squid-of-colossal-dimensions {
  padding-top: 0.67in;
}

section#a-squid-of-colossal-dimensions img {
  position: relative;
  left: 0.125in;
}

/* The copyright sits small at the foot of its page. */
section.copyright > p {
  font-size: 8.5pt;
  line-height: 11pt;
  text-indent: 0;
  margin-bottom: 6pt;
}

/* The colophon is set as a centred block low on the last page. */
section#colophon {
  padding-top: 3.6in;
}

section#colophon p {
  text-align: center;
  text-indent: 0;
  font-style: italic;
  margin-bottom: 6pt;
}

section#colophon p:last-child {
  font-style: normal;
  font-size: 14pt;
  color: #1d4e5b;
}

section.copyright > p:first-child {
  padding-top: 4.6in;
}

/* Four body lines under the title keep the text clear of the shell. */
section.chapter h1 {
  margin-bottom: 56pt;
}

/* The box is placed from the top of the page area. At 81pt the middle
   of the shell is on the middle of the chapter heading. */
section.chapter h1::before {
  content: "";
  position: absolute;
  top: 81pt;
  left: 0;
  right: 0;
  height: 1in;
  background-image: url("nautilus.png");
  background-size: contain;
  background-repeat: no-repeat;
  background-position: center;
  opacity: 0.25;
  z-index: -1;
}
```
