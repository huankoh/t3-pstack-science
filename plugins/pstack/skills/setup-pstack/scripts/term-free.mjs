#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const GLOSSARY = new URL("./science-terms.txt", import.meta.url);
const TERM = /^[\p{L}\p{N}]+(?: [\p{L}\p{N}]+)*$/u;
const USAGE = "usage: term-free.mjs <brief-file> [--term <word>]...";

export function parseGlossary(text) {
  const firstLine = new Map();
  for (const [i, raw] of text.split(/\r?\n/).entries()) {
    const term = raw.trim();
    if (!term || term.startsWith("#")) continue;
    if (!TERM.test(term) || term !== term.toLowerCase()) throw new Error(`glossary line ${i + 1}: "${raw}" is not a lowercase term`);
    if (firstLine.has(term)) throw new Error(`glossary line ${i + 1}: "${term}" repeats line ${firstLine.get(term)}`);
    firstLine.set(term, i + 1);
  }
  return [...firstLine.keys()];
}

// Keep source offsets so a hit across a case hump retains its original spelling.
function splitIdentifier(source, acronyms, digits) {
  let text = "";
  const offsets = [];
  for (let i = 0; i < source.length; i++) {
    const current = source[i];
    const previous = source[i - 1] ?? "";
    const next = source[i + 1] ?? "";
    const plural = next === "s" && !/\p{Ll}/u.test(source[i + 2] ?? "");
    const hump = /\p{Lu}/u.test(current) && (/\p{Ll}/u.test(previous) ||
      (acronyms && /\p{Lu}/u.test(previous) && /\p{Ll}/u.test(next) && !plural));
    const digit = /\p{L}/u.test(previous) && /\p{N}/u.test(current) || /\p{N}/u.test(previous) && /\p{L}/u.test(current);
    if (i && (hump || digits && digit)) {
      text += " ";
      offsets.push(i);
    }
    text += current === "_" ? " " : current;
    offsets.push(i);
  }
  return { text, offsets };
}

export function findTerms(brief, terms) {
  const uniqueTerms = [...new Set(terms)];
  const collect = (source, offset, normalize = (term) => term) => uniqueTerms.flatMap((term) => {
    const words = normalize(term).toLowerCase().split(/\s+/);
    const last = words.pop();
    const ending = /[^aeiou]y$/.test(last) ? `(?:${last}(?:e?s)?|${last.slice(0, -1)}ies)` : `${last}(?:e?s)?`;
    const pattern = [...words, ending].join("[\\s_-]*");
    const regex = new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, "giu");
    return [...source.matchAll(regex)].map((match) => {
      const index = offset(match.index);
      const end = offset(match.index + match[0].length - 1) + 1;
      return { term: term.toLowerCase(), found: brief.slice(index, end), index, end };
    });
  });
  const hits = collect(brief, (index) => index);
  // Preserve whole spellings such as mRNA and RNAseq before splitting acronym humps.
  for (const digits of [false, true]) {
    for (const acronyms of [false, true]) {
      const { text, offsets } = splitIdentifier(brief, acronyms, digits);
      const split = collect(text, (index) => offsets[index], (term) => splitIdentifier(term, acronyms, digits).text).filter((hit) =>
        !hits.some((word) => word.index <= hit.index && word.end >= hit.end),
      );
      hits.push(...split);
    }
  }
  const spans = new Set();
  return hits.sort((a, b) => a.index - b.index || b.end - a.end || b.term.length - a.term.length)
    .filter(({ index, end }) => {
      const span = `${index}:${end}`;
      if (spans.has(span)) return false;
      spans.add(span);
      return true;
    }).map(({ index, end, ...hit }) => ({
      line: brief.slice(0, index).split("\n").length, ...hit,
    }));
}

function main(args) {
  const [file, ...flags] = args;
  const extra = flags.filter((_, i) => i % 2 === 1).map((term) => term.replace(/[-_]/g, " ").trim().replace(/\s+/g, " "));
  if (!file || file.startsWith("--") || flags.length % 2 || flags.some((value, i) => i % 2 === 0 && value !== "--term") || extra.some((term) => !TERM.test(term))) {
    console.error(USAGE);
    return 2;
  }
  let terms;
  let brief;
  try {
    terms = parseGlossary(readFileSync(GLOSSARY, "utf8"));
  } catch (error) {
    console.error(`${fileURLToPath(GLOSSARY)}: ${error.message}`);
    return 2;
  }
  try {
    brief = readFileSync(file, "utf8");
  } catch (error) {
    console.error(`${file}: ${error.message}`);
    return 2;
  }
  terms.push(...extra);
  const hits = findTerms(brief, terms);
  for (const hit of hits) console.log(`line ${hit.line}: ${hit.term} (${JSON.stringify(hit.found)})`);
  if (hits.length) return 1;
  console.log(`ok: no listed term in ${file}`);
  return 0;
}

const invoked = process.argv[1] && existsSync(process.argv[1]) ? realpathSync(process.argv[1]) : null;
if (invoked === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
