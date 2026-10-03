import { describe, expect, it } from "vitest";
import { departmentCode, normalizeIdentity, sourceKey } from "../src/directory-policy";
import { preflight } from "../src/staff-import";

/* V1.3 official-ID import preflight, on fictional file names only. */

const file = (path: string, hash?: string, size = 1000) => ({ path, size, hash });
const kinds = (result: ReturnType<typeof preflight>) => result.issues.map((issue) => issue.kind).sort();

describe("identity and department", () => {
  it("normalises spelling, accents and separators, never more", () => {
    expect(normalizeIdentity("Dela_Cruz")).toBe("dela cruz");
    expect(normalizeIdentity("  DELA-CRUZ ")).toBe("dela cruz");
    expect(normalizeIdentity("Peña")).toBe("pena");
    expect(normalizeIdentity("Cruz_J")).not.toBe(normalizeIdentity("Cruz"));
    expect(sourceKey("Dela Cruz", "DoL")).toBe("delacruz|DoL");
    // A compound surname is one person however the file spells the gap.
    expect(new Set(["DelaCruz", "Dela_Cruz", "Dela Cruz", "dela-cruz"].map((name) => sourceKey(name, "DBR")))).toEqual(new Set(["delacruz|DBR"]));
  });

  it("reads department codes however they were capitalised", () => {
    expect(departmentCode("DOL")).toBe("DoL");
    expect(departmentCode("ofp")).toBe("OfP");
    expect(departmentCode("DCES")).toBe("DCES");
    expect(departmentCode("XYZ")).toBeNull();
  });
});

describe("preflight", () => {
  it("pairs fronts and backs per person and department, in the council's department order", () => {
    const result = preflight([
      file("Official IDs/[DoL] Official ID/Santos_Front_DoL.png"), file("Official IDs/[DoL] Official ID/Santos_Back_DoL.png"),
      file("Official IDs/[DEM] Official ID/Reyes_Back_DEM.png"), file("Official IDs/[DEM] Official ID/Reyes_Front_DEM.png"),
      file("Official IDs/[OfP] Official ID/Lim_Front_OfP.jpg"), file("Official IDs/[OfP] Official ID/Lim_Back_OfP.jpeg")
    ]);
    expect(result.issues).toEqual([]);
    expect(result.pairs.map((pair) => [pair.identity, pair.department, pair.officer, pair.front.path.includes("_Front_"), pair.back.path.includes("_Back_")])).toEqual([
      ["Lim", "OfP", false, true, true], ["Reyes", "DEM", false, true, true], ["Santos", "DoL", false, true, true]
    ]);
  });

  it("keeps an OFFICERS file in the department its name encodes, with officer status beside it", () => {
    const result = preflight([file("IDs/OFFICERS/Garcia_Front_DoL.png"), file("IDs/OFFICERS/Garcia_Back_DoL.png")]);
    expect(result.pairs).toEqual([expect.objectContaining({ key: "garcia|DoL", department: "DoL", officer: true })]);
  });

  it("merges a byte-identical copy in OFFICERS and its department folder into one officer scan", () => {
    const result = preflight([
      file("IDs/[DoL] Official ID/Garcia_Front_DoL.png", "aa"), file("IDs/[DoL] Official ID/Garcia_Back_DoL.png", "bb"),
      file("IDs/OFFICERS/Garcia_Front_DoL.png", "aa"), file("IDs/OFFICERS/Garcia_Back_DoL.png", "bb")
    ]);
    expect(result.issues).toEqual([]);
    expect(result.pairs).toEqual([expect.objectContaining({ department: "DoL", officer: true })]);
  });

  it("holds different scans for one person and side as duplicates, without a hash or with different ones", () => {
    expect(kinds(preflight([file("A/[DoL] Official ID/Garcia_Front_DoL.png", "aa"), file("A/OFFICERS/Garcia_Front_DoL.png", "zz"), file("A/[DoL] Official ID/Garcia_Back_DoL.png")]))).toEqual(["DUPLICATE"]);
    expect(kinds(preflight([file("A/[DoL] Official ID/Garcia_Front_DoL.png"), file("A/[DoL] Official ID/garcia_front_DOL.png"), file("A/[DoL] Official ID/Garcia_Back_DoL.png")]))).toEqual(["DUPLICATE"]);
  });

  it("never pairs by surname alone: the same surname in two departments is held for a person to decide", () => {
    const result = preflight([
      file("A/[DoL] Official ID/Cruz_Front_DoL.png"), file("A/[DoL] Official ID/Cruz_Back_DoL.png"),
      file("A/[DEM] Official ID/Cruz_Front_DEM.png"), file("A/[DEM] Official ID/Cruz_Back_DEM.png"),
      file("A/[DEM] Official ID/Cruz_J_Front_DEM.png"), file("A/[DEM] Official ID/Cruz_J_Back_DEM.png")
    ]);
    expect(result.pairs.map((pair) => pair.key)).toEqual(["cruzj|DEM"]);
    expect(kinds(result)).toEqual(["AMBIGUOUS", "AMBIGUOUS"]);
  });

  it("reports missing sides, unknown codes, malformed names and misfiled scans, and skips desktop clutter", () => {
    const result = preflight([
      file("A/[DoL] Official ID/Uno_Front_DoL.png"),
      file("A/[DoL] Official ID/Dos_Back_DoL.png"),
      file("A/[DoL] Official ID/Tres_Front_XYZ.png"),
      file("A/[DoL] Official ID/scan 4.png"),
      file("A/[DoL] Official ID/notes.pdf"),
      file("A/[DoL] Official ID/Cuatro_Front_DEM.png"),
      file("A/Misc/Cinco_Front_DoL.png"),
      file("A/[DoL] Official ID/Seis_Front_DoL.heic"),
      file("A/[DoL] Official ID/Siete_Front_DoL.png", undefined, 30 * 1024 * 1024),
      file("A/[DoL] Official ID/.DS_Store"), file("A/desktop.ini"), file("A/__MACOSX/[DoL] Official ID/._Uno_Front_DoL.png")
    ]);
    expect(result.pairs).toEqual([]);
    expect(kinds(result)).toEqual(["FOLDER_MISMATCH", "MALFORMED", "MALFORMED", "MALFORMED", "MALFORMED", "MISSING_BACK", "MISSING_FRONT", "UNEXPECTED_FOLDER", "UNKNOWN_DEPARTMENT"]);
    expect(result.ignored).toHaveLength(3);
    expect(result.files).toBe(12);
  });

  it("accepts files chosen one by one, with no folder, by their names", () => {
    expect(preflight([file("Abad_Front_DHR.png"), file("Abad_Back_DHR.png")]).pairs).toEqual([expect.objectContaining({ key: "abad|DHR", officer: false })]);
  });
});
