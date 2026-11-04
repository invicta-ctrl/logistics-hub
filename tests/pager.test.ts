import { describe, expect, it } from "vitest";
import { PAGE_SIZE, pageNumbers, pageOf } from "../src/pager-math";

/* V1.16.12: the arithmetic under the numbered pages. */

describe("pageNumbers", () => {
  it("lists every page when there are few", () => {
    expect(pageNumbers(1, 1)).toEqual([1]);
    expect(pageNumbers(2, 5)).toEqual([1, 2, 3, 4, 5]);
  });
  it("keeps the first, the last and the neighbours of the current page, with a gap for the rest", () => {
    expect(pageNumbers(1, 9)).toEqual([1, 2, "…", 9]);
    expect(pageNumbers(5, 9)).toEqual([1, "…", 4, 5, 6, "…", 9]);
    expect(pageNumbers(9, 9)).toEqual([1, "…", 8, 9]);
  });
  it("shows a single missing page rather than a gap that would take the same room", () => {
    expect(pageNumbers(4, 9)).toEqual([1, 2, 3, 4, 5, "…", 9]);
    expect(pageNumbers(6, 9)).toEqual([1, "…", 5, 6, 7, 8, 9]);
  });
});

describe("pageOf", () => {
  const list = Array.from({ length: 214 }, (_, index) => index);
  it("cuts pages of 25 and says where the page starts", () => {
    expect(PAGE_SIZE).toBe(25);
    const second = pageOf(list, 2);
    expect(second.rows).toEqual(list.slice(25, 50));
    expect(second).toMatchObject({ first: 25, total: 214, page: 2, pages: 9 });
    expect(pageOf(list, 9).rows).toHaveLength(14);
  });
  it("holds a page past the end, before the start or not a number to the nearest real page", () => {
    expect(pageOf(list, 40).page).toBe(9);
    expect(pageOf(list, 0).page).toBe(1);
    expect(pageOf(list, Number.NaN).page).toBe(1);
    expect(pageOf([], 3)).toMatchObject({ rows: [], page: 1, pages: 1, total: 0 });
  });
});
