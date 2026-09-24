# NLCo blog template

A small, static, Distill-inspired blog for research groups and individual authors. Posts are Markdown files; the generated `dist/` directory is plain HTML, CSS, and images.

## Quick start

```sh
npm install
npm run build
npm run serve
```

Open the local address printed by `serve`. It watches `content/`, rebuilds when Markdown or BibTeX files change, and reloads open preview pages automatically. The preview server uses only Node’s built-in HTTP module.

## Write the homepage

The site homepage is `content/index.md`. It is a normal article, with the same YAML front matter and Markdown body as every other page.

## Add another page

Create `content/my-post.md`. Its relative path becomes the URL (`/my-post/`). Start it with YAML front matter:

```md
---
title: "My research note"
description: "One clear sentence for the home page and search previews."
date: 2026-07-10
authors:
  - name: "Ada Lovelace$^1$"
    url: https://example.com
  - name: "Alan Turing$^2$"
affiliations:
  - "$^1$ Analytical Engine Lab"
  - "$^2$ Computing Machinery Group"
tags: [interpretability, methods]
---

Write the article in **ordinary Markdown**.
```

All front-matter fields except `title` are optional. Nested files are allowed: `content/notes/a-note.md` becomes `/notes/a-note/`. A nested `index.md` becomes that directory’s index: `content/notes/index.md` becomes `/notes/`.

Author and affiliation fields support compact superscripts with `$^...$` or `$^{...}$`, for example `"Ada Lovelace$^1$"`.

## Site settings

Edit `config.yml` to set the site name, description, footer copyright, language, and `base_url`. For a project site at `https://username.github.io/blog`, set:

```yaml
base_url: /blog
```

For `https://username.github.io`, leave it empty. Put images and other files in `public/`; they are copied unchanged into `dist/`.

Use `copyright` to render a copyright notice in the footer:

```yaml
copyright: 2026 BIGAI NLCo Group. All rights reserved.
```

The header is optional. To show a left-aligned logo and site name, add this to `config.yml` (the bundled example uses `public/images/TA_logo.svg`):

```yaml
header:
  site_logo: /images/TA_logo.svg
```

Remove the entire `header:` block to omit the header.

## Mathematics

MathJax is loaded from its CDN—no additional npm package is required. Use `$E = mc^2$` for inline mathematics and `$$ ... $$` on their own lines for display equations. The homepage includes a working example.

## Citations and references

Add a BibTeX file next to a page and declare it in that page’s YAML front matter:

```yaml
bibliography: references.bib
citation_style: apa # optional; APA is the default
```

Use `[@citation-key]` for a parenthetical APA citation or `@citation-key` for a narrative citation. Citations link to the automatically generated **References** section at the end of the page. Multiple bibliography files are supported with a YAML list.

Distill-style back matter can also be declared in page front matter. These fields render after the article body and before the generated References list:

```yaml
acknowledgements: >
  We thank the NLCo group for testing the draft template.
author_contributions: >
  Ada drafted the article; Alan reviewed the examples.
discussion_and_review:
  - "[Review notes](https://example.com)"
```

`acknowledgments` is also accepted. Markdown and citations work inside these fields.

## Section navigation

On desktop screens, each page receives a sticky left-hand table of contents from its Markdown `##` and `###` headings. It scrolls to a heading when clicked and follows the active section while the reader scrolls.

## Charts and tables

Chart.js is loaded from its CDN. Add a responsive chart with a `chart` code fence containing a normal Chart.js configuration:

```chart
{
  "type": "bar",
  "data": {
    "labels": ["A", "B", "C"],
    "datasets": [{ "label": "Score", "data": [3, 7, 5] }]
  }
}
```

Markdown pipe tables render as styled responsive tables. See the homepage for working chart and table examples.

## Syntax-highlighted code

Fenced code blocks are statically highlighted during `npm run build` with Highlight.js. Use a language tag such as `python`, `javascript`, or `bibtex` after the opening fence.

## GitHub Pages

The included workflow deploys on every push to `main`.

1. Push this project to GitHub.
2. In the repository’s **Settings → Pages**, choose **GitHub Actions** as the source.
3. If this is a project repository, update `base_url` in `config.yml` before pushing.

The workflow uses only `npm ci`, `npm run build`, and GitHub’s Pages actions.

## Theme notes

The layout is an original lightweight implementation inspired by the editorial proportions of the [Distill template](https://github.com/distillpub/template): a prominent sans-serif title block, metadata centered below it, and a narrow serif reading column with support for wider figures. The original Distill template is Apache-2.0 licensed.
