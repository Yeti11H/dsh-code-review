export function visibleVersion(active: string | undefined, previous: string): string {
  return active ?? previous;
}
