import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import matter from 'gray-matter';
import hljs from 'highlight.js';
import MarkdownIt from 'markdown-it';
import anchor from 'markdown-it-anchor';

const root = process.cwd();
const contentDirectory = path.join(root, 'content');
const outputDirectory = path.join(root, 'dist');
const publicDirectory = path.join(root, 'public');

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function normaliseBaseUrl(value = '') {
  const base = String(value).trim().replace(/^\/+|\/+$/g, '');
  return base ? '/' + base : '';
}

function urlFor(baseUrl, target = '/') {
  return baseUrl + (target.startsWith('/') ? target : '/' + target);
}

function configuredUrlFor(baseUrl, target) {
  const value = String(target || '').trim();
  if (/^(?:https?:)?\/\//i.test(value) || value.startsWith('data:')) return value;
  return urlFor(baseUrl, value);
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function markdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(file);
    return /\.md$/i.test(entry.name) ? [file] : [];
  }));
  return files.flat();
}

async function readConfig() {
  const file = path.join(root, 'config.yml');
  if (!await exists(file)) return {};
  const source = await readFile(file, 'utf8');
  return matter('---\n' + source + '\n---').data;
}

function highlightBibtex(code) {
  return escapeHtml(code)
    .replace(/^(@[A-Za-z]+)/gm, '<span class="hljs-keyword">$1</span>')
    .replace(/^(\s*)([A-Za-z][A-Za-z0-9_-]*)(\s*=)/gm, '$1<span class="hljs-attr">$2</span>$3')
    .replace(/\{([^{}]*)\}/g, '<span class="hljs-string">{$1}</span>');
}

const markdown = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  highlight: (code, language = '') => {
    const normalizedLanguage = language.toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (normalizedLanguage === 'bib' || normalizedLanguage === 'bibtex') {
      return '<pre><code class="hljs language-' + normalizedLanguage + '">' + highlightBibtex(code) + '</code></pre>';
    }
    const languageAliases = {};
    const highlightLanguage = languageAliases[normalizedLanguage] || normalizedLanguage;
    const supported = highlightLanguage && hljs.getLanguage(highlightLanguage);
    const rendered = supported
      ? hljs.highlight(code, { language: highlightLanguage, ignoreIllegals: true }).value
      : escapeHtml(code);
    const className = supported ? 'hljs language-' + normalizedLanguage : 'hljs';
    return '<pre><code class="' + className + '">' + rendered + '</code></pre>';
  }
})
  .use(anchor, { slugify: (text) => text.trim().toLowerCase().replace(/[^\w]+/g, '-').replace(/(^-|-$)/g, '') });

function renderMarkdown(source, baseUrl = '') {
  const chartSource = source.replace(/```chart\s*\n([\s\S]*?)```/g, (_, configSource) => {
    let config;
    try {
      config = JSON.parse(configSource);
    } catch (error) {
      throw new Error('Invalid chart JSON: ' + error.message);
    }
    if (!config.type || !config.data) {
      throw new Error('A chart block needs both "type" and "data" fields.');
    }
    const encodedConfig = Buffer.from(JSON.stringify(config)).toString('base64');
    return '\n<div class="chart-container"><canvas class="chart" data-chart-config="'
      + encodedConfig + '" role="img"></canvas></div>\n';
  });
  const expressions = [];
  const protect = (expression) => {
    const marker = '@@NLCO_MATH_' + expressions.length + '@@';
    expressions.push(expression);
    return marker;
  };
  const renderSegment = (segment) => segment
    .replace(/\$\$([\s\S]*?)\$\$/g, (_, expression) => protect('$$' + expression + '$$'))
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, expression) => protect('\\[' + expression + '\\]'))
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, expression) => protect('\\(' + expression + '\\)'))
    .replace(/(^|[^\\$])\$([^$\n]+?)\$/g, (_, prefix, expression) => prefix + protect('$' + expression + '$'));
  const protectedSource = chartSource
    .split(/(```[\s\S]*?```)/g)
    .map((segment) => segment.startsWith('```') ? segment : renderSegment(segment))
    .join('');
  let rendered = markdown.render(protectedSource)
    .replace(/@@NLCO_MATH_(\d+)@@/g, (_, index) => expressions[Number(index)]);

  // Fix absolute paths for assets when baseUrl is set
  if (baseUrl) {
    rendered = rendered
      .replace(/src="(\/(?:assets|images|trace_example|papers)\/[^"]+)"/g, (match, path) => {
        return 'src="' + baseUrl + path + '"';
      })
      .replace(/href="(\/(?:assets|images|trace_example|papers)\/[^"]+)"/g, (match, path) => {
        return 'href="' + baseUrl + path + '"';
      })
      .replace(/data-trace-file="(\/[^"]+)"/g, (match, path) => {
        return 'data-trace-file="' + baseUrl + path + '"';
      });
  }

  // Color benchmark gains and declines in tables while leaving the score itself intact.
  return rendered.replace(/<table[\s\S]*?<\/table>/g, (table) => table
    .replace(/\(\+(\d+(?:\.\d+)?)\)/g, '<span class="benchmark-gain">(+$1)</span>')
    .replace(/\(-(\d+(?:\.\d+)?)\)/g, '<span class="benchmark-decline">(-$1)</span>'));
}

