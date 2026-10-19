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

const regressionCases = [
  ["catch", "binding affinity", "binding affinity", "binding affinity"],
  ["catch", "binding\naffinity", "binding affinity", "binding\naffinity"],
  ["catch", "amino\nacid", "amino acid", "amino\nacid"],
  ["catch", "small\nmolecules", "small molecule", "small\nmolecules"],
  ["catch", "binding\r\n\t affinities", "binding affinity", "binding\r\n\t affinities"],
  ["catch", "bindingaffinity", "binding affinity", "bindingaffinity"],
  ["catch", "aminoacid", "amino acid", "aminoacid"],
  ["catch", "smallmolecule", "small molecule", "smallmolecule"],
  ["catch", "rnaseq", "rna seq", "rnaseq"],
  ["catch", "RNAseq", "rna seq", "RNAseq"],
  ["catch", "scRNAseq", "rna seq", "RNAseq"],
  ["catch", "RNA-seq", "rna seq", "RNA-seq"],
  ["catch", "RNA-seq data", "rna seq", "RNA-seq"],
  ["catch", "antibodies", "antibody", "antibodies"],
  ["catch", "binding affinities", "binding affinity", "binding affinities"],
  ["catch", "biologies", "biology", "biologies"],
  ["catch", "countRNAs", "rna", "RNAs"],
  ["catch", "readDNAsCount", "dna", "DNAs"],
  ["catch", "RNAs", "rna", "RNAs"],
  ["catch", "mRNA", "mrna", "mRNA"],
  ["catch", "mRNA_count", "mrna", "mRNA"],
  ["catch", "gene1", "gene", "gene"],
  ["catch", "dna2vec", "dna", "dna"],
  ["catch", "protein2vec", "protein", "protein"],
  ["catch", "Protein3D", "protein", "Protein"],
  ["catch", "ligandCount", "ligand", "ligand"],
  ["catch", "gene_id", "gene", "gene"],
  ["catch", "readGeneMatrix", "gene", "Gene"],
  ["catch", "DNAParser", "dna", "DNA"],
  ["catch", "bindingAffinity", "binding affinity", "bindingAffinity"],
  ["catch", "binding_site", "binding site", "binding_site"],
  ["catch", "BINDING-SITES", "binding site", "BINDING-SITES"],
  ["catch", "biological", "biological", "biological"],
  ["catch", "biologically", "biologically", "biologically"],
  ["catch", "proteomics", "proteomics", "proteomics"],
  ["catch", "proteomic", "proteomic", "proteomic"],
  ["catch", "genomics", "genomics", "genomics"],
  ["catch", "enzymatic", "enzymatic", "enzymatic"],
  ["catch", "BRCA1", "brca1", "BRCA1", "BRCA1"],
  ["catch", "readBRCA1Count", "brca1", "BRCA1", "BRCA1"],
  ["catch", "brca1Status", "brca1", "brca1", "BRCA1"],
  ["catch", "loadBRCA1", "brca1", "BRCA1", "BRCA1"],
  ["catch", "BRCA 1", "brca1", "BRCA 1", "BRCA1"],
  ["catch", "il6Level", "il6", "il6", "IL6"],
  ["catch", "loadIL6Count", "il6", "IL6", "IL6"],
  ["catch", "IL-6", "il6", "IL-6", "IL6"],
  ["catch", "IL 6", "il6", "IL 6", "IL6"],
  ["catch", "IL\n6", "il6", "IL\n6", "IL6"],
  ["catch", "cd4Count", "cd4", "cd4", "CD4"],
  ["catch", "CD 4", "cd4", "CD 4", "CD4"],
  ["catch", "dCas9", "cas9", "Cas9", "Cas9"],
  ["catch", "spCas9", "cas9", "Cas9", "Cas9"],
  ["catch", "readCas9", "cas9", "Cas9", "Cas9"],
  ["catch", "readCRISPRCas9Count", "crispr cas9", "CRISPRCas9", "CRISPR-Cas9"],
  ["catch", "getFOXP3", "foxp3", "FOXP3", "FOXP3"],
  ["catch", "readRowGroup2Count", "rowgroup2", "RowGroup2", "RowGroup2"],
  ["catch", "mAbTiter", "mab", "mAb", "mAb"],
  ["catch", "mAb_titer", "mab", "mAb", "mAb"],
  ["catch", "pKaValue", "pka", "pKa", "pKa"],
  ["catch", "pKa_value", "pka", "pKa", "pKa"],
  ["catch", "mAb\n titer", "mab titer", "mAb\n titer", "mAb titer"],
  ["catch", "categories", "category", "categories", "category"],
  ["catch", "categories", "category", "categories", "CATEGORY"],
  ["catch", "activities", "activity", "activities", "activity"],
  ["catch", "IL-6", "il 6", "IL-6", "IL-6"],
  ["catch", "CRISPR-Cas9", "crispr cas9", "CRISPR-Cas9", "CRISPR-Cas9"],
  ["catch", "α_helix", "α helix", "α_helix", "α helix"],
  ["catch", "α-helix", "α helix", "α-helix", "α_helix"],
  ["catch", "mutation", "mutation", "mutation", "mutation"],
  ["catch", "pdb", "pdb", "pdb", "pdb"],
  ["catch", "docking", "docking", "docking", "docking"],
  ["catch", "smiles", "smiles", "smiles", "smiles"],
  ["catch", "assayes", "assay", "assayes"],
  ["catch", "CoAValue", "coa", "CoA", "CoA"],
  ["pass", "const binding = site.binding;"],
  ["pass", "binding: site"],
  ["pass", "roleBinding.affinity"],
  ["pass", "the data binding.\n\nSite deployment"],
  ["pass", "binding.affinity"],
  ["pass", "binding/affinities"],
  ["pass", "general"],
  ["pass", "generator"],
  ["pass", "generic"],
  ["pass", "cancellation"],
  ["pass", "excellent"],
  ["pass", "eigenvalue matrix vector"],
  ["pass", "useMutation(Q)"],
  ["pass", "new MutationObserver(cb)"],
  ["pass", "mutation testing"],
  ["pass", "import pdb; pdb.set_trace()"],
  ["pass", "docking layout"],
  ["pass", "he smiles"],
  ["pass", "genetic algorithm"],
  ["pass", "enzyme.mount(<App/>)"],
  ["pass", "import { mount } from 'enzyme'; enzyme.mount(<App/>)"],
  ["pass", "x = m - abs(y)", null, null, "mAb"],
  ["pass", "p - ka", null, null, "pKa"],
  ["pass", "m_AbTiter", null, null, "mAb"],
  ["pass", "m-AbTiter", null, null, "mAb"],
  ["pass", "co - a", null, null, "CoA"],
  ["pass", "ids", null, null, "id"],
  ["pass", "Sort rows by the third column, then merge runs within 5 of the previous end.\n"],
];

