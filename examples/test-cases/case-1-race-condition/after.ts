interface Event { version: number }
interface Store {
  // The backing store must isolate version data and implement atomic conditional publication.
  write(event: Event): Promise<Event>;
  publish(event: Event, conditional: boolean): Promise<void>;
}

export async function update(event: Event, loadVersion: () => Promise<number>, store: Store) {
  if (event.version < await loadVersion()) return;
  const built = await store.write(event);
  await store.publish(built, true);
}
