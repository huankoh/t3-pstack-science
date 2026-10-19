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

  test("matches whole terms across lines and reports their first line", async () => {
    const { findTerms } = await checker();
    expect(findTerms("Handle cancellation and excellent cases.\nsingle\ncell", ["cell", "single cell"])).toEqual([
      { line: 2, term: "single cell", found: "single\ncell" },
    ]);
    expect(findTerms("Cell cancellation", ["cell"])).toEqual([{ line: 1, term: "cell", found: "Cell" }]);
  });

  test.each([["proteomic", "proteomics"], ["proteomics", "proteomic"]])("reports the longer term once for the same span with %j first", async (first, second) => {
    const { findTerms } = await checker();
    expect(findTerms("proteomics readProteomicsCount", [first, second])).toEqual([
      { line: 1, term: "proteomics", found: "proteomics" },
      { line: 1, term: "proteomics", found: "Proteomics" },
    ]);
  });

  test.each([["rna", "rna seq"], ["rna seq", "rna"]])("drops contained spans across passes with %j first", async (first, second) => {
    const { findTerms } = await checker();
    expect(findTerms("RNA-seq data; rnaSeqData; rna", [first, second])).toEqual([
      { line: 1, term: "rna seq", found: "RNA-seq" },
      { line: 1, term: "rna seq", found: "rnaSeq" },
      { line: 1, term: "rna", found: "rna" },
    ]);
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
      "amino acid", "antibody", "antigen", "assay", "bioassay", "binding affinity", "binding site", "biological", "biologically", "biology",
      "biomarker", "chromosome", "codon", "cytokine", "dna", "enzymatic", "epitope", "gene", "genome",
      "genomic", "genomics", "glycan", "glycoprotein", "glycosylation", "inhibitor", "kinase", "ligand", "metabolite",
      "microbiome", "mrna", "nucleotide", "oligosaccharide", "pathogen", "peptide", "phenotype",
      "protein", "proteome", "proteomic", "proteomics", "receptor", "rna", "rna seq", "small molecule", "tissue", "transcriptome",
    ]);
  });
});

