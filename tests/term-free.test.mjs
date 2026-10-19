import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../plugins/pstack/skills/setup-pstack/scripts/term-free.mjs", import.meta.url));
const checker = () => import(script);
const made = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const brief = (text) => {
  const dir = mkdtempSync(join(tmpdir(), "term-free-"));
  made.push(dir);
  const file = join(dir, "brief.md");
  writeFileSync(file, text);
  return file;
};
const run = (...args) => {
  const { status, stdout, stderr } = spawnSync("node", [script, ...args], { encoding: "utf8" });
  return { status, stdout, stderr };
};

describe("findTerms", () => {
  test("reports case, plurals, and separators in reading order", async () => {
    const { findTerms } = await checker();
    expect(findTerms("Count Genes per row.\nGroup single-cell records.\nfold the PROTEIN chain", ["protein", "single cell", "gene"])).toEqual([
      { line: 1, term: "gene", found: "Genes" },
      { line: 2, term: "single cell", found: "single-cell" },
      { line: 3, term: "protein", found: "PROTEIN" },
    ]);
    expect(findTerms("assays and assayes; binding_affinities; binding_sites", ["assay", "binding site"])).toEqual([
      { line: 1, term: "assay", found: "assays" },
      { line: 1, term: "assay", found: "assayes" },
      { line: 1, term: "binding site", found: "binding_sites" },
    ]);
  });

  test("splits underscores, camel case, and acronym humps", async () => {
    const { findTerms } = await checker();
    expect(findTerms("Rename `gene_id`, `readGeneMatrix`, `DNAParser`, and `ligandCount`.", ["gene", "dna", "ligand"])).toEqual([
      { line: 1, term: "gene", found: "gene" },
      { line: 1, term: "gene", found: "Gene" },
      { line: 1, term: "dna", found: "DNA" },
      { line: 1, term: "ligand", found: "ligand" },
    ]);
  });

  test("preserves original spelling across split humps and underscores", async () => {
    const { findTerms } = await checker();
    expect(findTerms("bindingAffinity and binding_site and BINDING-SITES", ["binding affinity", "binding site"])).toEqual([
      { line: 1, term: "binding affinity", found: "bindingAffinity" },
      { line: 1, term: "binding site", found: "binding_site" },
      { line: 1, term: "binding site", found: "BINDING-SITES" },
    ]);
  });

  test("retains mixed-case words and acronym plurals that case splitting would divide", async () => {
    const { findTerms } = await checker();
    expect(findTerms("mRNA, RNAs, DNAs, mRNA_count", ["mrna", "rna", "dna"])).toEqual([
      { line: 1, term: "mrna", found: "mRNA" },
      { line: 1, term: "rna", found: "RNAs" },
      { line: 1, term: "dna", found: "DNAs" },
      { line: 1, term: "mrna", found: "mRNA" },
    ]);
  });

  test("matches whole words without joining terms across lines", async () => {
    const { findTerms } = await checker();
    expect(findTerms("Handle cancellation and excellent cases.\nsingle\ncell", ["cell", "single cell"])).toEqual([
      { line: 3, term: "cell", found: "cell" },
    ]);
    expect(findTerms("Cell cancellation", ["cell"])).toEqual([{ line: 1, term: "cell", found: "Cell" }]);
  });

  test("reports each occurrence, including repeated terms on one line and CRLF lines", async () => {
    const { findTerms } = await checker();
    expect(findTerms("protein gene protein\r\nGENES", ["gene", "protein"])).toEqual([
      { line: 1, term: "protein", found: "protein" },
      { line: 1, term: "gene", found: "gene" },
      { line: 1, term: "protein", found: "protein" },
      { line: 2, term: "gene", found: "GENES" },
    ]);
  });
});

describe("parseGlossary", () => {
  test("skips comments and blank lines", async () => {
    const { parseGlossary } = await checker();
    expect(parseGlossary("# terms\r\n\r\ngene\r\nsingle cell\r\n")).toEqual(["gene", "single cell"]);
  });

  test.each(["- protein", "Protein", "binding  site", "binding_site", "rna.*"])("rejects malformed term %s", async (line) => {
    const { parseGlossary } = await checker();
    expect(() => parseGlossary(`gene\n${line}`)).toThrow(`glossary line 2: "${line}" is not a lowercase term`);
  });

  test("names both lines for a duplicate term", async () => {
    const { parseGlossary } = await checker();
    expect(() => parseGlossary("gene\n# comment\ngene")).toThrow('glossary line 3: "gene" repeats line 1');
  });

  test("the shipped glossary promises the specified seed and omits ambiguous code words", async () => {
    const { GLOSSARY, parseGlossary } = await checker();
    expect(parseGlossary(readFileSync(GLOSSARY, "utf8"))).toEqual([
      "amino acid", "antibody", "antigen", "assay", "bioassay", "binding affinity", "binding site", "biology",
      "biomarker", "chromosome", "codon", "cytokine", "dna", "docking", "enzyme", "epitope", "gene", "genome",
      "genomic", "glycan", "glycoprotein", "glycosylation", "inhibitor", "kinase", "ligand", "metabolite",
      "microbiome", "mrna", "mutation", "nucleotide", "oligosaccharide", "pathogen", "pdb", "peptide", "phenotype",
      "protein", "proteome", "receptor", "rna", "small molecule", "smiles", "tissue", "transcriptome",
    ]);
  });
});

describe("term-free.mjs CLI", () => {
  test("exits 0 on a clean brief", () => {
    const file = brief("Sort rows by the third column, then merge runs within 5 of the previous end.\n");
    expect(run(file)).toEqual({ status: 0, stdout: `ok: no listed term in ${file}\n`, stderr: "" });
  });

  test("exits 1 for terms in prose and identifiers", () => {
    expect(run(brief("Check binding affinity.\nRename ligandCount.\n"))).toEqual({
      status: 1, stdout: 'line 1: binding affinity ("binding affinity")\nline 2: ligand ("ligand")\n', stderr: "",
    });
  });

  test("--term adds task words for one run and does not duplicate glossary hits", () => {
    const file = brief("Load BRCA1 rows and Genes\n");
    expect(run(file, "--term", "BRCA1", "--term", "gene", "--term", "BRCA1")).toEqual({
      status: 1, stdout: 'line 1: brca1 ("BRCA1")\nline 1: gene ("Genes")\n', stderr: "",
    });
    expect(run(brief("Load BRCA1 rows\n"))).toMatchObject({ status: 0, stderr: "" });
  });

  test.each([[], ["--term", "BRCA1"], ["file", "--term"], ["file", "--other", "word"], ["file", "extra"], ["file", "--term", ""], ["file", "--term", "rna.*"]].map((args) => [args]))("exits 2 with usage for invalid arguments %j", (args) => {
    expect(run(...args)).toEqual({ status: 2, stdout: "", stderr: "usage: term-free.mjs <brief-file> [--term <word>]...\n" });
  });

  test("exits 2 with a read error for a missing brief", () => {
    const file = brief("") + ".missing";
    const result = run(file);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toStartWith(`${file}: ENOENT`);
  });
});
