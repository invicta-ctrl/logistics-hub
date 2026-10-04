/*
 * Possible duplicates, judged the same way in the browser (as staff type, against the catalog already loaded) and in the
 * Worker (before a capture is saved, against the database). Every signal is a plain rule staff can read; a match is only ever
 * shown, never merged or refused: two real chairs of one model are legitimate separate records.
 */

export type Known = { id: string; name: string; aliases: string | null; category: string; model: string | null; serialNumber: string | null; photoHash: string | null; status: string };
export type Candidate = { name: string; category?: string; model?: string | null; serialNumber?: string | null; photoHash?: string | null };
export type Match = { id: string; reason: string; strong: boolean };

/** Lower-case words without accents or punctuation, with a plural "s" dropped, so "Markers" and "marker" read alike. */
export function words(text: string | null | undefined): string[] {
  return (text ?? "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
    .map((word) => (word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word));
}

/** An identifier without spaces, dashes or letter case ("SN-0042 " and "sn0042" are one). */
export const compact = (text: string | null | undefined): string => (text ?? "").normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase();

/** The number of bits two 16-digit hex hashes differ by. */
export function hamming(a: string, b: string): number {
  let bits = 0;
  for (let index = 0; index < 16; index += 1) {
    let x = parseInt(a[index]!, 16) ^ parseInt(b[index]!, 16);
    while (x) { bits += x & 1; x >>= 1; }
  }
  return bits;
}
/** Photos this close (of 64 bits) are treated as the same picture: a re-shot of one object, not two similar ones. */
export const PHOTO_DISTANCE = 5;

/** The most matches shown: enough to recognise the item, few enough to read at the shelf. */
export const MAX_MATCHES = 4;

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((word) => b.includes(word));

/** Existing items that may be the one being catalogued, strongest first. `ignore` leaves out the item being edited. */
export function possibleDuplicates(candidate: Candidate, known: readonly Known[], ignore = ""): Match[] {
  const name = words(candidate.name);
  const serial = compact(candidate.serialNumber);
  const model = compact(candidate.model);
  const category = (candidate.category ?? "").trim().toLowerCase();
  const found: Array<Match & { rank: number }> = [];
  for (const item of known) {
    if (item.id === ignore) continue;
    let match: (Match & { rank: number }) | null = null;
    if (serial.length >= 3 && compact(item.serialNumber) === serial) match = { id: item.id, reason: "Same serial number", strong: true, rank: 0 };
    else if (name.length && (sameSet(name, words(item.name)) || (item.aliases ?? "").split(",").some((alias) => sameSet(name, words(alias))))) match = { id: item.id, reason: "Same name", strong: true, rank: 1 };
    else if (model.length >= 2 && compact(item.model) === model && category && item.category.trim().toLowerCase() === category) match = { id: item.id, reason: "Same model in the same category", strong: false, rank: 2 };
    else if (candidate.photoHash && item.photoHash && hamming(candidate.photoHash, item.photoHash) <= PHOTO_DISTANCE) match = { id: item.id, reason: "Its photo looks the same", strong: false, rank: 3 };
    else if (name.length >= 2) {
      const other = words(item.name);
      const shared = name.filter((word) => other.includes(word)).length;
      if (shared >= 2 && (shared === Math.min(name.length, other.length) || shared / new Set([...name, ...other]).size >= 0.75)) match = { id: item.id, reason: "Almost the same name", strong: false, rank: 4 };
    }
    if (match) found.push(match);
  }
  return found.sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id)).slice(0, MAX_MATCHES).map(({ rank: _rank, ...match }) => match);
}