describe("term-free.mjs CLI", () => {
  test.each([
    ["binding\naffinity", "binding affinity", "binding\naffinity"],
    ["amino\nacid", "amino acid", "amino\nacid"],
    ["small\nmolecules", "small molecule", "small\nmolecules"],
    ["binding\r\n\t affinities", "binding affinity", "binding\r\n\t affinities"],
    ["antibodies", "antibody", "antibodies"],
    ["binding affinities", "binding affinity", "binding affinities"],
    ["biologies", "biology", "biologies"],
    ["countRNAs", "rna", "RNAs"],
    ["readDNAsCount", "dna", "DNAs"],
    ["RNAs", "rna", "RNAs"],
    ["mRNA", "mrna", "mRNA"],
    ["gene1", "gene", "gene"],
    ["dna2vec", "dna", "dna"],
    ["protein2vec", "protein", "protein"],
    ["Protein3D", "protein", "Protein"],
    ["bindingaffinity", "binding affinity", "bindingaffinity"],
    ["aminoacid", "amino acid", "aminoacid"],
    ["smallmolecule", "small molecule", "smallmolecule"],
    ["rnaseq", "rna seq", "rnaseq"],
    ["RNAseq", "rna seq", "RNAseq"],
    ["scRNAseq", "rna seq", "RNAseq"],
    ["RNA-seq data", "rna seq", "RNA-seq"],
    ["biological", "biological", "biological"],
    ["biologically", "biologically", "biologically"],
    ["proteomics", "proteomics", "proteomics"],
    ["proteomic", "proteomic", "proteomic"],
    ["genomics", "genomics", "genomics"],
    ["enzymatic", "enzymatic", "enzymatic"],
  ])("exits 1 with the term and original spelling for %j", (input, term, found) => {
    expect(run(brief(`Sort rows.\n${input}\n`))).toEqual({
      status: 1, stdout: [term].flat().map((word) => `line 2: ${word} (${JSON.stringify(found)})\n`).join(""), stderr: "",
    });
  });

  test.each([
    "general", "generator", "generic", "cancellation", "excellent", "eigenvalue matrix vector",
    "genetic algorithm", "import { mount } from 'enzyme'; enzyme.mount(<App/>)",
    "useMutation(Q)", "new MutationObserver(cb)", "mutation testing", "import pdb; pdb.set_trace()", "docking layout", "he smiles",
  ])("exits 0 for ordinary code and prose %j", (input) => {
    const file = brief(input);
    expect(run(file)).toEqual({ status: 0, stdout: `ok: no listed term in ${file}\n`, stderr: "" });
  });

  test.each([
    ["category", "categories", "category"],
    ["CATEGORY", "categories", "category"],
    ["activity", "activities", "activity"],
    ["IL-6", "IL-6", "il 6"],
    ["CRISPR-Cas9", "CRISPR-Cas9", "crispr cas9"],
    ["α helix", "α_helix", "α helix"],
    ["α_helix", "α-helix", "α helix"],
    ["mutation", "mutation", "mutation"],
    ["pdb", "pdb", "pdb"],
    ["docking", "docking", "docking"],
    ["smiles", "smiles", "smiles"],
  ])("--term %j detects normalized task terms and plurals", (extra, input, term) => {
    expect(run(brief(input), "--term", extra)).toEqual({
      status: 1, stdout: `line 1: ${term} (${JSON.stringify(input)})\n`, stderr: "",
    });
  });

  test.each([
    ["BRCA1", "readBRCA1Count", "brca1", "BRCA1"],
    ["BRCA1", "brca1Status", "brca1", "brca1"],
    ["BRCA1", "loadBRCA1", "brca1", "BRCA1"],
    ["FOXP3", "getFOXP3", "foxp3", "FOXP3"],
    ["CD4", "cd4Count", "cd4", "cd4"],
    ["IL6", "il6Level", "il6", "il6"],
    ["IL6", "loadIL6Count", "il6", "IL6"],
    ["IL6", "IL-6", "il6", "IL-6"],
    ["Cas9", "dCas9", "cas9", "Cas9"],
    ["Cas9", "spCas9", "cas9", "Cas9"],
    ["Cas9", "readCas9", "cas9", "Cas9"],
    ["CRISPR-Cas9", "readCRISPRCas9Count", "crispr cas9", "CRISPRCas9"],
  ])("--term %j detects numbered terms in %j", (extra, input, term, found) => {
    expect(run(brief(input), "--term", extra)).toEqual({
      status: 1, stdout: `line 1: ${term} (${JSON.stringify(found)})\n`, stderr: "",
    });
  });

  test("--term preserves case humps in task terms before matching numbered identifiers", () => {
    expect(run(brief("readRowGroup2Count"), "--term", "RowGroup2")).toEqual({
      status: 1, stdout: 'line 1: rowgroup2 ("RowGroup2")\n', stderr: "",
    });
  });

  test.each([
    ["mAb", "x = m - abs(y)"],
    ["pKa", "p - ka"],
  ])("--term %j does not join separate code tokens in %j", (extra, input) => {
    const file = brief(input);
    expect(run(file, "--term", extra)).toEqual({ status: 0, stdout: `ok: no listed term in ${file}\n`, stderr: "" });
  });

  test.each([
    ["mAb", "mAbTiter", "mab", "mAb"],
    ["mAb", "mAb_titer", "mab", "mAb"],
    ["mAb", "m_AbTiter", "mab", "m_Ab"],
    ["mAb", "m-AbTiter", "mab", "m-Ab"],
    ["pKa", "pKaValue", "pka", "pKa"],
    ["pKa", "pKa_value", "pka", "pKa"],
    ["mAb titer", "mAb\n titer", "mab titer", "mAb\n titer"],
  ])("--term %j keeps case humps inside tokens in %j", (extra, input, term, found) => {
    expect(run(brief(input), "--term", extra)).toEqual({
      status: 1, stdout: `line 1: ${term} (${JSON.stringify(found)})\n`, stderr: "",
    });
  });

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