function cleanBibText(value = '') {
  return String(value).replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
}

function parseBibtex(source) {
  const entries = [];
  let cursor = 0;
  const skipSpace = () => {
    while (/\s/.test(source[cursor] || '')) cursor += 1;
  };
  const readBalanced = (open, close) => {
    cursor += 1;
    let depth = 1;
    let value = '';
    while (cursor < source.length && depth) {
      const character = source[cursor++];
      if (character === '\\') {
        value += character + (source[cursor++] || '');
      } else if (character === open) {
        depth += 1;
        value += character;
      } else if (character === close) {
        depth -= 1;
        if (depth) value += character;
      } else {
        value += character;
      }
    }
    return value.trim();
  };
  const readQuoted = () => {
    cursor += 1;
    let value = '';
    while (cursor < source.length) {
      const character = source[cursor++];
      if (character === '\\') value += character + (source[cursor++] || '');
      else if (character === '"') break;
      else value += character;
    }
    return value.trim();
  };

  while (cursor < source.length) {
    const at = source.indexOf('@', cursor);
    if (at < 0) break;
    cursor = at + 1;
    const typeMatch = source.slice(cursor).match(/^([A-Za-z]+)/);
    if (!typeMatch) continue;
    const type = typeMatch[1].toLowerCase();
    cursor += typeMatch[1].length;
    skipSpace();
    const open = source[cursor];
    if (open !== '{' && open !== '(') continue;
    const close = open === '{' ? '}' : ')';
    cursor += 1;
    skipSpace();
    const keyStart = cursor;
    while (cursor < source.length && source[cursor] !== ',' && source[cursor] !== close) cursor += 1;
    const citationKey = source.slice(keyStart, cursor).trim();
    if (source[cursor] !== ',') {
      if (source[cursor] === close) cursor += 1;
      continue;
    }
    cursor += 1;
    const fields = {};

    while (cursor < source.length) {
      skipSpace();
      if (source[cursor] === ',') {
        cursor += 1;
        continue;
      }
      if (source[cursor] === close) {
        cursor += 1;
        break;
      }
      const nameMatch = source.slice(cursor).match(/^([A-Za-z][A-Za-z0-9_-]*)/);
      if (!nameMatch) {
        cursor += 1;
        continue;
      }
      const name = nameMatch[1].toLowerCase();
      cursor += nameMatch[1].length;
      skipSpace();
      if (source[cursor] !== '=') continue;
      cursor += 1;
      skipSpace();
      let value = '';
      if (source[cursor] === '{') value = readBalanced('{', '}');
      else if (source[cursor] === '"') value = readQuoted();
      else {
        const valueStart = cursor;
        while (cursor < source.length && source[cursor] !== ',' && source[cursor] !== close) cursor += 1;
        value = source.slice(valueStart, cursor).trim();
      }
      fields[name] = value;
    }
    if (!['comment', 'preamble', 'string'].includes(type) && citationKey) {
      entries.push({ citationKey, type, fields });
    }
  }
  return entries;
}

