// The USC Staff Directory's fixed vocabulary, shared by the Worker (validation) and the browser (labels, import preflight).

/** USC offices and departments in the council's own order, by the codes the official ID archive uses. */
export const DEPARTMENTS = {
  OfP: "Office of the President",
  OVP: "Office of the Vice President",
  SEC: "Office of the Secretary-General",
  DoF: "Department of Finance",
  DEM: "Department of Events Management",
  DoL: "Department of Logistics",
  DCES: "Department of Community Extension Services",
  DPC: "Department of Public Communications",
  DHR: "Department of Human Resources",
  DBR: "Department of Business Relations"
} as const;
export type DepartmentCode = keyof typeof DEPARTMENTS;
export const DEPARTMENT_CODES = Object.keys(DEPARTMENTS) as DepartmentCode[];

const BY_UPPER = new Map(DEPARTMENT_CODES.map((code) => [code.toUpperCase(), code]));
/** A department code however the archive capitalised it ("DOL", "dol", "DoL"), or null when it is not one of ours. */
export const departmentCode = (value: string): DepartmentCode | null => BY_UPPER.get(value.trim().toUpperCase()) ?? null;

/**
 * The identity part of a scan's file name, reduced to what cannot vary by typing: accents and case dropped, and every run of
 * spaces, underscores, dots or dashes made one space ("Dela_Cruz", "dela cruz" and "DELA-CRUZ" are the same person).
 */
export const normalizeIdentity = (raw: string): string =>
  raw.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * How a person is recognised in an imported archive: normalised identity and department, never the surname alone. Spaces
 * do not count, so DelaCruz, Dela_Cruz and "Dela Cruz" are one person (a file named without the space once made a
 * second entry for someone already in the directory).
 */
export const sourceKey = (identity: string, department: DepartmentCode): string => `${normalizeIdentity(identity).replace(/ /g, "")}|${department}`;
