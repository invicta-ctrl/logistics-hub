/** A small valid JPEG for tests: tables, a frame of the given size, one scan with a stuffed byte, then whatever `after` adds. */
export const segment = (marker: number, payload: number[]) => [0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 255, ...payload];

export function jpeg(options: { width?: number; height?: number; before?: number[]; after?: number[]; marker?: number; components?: number; precision?: number } = {}): Uint8Array {
  const { width = 8, height = 6, before = [], after = [], marker = 0xc0, components = 3, precision = 8 } = options;
  const frame = segment(marker, [precision, height >> 8, height & 255, width >> 8, width & 255, components, ...Array.from({ length: components }, (_, index) => [index + 1, 0x11, 0]).flat()]);
  return Uint8Array.from([0xff, 0xd8, ...before, ...segment(0xdb, [0, ...Array(64).fill(1)]), ...frame, ...segment(0xc4, [0, ...Array(16).fill(0)]),
    ...segment(0xda, [components, ...Array.from({ length: components }, (_, index) => [index + 1, 0]).flat(), 0, 63, 0]), 0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56, 0xff, 0xd9, ...after]);
}