function referenceId(key) {
  return 'ref-' + String(key).toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
}

function bibField(entry, name) {
  const fields = entry.fields || {};
  return cleanBibText(fields[name] || '');
}

function parseAuthors(value = '') {
  return cleanBibText(value).split(/\s+and\s+/i).filter(Boolean).map((author) => {
    const parts = author.split(',').map((part) => part.trim()).filter(Boolean);
    if (parts.length > 1) return { family: parts[0], given: parts.slice(1).join(' ') };
    const words = author.split(/\s+/);
    return { family: words.pop() || author, given: words.join(' ') };
  });
}

function citationAuthor(entry) {
  const authors = parseAuthors(bibField(entry, 'author') || bibField(entry, 'editor'));
  if (!authors.length) return bibField(entry, 'organization') || 'Anonymous';
  if (authors.length === 1) return authors[0].family;
  if (authors.length === 2) return authors[0].family + ' & ' + authors[1].family;
  return authors[0].family + ' et al.';
}

function apaAuthors(entry) {
  const authors = parseAuthors(bibField(entry, 'author') || bibField(entry, 'editor'));
  if (!authors.length) return bibField(entry, 'organization') || 'Anonymous';
  const names = authors.map((author) => {
    const initials = author.given.split(/[\s-]+/).filter(Boolean).map((part) => part[0].toUpperCase() + '.').join(' ');
    return author.family + (initials ? ', ' + initials : '');
  });
  if (names.length === 1) return names[0];
  if (names.length === 2) return names.join(' & ');
  return names.slice(0, -1).join(', ') + ', & ' + names.at(-1);
}

function citationYear(entry) {
  return bibField(entry, 'year') || 'n.d.';
}

function citationLink(entry, key, number, narrative = false) {
  const author = citationAuthor(entry);
  const label = narrative ? author + ' [' + number + ']' : number;
  return '<a class="citation" href="#' + referenceId(key) + '">' + escapeHtml(label) + '</a>';
}

function citationSource(source, bibliography) {
  const cited = new Set();
  const resolve = (key) => {
    const entry = bibliography.get(key);
    if (!entry) throw new Error('Citation @' + key + ' has no matching BibTeX entry.');
    cited.add(key);
    return { entry, number: [...cited].indexOf(key) + 1 };
  };
  const parenthetical = (payload) => {
    const parts = payload.split(';').map((part) => part.trim()).filter(Boolean);
    const rendered = parts.map((part) => {
      const match = part.match(/@([A-Za-z0-9_:.\/-]+)/);
      if (!match) return escapeHtml(part);
      const { entry, number } = resolve(match[1]);
      const before = part.slice(0, match.index).trim();
      const after = part.slice((match.index || 0) + match[0].length).replace(/^\s*,\s*/, '');
      return (before ? escapeHtml(before) + ' ' : '') + citationLink(entry, match[1], number)
        + (after ? ', ' + escapeHtml(after) : '');
    });
    return '[' + rendered.join(', ') + ']';
  };
  const transformSegment = (segment) => segment
    .replace(/\[([^\]\n]*@[^\]\n]+)\]/g, (_, payload) => parenthetical(payload))
    .replace(/(^|[^\w@])@([A-Za-z0-9_:.\/-]+)/g, (_, prefix, key) => {
      const { entry, number } = resolve(key);
      return prefix + citationLink(entry, key, number, true);
    });
  const transformed = source
    .split(/(```[\s\S]*?```)/g)
    .map((segment) => segment.startsWith('```') ? segment : transformSegment(segment))
    .join('');
  return { source: transformed, cited };
}

