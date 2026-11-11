export function pageSize(input: number): number {
  if (!Number.isInteger(input) || input < 1 || input > 100) {
    throw new RangeError('page size must be an integer from 1 to 100');
  }
  return input;
}
