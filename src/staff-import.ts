import { DEPARTMENTS, type DepartmentCode, departmentCode, normalizeIdentity, sourceKey } from "./directory-policy";

/*
 * Preflight of an official-ID archive before anything is uploaded: which Front/Back scans form a complete pair for one
 * person, and which need a person to look at them first. It reads only folder and file names (and, in the browser, a hash
 * of each file's bytes); it never reads faces or the text on a card.
 *
 * The archive is department folders ("[DoL] Official ID") of scans named "<Identity>_<Front|Back>_<CODE>.png", plus an
 * OFFICERS folder whose files carry the person's real department code. A pair is keyed by normalised identity +
 * department code + side, so two people who share a surname in different departments are never merged, and an officer
 * stays in their own department with officer status beside it.
 */

/** One file as the browser (or a listing) gives it: its path inside the chosen folder, its size, and optionally a hash of its bytes. */
export type SourceFile = { path: string; size: number; hash?: string };
export type Side = "front" | "back";
export type Pair = { key: string; identity: string; department: DepartmentCode; officer: boolean; front: SourceFile; back: SourceFile };
export const ISSUE_KINDS = {
  MISSING_FRONT: "Missing front",
  MISSING_BACK: "Missing back",
  DUPLICATE: "Duplicate scans",
  AMBIGUOUS: "Same name in more than one department",
  UNKNOWN_DEPARTMENT: "Unknown department code",
  MALFORMED: "File name not in the expected form",
  FOLDER_MISMATCH: "Department code differs from its folder",
  UNEXPECTED_FOLDER: "Not in a department or OFFICERS folder"
} as const;
export type IssueKind = keyof typeof ISSUE_KINDS;
export type Issue = { kind: IssueKind; files: string[]; detail: string };
export type Preflight = { files: number; pairs: Pair[]; issues: Issue[]; ignored: string[] };

const NAME = /^(.+?)_(front|back)_([A-Za-z]+)\.(png|jpe?g|webp)$/i;
const IMAGE = /\.(png|jpe?g|webp)$/i;
const DEPARTMENT_FOLDER = /^\[([A-Za-z]+)\]\s*official\s+ids?$/i;
const OFFICERS_FOLDER = /^\[?officers?\]?(?:\s+official\s+ids?)?$/i;
/** Desktop clutter a downloaded or zipped folder may carry; skipped, but still listed so nothing disappears silently. */
const CLUTTER = /(^|\/)(\.[^/]*|desktop\.ini|thumbs\.db|__macosx)(\/|$)/i;
/** No phone or scanner makes a card scan this large; it is refused before the browser tries to decode it. */
export const MAX_SCAN_BYTES = 25 * 1024 * 1024;

type Parsed = { file: SourceFile; key: string; identity: string; side: Side; department: DepartmentCode; officer: boolean };

const segments = (path: string) => path.replace(/\\/g, "/").split("/").filter(Boolean);

export function preflight(files: SourceFile[]): Preflight {
  const issues: Issue[] = [];
  const ignored: string[] = [];
  const parsed: Parsed[] = [];
  const flag = (kind: IssueKind, list: SourceFile[] | string[], detail: string) => issues.push({ kind, files: list.map((file) => typeof file === "string" ? file : file.path).sort(), detail });

  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    if (CLUTTER.test(file.path)) { ignored.push(file.path); continue; }
    const parts = segments(file.path);
    const name = parts.at(-1) ?? "";
    // A file picked on its own has no folder; the department then comes from its name alone.
    const folder = parts.length > 1 ? parts.at(-2)! : "";
    const match = NAME.exec(name);
    if (!match) { flag("MALFORMED", [file], IMAGE.test(name) ? "Expected <Name>_Front_<CODE> or <Name>_Back_<CODE>." : "Not a PNG, JPEG or WebP image."); continue; }
    if (file.size > MAX_SCAN_BYTES) { flag("MALFORMED", [file], "Larger than 25 MB."); continue; }
    const [, identity, side, code] = match;
    const department = departmentCode(code!);
    if (!department) { flag("UNKNOWN_DEPARTMENT", [file], `"${code}" is not one of ${Object.keys(DEPARTMENTS).join(", ")}.`); continue; }
    if (!normalizeIdentity(identity!)) { flag("MALFORMED", [file], "The name part is empty."); continue; }
    const officer = OFFICERS_FOLDER.test(folder);
    const folderCode = DEPARTMENT_FOLDER.exec(folder)?.[1];
    if (folder && !officer && !folderCode) { flag("UNEXPECTED_FOLDER", [file], `"${folder}" is neither a department folder nor OFFICERS.`); continue; }
    if (folderCode && departmentCode(folderCode) !== department) { flag("FOLDER_MISMATCH", [file], `Filed under "${folder}" but named ${department}.`); continue; }
    parsed.push({ file, identity: identity!.replace(/[_.]+/g, " ").trim(), side: side!.toLowerCase() as Side, department, officer, key: sourceKey(identity!, department) });
  }

  // Each side of each person once. Byte-identical copies (the same scan in a department folder and in OFFICERS) are one scan.
  const sides = new Map<string, { front: Parsed[]; back: Parsed[] }>();
  for (const entry of parsed) {
    const slot = sides.get(entry.key) ?? { front: [], back: [] };
    slot[entry.side].push(entry);
    sides.set(entry.key, slot);
  }
  const single = (copies: Parsed[]) => copies.length === 1 || (copies.every((copy) => copy.file.hash && copy.file.hash === copies[0]!.file.hash));
  const candidates: Pair[] = [];
  for (const [key, { front, back }] of sides) {
    const all = [...front, ...back];
    const [identity, department] = [all[0]!.identity, all[0]!.department];
    if (!single(front) || !single(back)) { flag("DUPLICATE", all.map((entry) => entry.file), `${identity} (${department}) has ${front.length} fronts and ${back.length} backs that are not identical copies.`); continue; }
    if (!front.length) { flag("MISSING_FRONT", back.map((entry) => entry.file), `${identity} (${department}) has a back but no front.`); continue; }
    if (!back.length) { flag("MISSING_BACK", front.map((entry) => entry.file), `${identity} (${department}) has a front but no back.`); continue; }
    candidates.push({ key, identity, department, officer: all.some((entry) => entry.officer), front: front[0]!.file, back: back[0]!.file });
  }

  // The same name in two departments may be two people or one person filed twice: a person decides, not the importer.
  const departments = new Map<string, Set<DepartmentCode>>();
  for (const entry of parsed) {
    const name = entry.key.split("|")[0]!;
    departments.set(name, (departments.get(name) ?? new Set()).add(entry.department));
  }
  const pairs: Pair[] = [];
  for (const pair of candidates) {
    const seen = departments.get(pair.key.split("|")[0]!)!;
    if (seen.size > 1) flag("AMBIGUOUS", [pair.front, pair.back], `${pair.identity} also appears under ${[...seen].filter((code) => code !== pair.department).join(", ")}.`);
    else pairs.push(pair);
  }
  pairs.sort((a, b) => Object.keys(DEPARTMENTS).indexOf(a.department) - Object.keys(DEPARTMENTS).indexOf(b.department) || a.identity.localeCompare(b.identity));
  return { files: files.length, pairs, issues, ignored };
}