function extractFootnotes(source) {
  const definitions = new Map();
  const bodyLines = [];
  const lines = source.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^\[\^([A-Za-z0-9_-]+)\]:\s*(.*)$/);
    if (!match) {
      bodyLines.push(lines[index]);
      continue;
    }
    const content = [match[2]];
    while (index + 1 < lines.length && /^(?: {2,}|\t)\S/.test(lines[index + 1])) {
      content.push(lines[index + 1].trim());
      index += 1;
    }
    definitions.set(match[1], content.join(' '));
  }

  const used = [];
  const numberByKey = new Map();
  const replaceReferences = (segment) => segment.replace(/\[\^([A-Za-z0-9_-]+)\]/g, (marker, key) => {
    if (!definitions.has(key)) return marker;
    if (!numberByKey.has(key)) {
      numberByKey.set(key, used.length + 1);
      used.push({ key, source: definitions.get(key) });
    }
    const number = numberByKey.get(key);
    const id = key.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
    return '<sup class="footnote-ref" id="fnref-' + id + '"><a href="#fn-' + id
      + '" aria-label="Footnote ' + number + '">' + number + '</a></sup>';
  });
  const transformed = bodyLines.join('\n')
    .split(/(```[\s\S]*?```)/g)
    .map((segment) => segment.startsWith('```') ? segment : replaceReferences(segment))
    .join('');
  return { source: transformed, footnotes: used };
}

