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

function tokenize(source) {
  const tokens = [];
  let line = 1;
  let previousEnd = 0;
  for (const word of source.matchAll(/[\p{L}\p{N}]+/gu)) {
    line += (source.slice(previousEnd, word.index).match(/\n/g) ?? []).length;
    let index = word.index;
    const parts = word[0].split(/(?<=\p{Ll})(?=\p{Lu})|(?<=\p{Lu})(?=\p{Lu}\p{Ll})|(?<=\p{L})(?=\p{N})|(?<=\p{N})(?=\p{L})/u);
    for (const part of parts) {
      const separator = source.slice(tokens.at(-1)?.end ?? 0, index);
      tokens.push({ value: part.toLowerCase(), index, end: index + part.length, line, separator });
      index += part.length;
    }
    previousEnd = index;
  }
  return tokens;
}

export function findTerms(brief, terms) {
  const text = tokenize(brief);
  const hits = [];
  for (const term of new Set(terms)) {
    const tokens = tokenize(term);
    const gaps = new Set();
    let spelling = "";
    for (const [i, token] of tokens.entries()) {
      const previous = tokens[i - 1];
      const digitBreak = previous && /^\p{N}/u.test(token.value) !== /^\p{N}/u.test(previous.value);
      if (!previous || token.separator || digitBreak) gaps.add(spelling.length);
      spelling += token.value;
    }
    const variants = [spelling];
    const last = tokens.at(-1).value;
    if (/^\p{L}{3,}$/u.test(last)) {
      variants.push(spelling + "s", spelling + "es");
      if (last.endsWith("y")) variants.push(spelling.slice(0, -1) + "ies");
    }
    for (let start = 0; start < text.length; start++) {
      for (const variant of variants) {
        let candidate = "";
        for (let end = start; end < text.length; end++) {
          const token = text[end];
          if (end > start && token.separator && (!gaps.has(candidate.length) || !/^[\s_-]+$/u.test(token.separator))) break;
          candidate += token.value;
          if (!variant.startsWith(candidate)) break;
          if (candidate === variant) {
            hits.push({ term: term.toLowerCase(), index: text[start].index, end: token.end, line: text[start].line });
            break;
          }
        }
      }
    }
  }
  let previousEnd = -1;
  return hits.sort((a, b) => a.index - b.index || b.end - a.end || b.term.length - a.term.length)
    .filter(({ end }) => {
      if (end <= previousEnd) return false;
      previousEnd = end;
      return true;
    }).map(({ index, end, line, term }) => ({ line, term, found: brief.slice(index, end) }));
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