describe("term-free regression table", () => {
  test.each(regressionCases.map(([verdict, input, term = null, found = null, extra = null]) => [verdict, input, term, found, extra]))("%s %j", (verdict, input, term, found, extra) => {
    const file = brief(`Sort rows.\n${input}\n`);
    const result = run(file, ...(extra ? ["--term", extra] : []));
    expect(result).toEqual(verdict === "catch" ? {
      status: 1, stdout: `line 2: ${term} (${JSON.stringify(found)})\n`, stderr: "",
    } : {
      status: 0, stdout: `ok: no listed term in ${file}\n`, stderr: "",
    });
  });
});

describe("findTerms", () => {
  test("reports each occurrence in reading order with original spellings and CRLF lines", async () => {
    const { findTerms } = await checker();
    expect(findTerms("protein gene protein\r\nGENES", ["gene", "protein"])).toEqual([
      { line: 1, term: "protein", found: "protein" },
      { line: 1, term: "gene", found: "gene" },
      { line: 1, term: "protein", found: "protein" },
      { line: 2, term: "gene", found: "GENES" },
    ]);
  });

  test.each([["proteomic", "proteomics"], ["proteomics", "proteomic"]])("reports the longer term once for the same span with %j first", async (first, second) => {
    const { findTerms } = await checker();
    expect(findTerms("proteomics readProteomicsCount", [first, second])).toEqual([
      { line: 1, term: "proteomics", found: "proteomics" },
      { line: 1, term: "proteomics", found: "Proteomics" },
    ]);
  });

  test.each([["rna", "rna seq"], ["rna seq", "rna"]])("drops contained spans with %j first", async (first, second) => {
    const { findTerms } = await checker();
    expect(findTerms("RNA-seq data; rnaSeqData; rna", [first, second])).toEqual([
      { line: 1, term: "rna seq", found: "RNA-seq" },
      { line: 1, term: "rna seq", found: "rnaSeq" },
      { line: 1, term: "rna", found: "rna" },
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