function apaReference(entry, key) {
  const type = entry.type.toLowerCase();
  const authors = escapeHtml(apaAuthors(entry));
  const year = escapeHtml(citationYear(entry));
  const title = escapeHtml(bibField(entry, 'title'));
  const journal = escapeHtml(bibField(entry, 'journal'));
  const volume = escapeHtml(bibField(entry, 'volume'));
  const number = escapeHtml(bibField(entry, 'number'));
  const pages = escapeHtml(bibField(entry, 'pages').replace(/--/g, '–'));
  const publisher = escapeHtml(bibField(entry, 'publisher'));
  const booktitle = escapeHtml(bibField(entry, 'booktitle'));
  const edition = escapeHtml(bibField(entry, 'edition'));
  const doi = bibField(entry, 'doi');
  const url = bibField(entry, 'url');
  const location = url || (doi ? 'https://doi.org/' + doi.replace(/^https?:\/\/doi\.org\//, '') : '');
  const link = location && /^https?:\/\//i.test(location)
    ? ' <a class="reference-link" href="' + escapeHtml(location) + '">source</a>'
    : '';
  let publication = '';
  if (type === 'article') {
    publication = journal ? ' <em>' + journal + '</em>' + (volume ? ', <em>' + volume + '</em>' : '')
      + (number ? '(' + number + ')' : '') + (pages ? ', ' + pages : '') + '.' : '';
  } else if (type === 'inproceedings' || type === 'conference') {
    publication = booktitle ? ' In <em>' + booktitle + '</em>' + (pages ? ' (pp. ' + pages + ')' : '') + '.' : '';
  } else {
    publication = publisher ? ' ' + publisher + '.' : '';
  }
  const editionText = edition ? ' (' + edition + ' ed.).' : '.';
  return '<li id="' + referenceId(key) + '"><span class="reference-title">' + title + '</span>' + link
    + '<br><span class="reference-authors">' + authors + '</span> (' + year + ').'
    + (type === 'book' && edition ? editionText : '') + publication + '</li>';
}

function referencesMarkup(cited, bibliography) {
  if (!cited.size) return '';
  const entries = [...cited].map((key) => ({ key, entry: bibliography.get(key) }));
  return '<section class="backmatter-section references" aria-labelledby="references"><h3 id="references">References</h3><ol>'
    + entries.map(({ entry, key }) => apaReference(entry, key)).join('')
    + '</ol></section>';
}

function footnotesMarkup(footnotes = []) {
  if (!footnotes.length) return '';
  return '<section class="backmatter-section footnotes" aria-labelledby="footnotes"><h3 id="footnotes">Footnotes</h3><ol>'
    + footnotes.map((footnote) => {
      const id = footnote.key.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
      return '<li id="fn-' + id + '">' + footnote.html
        + '<a class="footnote-backlink" href="#fnref-' + id + '" aria-label="Back to footnote marker">[↩]</a></li>';
    }).join('') + '</ol></section>';
}

function markdownSourceFromConfig(value) {
  const values = Array.isArray(value) ? value : [value];
  return values.filter(Boolean).map((item) => {
    if (typeof item === 'string') return item;
    if (item.url && (item.title || item.name)) return '[' + (item.title || item.name) + '](' + item.url + ')';
    return item.text || item.title || item.name || '';
  }).filter(Boolean).join('\n\n');
}

function backmatterDataValue(data, keys) {
  for (const key of keys) {
    if (data[key]) return data[key];
  }
  return '';
}

function backmatterSectionMarkup(id, title, value, bibliography, cited, baseUrl = '') {
  const source = markdownSourceFromConfig(value);
  if (!source) return '';
  const citedContent = citationSource(source, bibliography);
  for (const key of citedContent.cited) cited.add(key);
  return '<section class="backmatter-section" aria-labelledby="' + id + '"><h3 id="' + id + '">'
    + escapeHtml(title) + '</h3><div class="backmatter-content">'
    + renderMarkdown(citedContent.source, baseUrl).trim() + '</div></section>';
}

function backmatterMarkup(post, baseUrl = '') {
  const data = post.data;
  const sections = [
    backmatterSectionMarkup(
      'acknowledgments',
      'Acknowledgments',
      backmatterDataValue(data, ['acknowledgments', 'acknowledgements']),
      post.bibliography,
      post.cited,
      baseUrl
    ),
    backmatterSectionMarkup(
      'author-contributions',
      'Author Contributions',
      backmatterDataValue(data, ['author_contributions', 'author-contributions']),
      post.bibliography,
      post.cited,
      baseUrl
    ),
    backmatterSectionMarkup(
      'discussion-and-review',
      'Discussion and Review',
      backmatterDataValue(data, ['discussion_and_review', 'discussion-and-review']),
      post.bibliography,
      post.cited,
      baseUrl
    ),
    footnotesMarkup(post.footnotes)
  ].filter(Boolean);
  const references = referencesMarkup(post.cited, post.bibliography);
  if (!sections.length && !references) return '';
  return '<section class="backmatter" aria-label="Article back matter">'
    + sections.join('') + references + '</section>';
}

function textFromHtml(html) {
  return html.replace(/<[^>]*>/g, '').replaceAll('&amp;', '&').replaceAll('&quot;', '"').trim();
}

function outlineFromHtml(html) {
  return [...html.matchAll(/<h([2-3]) id="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/g)]
    .map((match) => ({ level: Number(match[1]), id: match[2], title: textFromHtml(match[3]) }))
    .filter((heading) => heading.id !== 'references');
}

function navigationMarkup(outline) {
  if (!outline.length) return '';
  return '<nav class="toc" aria-label="On this page"><ol>'
    + outline.map((heading) => '<li class="toc-level-' + heading.level + '"><a href="#' + escapeHtml(heading.id)
      + '" data-toc-link>' + escapeHtml(heading.title) + '</a></li>').join('')
    + '</ol></nav>';
}

async function readBibliography(pageFile, data) {
  const configured = data.bibliography;
  if (!configured) return new Map();
  if (data.citation_style && String(data.citation_style).toLowerCase() !== 'apa') {
    throw new Error('Only APA citations are currently supported.');
  }
  const bibliographyFiles = Array.isArray(configured) ? configured : [configured];
  const entries = new Map();
  for (const bibliography of bibliographyFiles) {
    const file = path.resolve(path.dirname(pageFile), String(bibliography));
    if (!await exists(file)) throw new Error('Bibliography file not found: ' + bibliography);
    const parsedEntries = parseBibtex(await readFile(file, 'utf8'));
    for (const parsedEntry of parsedEntries) {
      entries.set(parsedEntry.citationKey, parsedEntry);
    }
  }
  return entries;
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
  }).format(date);
}

function humanise(value = '') {
  return String(value).replace(/[-_]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function configInlineMarkup(value = '') {
  const source = String(value);
  const superscriptPattern = /\$\^(?:\{([^}]*)\}|([^$]+))\$/g;
  let cursor = 0;
  let html = '';
  for (const match of source.matchAll(superscriptPattern)) {
    html += escapeHtml(source.slice(cursor, match.index));
    html += '<sup>' + escapeHtml(match[1] ?? match[2]) + '</sup>';
    cursor = (match.index || 0) + match[0].length;
  }
  return html + escapeHtml(source.slice(cursor));
}

function authorMarkup(authors) {
  const values = Array.isArray(authors) ? authors : [authors];
  return values.map((author) => {
    const item = typeof author === 'string' ? { name: author } : author;
    const name = configInlineMarkup(item.name || 'Anonymous');
    return item.url
      ? '<a href="' + escapeHtml(item.url) + '" rel="author">' + name + '</a>'
      : name;
  }).join(', ');
}

function affiliationMarkup(affiliations) {
  const values = Array.isArray(affiliations) ? affiliations : [affiliations];
  return values.filter(Boolean).map((item) => {
    return '<span>' + configInlineMarkup(typeof item === 'string' ? item : item.name) + '</span>';
  }).join(' · ');
}

function footerMarkup(config) {
  if (config.copyright) {
    return '<span class="copyright">&copy; ' + escapeHtml(config.copyright) + '</span>';
  }
  const footer = config.footer || (config.site_name || 'NLCo') + ' · Built with the NLCo blog template';
  return escapeHtml(footer).replace(/&amp;copy;/gi, '&copy;');
}

function shell(options) {
  const config = options.config;
  const siteName = escapeHtml(config.site_name || 'NLCo');
  const title = options.title ? escapeHtml(options.title) + ' · ' + siteName : siteName;
  const description = escapeHtml(options.description || config.site_description || '');
  const assetUrl = urlFor(options.baseUrl, '/assets/site.css');
  const tocScriptUrl = urlFor(options.baseUrl, '/assets/toc.js');
  const chartScriptUrl = urlFor(options.baseUrl, '/assets/charts.js');
  const copyCodeScriptUrl = urlFor(options.baseUrl, '/assets/copy-code.js');
  const homeUrl = urlFor(options.baseUrl);
  const footer = footerMarkup(config);
  const headerConfig = config.header && typeof config.header === 'object' ? config.header : null;
  const logoUrl = headerConfig?.site_logo ? configuredUrlFor(options.baseUrl, headerConfig.site_logo) : '';
  const logoLinkUrl = headerConfig?.site_logo_url || homeUrl;
  const headerBrand = logoUrl
    ? '<img src="' + escapeHtml(logoUrl) + '" alt="' + siteName + '" class="site-logo">'
    : '<span class="wordmark">' + siteName + '</span>';
  const header = headerConfig
    ? '<header class="site-header"><a href="' + escapeHtml(logoLinkUrl) + '" class="header-brand">'
      + headerBrand + '</a></header>\n'
    : '';
  return '<!doctype html>\n'
    + '<html lang="' + escapeHtml(config.language || 'en') + '">\n'
    + '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">\n'
    + '<meta name="description" content="' + description + '"><title>' + title + '</title>\n'
    + '<link rel="stylesheet" href="' + assetUrl + '">\n'
    + '<script>window.MathJax = { tex: { inlineMath: [["$", "$"], ["\\\\(", "\\\\)"]], displayMath: [["$$", "$$"], ["\\\\[", "\\\\]"]], processEscapes: true }, options: { skipHtmlTags: ["script", "noscript", "style", "textarea", "pre", "code"] }, startup: { pageReady: () => { return MathJax.startup.defaultPageReady().then(() => { console.log("MathJax typesetting complete"); }); } } };</script>\n'
    + '<script id="MathJax-script" async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js"></script>\n'
    + '<script defer src="https://cdn.jsdelivr.net/npm/chart.js"></script>\n'
    + '<script defer src="' + tocScriptUrl + '"></script>\n'
    + '<script defer src="' + chartScriptUrl + '"></script>\n'
    + '<script defer src="' + copyCodeScriptUrl + '"></script></head>\n'
    + '<body' + (options.article ? ' class="article-page"' : '') + '>\n'
    + header
    + options.body + '\n<footer class="site-footer">' + footer + '</footer>\n</body></html>';
}

function articlePage(post, config, baseUrl) {
  const data = post.data;
  const title = data.title || humanise(post.slug);
  const tags = (Array.isArray(data.tags) ? data.tags : [data.tags]).filter(Boolean);
  const tagMarkup = tags.length
    ? '<p class="tags">' + tags.map((tag) => '<span>' + escapeHtml(tag) + '</span>').join('') + '</p>'
    : '';
  const articleContent = post.html + backmatterMarkup(post, baseUrl);
  const outline = outlineFromHtml(post.html);
  const body = '<article><header class="article-header">'
    + '<p class="eyebrow">' + formatDate(data.date) + '</p>'
    + '<h1>' + escapeHtml(title) + '</h1>'
    + (data.description ? '<p class="dek">' + escapeHtml(data.description) + '</p>' : '')
    + (data.authors ? '<p class="authors">' + authorMarkup(data.authors) + '</p>' : '')
    + (data.affiliations ? '<p class="affiliations">' + affiliationMarkup(data.affiliations) + '</p>' : '')
    + tagMarkup + '</header><div class="article-layout">' + navigationMarkup(outline)
    + '<div class="article-body">' + articleContent + '</div></div></article>';
  return shell({ config, baseUrl, title, description: data.description, body, article: true });
}

async function main() {
  const config = await readConfig();
  const baseUrl = normaliseBaseUrl(config.base_url);
  const files = await markdownFiles(contentDirectory);
  const posts = await Promise.all(files.map(async (file) => {
    const parsed = matter(await readFile(file, 'utf8'));
    const bibliography = await readBibliography(file, parsed.data);
    const extracted = extractFootnotes(parsed.content);
    const citedContent = citationSource(extracted.source, bibliography);
    const footnotes = extracted.footnotes.map((footnote) => {
      const citedFootnote = citationSource(footnote.source, bibliography);
      for (const key of citedFootnote.cited) citedContent.cited.add(key);
      return { ...footnote, html: renderMarkdown(citedFootnote.source, baseUrl).trim() };
    });
    const relative = path.relative(contentDirectory, file).replace(/\.md$/i, '');
    const segments = relative.split(path.sep).map((part) => {
      return part.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    });
    const slug = segments.at(-1) === 'index'
      ? (segments.slice(0, -1).join('/') || 'index')
      : segments.join('/');
    return {
      data: parsed.data,
      bibliography,
      cited: citedContent.cited,
      footnotes,
      html: renderMarkdown(citedContent.source, baseUrl),
      slug
    };
  }));
  if (!posts.some((post) => post.slug === 'index')) {
    throw new Error('Missing content/index.md. This file is the site homepage.');
  }

  await rm(outputDirectory, { force: true, recursive: true });
  await mkdir(outputDirectory, { recursive: true });
  if (await exists(publicDirectory)) await cp(publicDirectory, outputDirectory, { recursive: true });
  await Promise.all(posts.map(async (post) => {
    const directory = post.slug === 'index'
      ? outputDirectory
      : path.join(outputDirectory, post.slug);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'index.html'), articlePage(post, config, baseUrl));
  }));
  console.log('Built ' + posts.length + ' page' + (posts.length === 1 ? '' : 's') + ' in dist/');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
