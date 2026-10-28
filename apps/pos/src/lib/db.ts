import { openDB, type IDBPDatabase } from 'idb';

/** IndexedDB layout: meta (key/value), products, customers, queue (offline sales), carts. */
let dbp: Promise<IDBPDatabase> | null = null;

export function db() {
  dbp ??= openDB('pd-pos', 1, {
    upgrade(d) {
      d.createObjectStore('meta');
      d.createObjectStore('products', { keyPath: 'id' });
      d.createObjectStore('customers', { keyPath: 'id' });
      d.createObjectStore('queue', { keyPath: 'clientUuid' });
      d.createObjectStore('carts');
    },
  });
  return dbp;
}

export async function closeDb() {
  if (dbp) (await dbp).close();
  dbp = null;
}
