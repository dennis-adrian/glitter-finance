/**
 * A count with its noun in the right number: "1 venta", "2 ventas",
 * "0 ventas". Spanish uses the singular only for one (and minus one, as a
 * refunded unit shows).
 */
export function countLabel(count: number, singular: string, plural: string) {
  return `${count} ${Math.abs(count) === 1 ? singular : plural}`;
}
