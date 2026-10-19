#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const GLOSSARY = new URL("./science-terms.txt", import.meta.url);
const TERM = /^[a-z0-9]+(?: [a-z0-9]+)*$/;
const USAGE = "usage: term-free.mjs <brief-file> [--term <word>]...";

export function parseGlossary(text) {
  const firstLine = new Map();
  for (const [i, raw] of text.split(/\r?\n/).entries()) {
    const term = raw.trim();
    if (!term || term.startsWith("#")) continue;
    if (!TERM.test(term)) throw new Error(`glossary line ${i + 1}: "${raw}" is not a lowercase term`);
    if (firstLine.has(term)) throw new Error(`glossary line ${i + 1}: "${term}" repeats line ${firstLine.get(term)}`);
    firstLine.set(term, i + 1);
  }
  return [...firstLine.keys()];
}

// Keep source offsets so a hit across a case hump retains its original spelling.
function splitIdentifier(line) {
  let text = "";
  const offsets = [];
  for (let i = 0; i < line.length; i++) {
    if (i && /[A-Z]/.test(line[i]) && (/[a-z0-9]/.test(line[i - 1]) || (/[A-Z]/.test(line[i - 1]) && /[a-z]/.test(line[i + 1] ?? "")))) {
      text += " ";
      offsets.push(i);
    }
    text += line[i] === "_" ? " " : line[i];
    offsets.push(i);
  }
  return { text, offsets };
}

export function findTerms(brief, terms) {
  const patterns = [...new Set(terms)].map((term) => ({
    term,
    regex: new RegExp(`(?<![A-Za-z0-9])${term.split(" ").join("[\\s_-]+")}(?:e?s)?(?![A-Za-z0-9])`, "gi"),
  }));
  return brief.split(/\r?\n/).flatMap((line, i) => {
    const { text, offsets } = splitIdentifier(line);
    const collect = (source, offset) => patterns.flatMap(({ term, regex }) => [...source.matchAll(regex)].map((match) => {
      const index = offset(match.index);
      const end = offset(match.index + match[0].length - 1) + 1;
      return { line: i + 1, term, found: line.slice(index, end), index, end };
    }));
    const original = collect(line, (index) => index);
    // A complete word such as mRNA takes precedence over fragments from case splitting.
    const split = collect(text, (index) => offsets[index]).filter((hit) =>
      !original.some((word) => word.index <= hit.index && word.end >= hit.end),
    );
    return [...original, ...split].sort((a, b) => a.index - b.index).map(({ index, end, ...hit }) => hit);
  });
}

function main(args) {
  const [file, ...flags] = args;
  if (!file || file.startsWith("--") || flags.length % 2 || flags.some((value, i) => i % 2 === 0 ? value !== "--term" : !TERM.test(value.toLowerCase()))) {
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
  terms.push(...flags.filter((_, i) => i % 2 === 1).map((term) => term.toLowerCase()));
  const hits = findTerms(brief, terms);
  for (const hit of hits) console.log(`line ${hit.line}: ${hit.term} (${JSON.stringify(hit.found)})`);
  if (hits.length) return 1;
  console.log(`ok: no listed term in ${file}`);
  return 0;
}

const invoked = process.argv[1] && existsSync(process.argv[1]) ? realpathSync(process.argv[1]) : null;
if (invoked === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
