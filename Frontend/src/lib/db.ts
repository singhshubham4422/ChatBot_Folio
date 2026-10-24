import type { Chunk, DocumentRef, PageRecord, Preferences, Session } from '../types';

const DB_NAME = 'folio-local';
const DB_VERSION = 3;
export type DocRecord = DocumentRef & { pdf?: Blob };
type StoredPage = PageRecord & { id: string; documentId: string };
type StoredChunk = Chunk & { documentId: string };
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = event => {
      const db = req.result;
      if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('documents')) db.createObjectStore('documents', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('pages')) { const store = db.createObjectStore('pages', { keyPath: 'id' }); store.createIndex('documentId', 'documentId'); }
      if (!db.objectStoreNames.contains('chunks')) { const store = db.createObjectStore('chunks', { keyPath: 'id' }); store.createIndex('documentId', 'documentId'); }
      if (!db.objectStoreNames.contains('preferences')) db.createObjectStore('preferences', { keyPath: 'id' });
      // Migrate the original v1 combined session records into the document/page/chunk stores.
      if ((event as IDBVersionChangeEvent).oldVersion > 0 && (event as IDBVersionChangeEvent).oldVersion < 3) {
        const tx = req.transaction!; const sessions = tx.objectStore('sessions'); const cursorReq = sessions.openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result; if (!cursor) return;
          const legacy = cursor.value as Session & { pdf?: Blob; chunks?: Partial<Chunk>[] };
          if (legacy.pdf || legacy.chunks?.length) {
            const documentId = legacy.documentId ?? legacy.id;
            tx.objectStore('documents').put({ id: documentId, pdf: legacy.pdf, hash: '', pageCount: legacy.pageCount, processing: legacy.processing });
            const byPage = new Map<number, string[]>();
            for (const oldChunk of legacy.chunks ?? []) {
              const page = Number(oldChunk.page) || 1; const text = String(oldChunk.text ?? '');
              const id = `${documentId}:${String(oldChunk.id ?? `${page}-${byPage.get(page)?.length ?? 0}`)}`;
              tx.objectStore('chunks').put({ id, documentId, page, text, start: oldChunk.start ?? 0, end: oldChunk.end ?? text.length, quality: oldChunk.quality ?? 'good', section: oldChunk.section });
              byPage.set(page, [...(byPage.get(page) ?? []), text]);
            }
            for (const [page, texts] of byPage) tx.objectStore('pages').put({ id: `${documentId}:${page}`, documentId, page, text: texts.join('\n'), quality: 'good' });
            const { pdf: _pdf, chunks: _chunks, ...session } = legacy;
            cursor.update({ ...session, documentId, status: legacy.pdf ? legacy.status : 'error' });
          }
          cursor.continue();
        };
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function request<T>(db: IDBDatabase, store: string, mode: IDBTransactionMode, action: (os: IDBObjectStore) => IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode); const req = action(tx.objectStore(store));
    let result: T;
    req.onsuccess = () => { result = req.result as T; };
    tx.oncomplete = () => { db.close(); resolve(result!); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('IndexedDB transaction was interrupted.')); };
  });
}
export async function allSessions(): Promise<Session[]> {
  const db = await openDb();
  return ((await request<Session[]>(db, 'sessions', 'readonly', os => os.getAll())) ?? []).sort((a, b) => b.updatedAt - a.updatedAt);
}
export async function saveSession(session: Session): Promise<void> { const db = await openDb(); await request(db, 'sessions', 'readwrite', os => os.put(session)); }
export async function removeSession(id: string): Promise<void> {
  const readDb = await openDb(); const session = await request<Session | undefined>(readDb, 'sessions', 'readonly', os => os.get(id));
  const db = await openDb();
  const tx = db.transaction(['sessions', 'documents', 'pages', 'chunks'], 'readwrite'); tx.objectStore('sessions').delete(id);
  if (session?.documentId) {
    tx.objectStore('documents').delete(session.documentId);
    for (const storeName of ['pages', 'chunks']) {
      const store = tx.objectStore(storeName); const req = store.index('documentId').openKeyCursor(IDBKeyRange.only(session.documentId));
      req.onsuccess = () => { const cursor = req.result; if (cursor) { store.delete(cursor.primaryKey); cursor.continue(); } };
    }
  }
  await new Promise<void>((resolve, reject) => { tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => { db.close(); reject(tx.error); }; tx.onabort = () => { db.close(); reject(tx.error); }; });
}
export async function deleteDocumentData(documentId: string): Promise<void> {
  const db = await openDb(); const tx = db.transaction(['documents', 'pages', 'chunks'], 'readwrite');
  tx.objectStore('documents').delete(documentId);
  for (const storeName of ['pages', 'chunks']) {
    const store = tx.objectStore(storeName); const req = store.index('documentId').openKeyCursor(IDBKeyRange.only(documentId));
    req.onsuccess = () => { const cursor = req.result; if (cursor) { store.delete(cursor.primaryKey); cursor.continue(); } };
  }
  await new Promise<void>((resolve, reject) => { tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => { db.close(); reject(tx.error); }; tx.onabort = () => { db.close(); reject(tx.error); }; });
}
export async function saveDocument(id: string, pdf: Blob, hash: string, metadata: Partial<DocumentRef> = {}): Promise<void> {
  const db = await openDb(); await request(db, 'documents', 'readwrite', os => os.put({ id, pdf, hash, fileName: metadata.fileName ?? 'document.pdf', status: metadata.status ?? 'processing', ...metadata } satisfies DocRecord));
}
export async function saveDocProgress(id: string, pageCount: number, processing: Session['processing']): Promise<void> {
  const readDb = await openDb(); const doc = await request<DocRecord | undefined>(readDb, 'documents', 'readonly', os => os.get(id));
  if (!doc) throw new Error('The stored PDF is missing. Upload it again to resume processing.');
  const db = await openDb();
  await request(db, 'documents', 'readwrite', os => os.put({ ...doc, pageCount, processing }));
}
export async function getDocument(id: string): Promise<DocRecord | undefined> { const db = await openDb(); return request(db, 'documents', 'readonly', os => os.get(id)); }
export async function savePageAndChunks(documentId: string, page: PageRecord, chunks: Chunk[]): Promise<void> {
  const db = await openDb(); const tx = db.transaction(['pages', 'chunks'], 'readwrite');
  tx.objectStore('pages').put({ ...page, id: `${documentId}:${page.page}`, documentId } satisfies StoredPage);
  const chunkStore = tx.objectStore('chunks');
  const existing = chunkStore.index('documentId').openCursor(IDBKeyRange.only(documentId));
  existing.onsuccess = () => {
    const cursor = existing.result;
    if (cursor) { if ((cursor.value as StoredChunk).page === page.page) cursor.delete(); cursor.continue(); }
    else for (const chunk of chunks) chunkStore.put({ ...chunk, id: `${documentId}:${chunk.id}`, documentId } satisfies StoredChunk);
  };
  await new Promise<void>((resolve, reject) => { tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => { db.close(); reject(tx.error); }; tx.onabort = () => { db.close(); reject(tx.error); }; });
}
export async function getPages(documentId: string): Promise<PageRecord[]> {
  const db = await openDb(); const rows = await request<StoredPage[]>(db, 'pages', 'readonly', os => os.index('documentId').getAll(IDBKeyRange.only(documentId)));
  return (rows ?? []).sort((a, b) => a.page - b.page).map(({ id: _id, documentId: _documentId, ...page }) => page);
}
export async function getChunks(documentId: string): Promise<Chunk[]> {
  const db = await openDb(); const rows = await request<StoredChunk[]>(db, 'chunks', 'readonly', os => os.index('documentId').getAll(IDBKeyRange.only(documentId)));
  return (rows ?? []).sort((a, b) => a.page - b.page).map(({ documentId: _documentId, ...chunk }) => chunk);
}
export async function getPreferences(): Promise<Preferences | undefined> { const db = await openDb(); return request(db, 'preferences', 'readonly', os => os.get('user')); }
export async function savePreferences(preferences: Preferences): Promise<void> { const db = await openDb(); await request(db, 'preferences', 'readwrite', os => os.put({ ...preferences, id: 'user' })); }
export async function clearApplicationData(): Promise<void> {
  const db = await openDb(); const tx = db.transaction(['sessions', 'documents', 'pages', 'chunks', 'preferences'], 'readwrite');
  for (const name of ['sessions', 'documents', 'pages', 'chunks', 'preferences']) tx.objectStore(name).clear();
  await new Promise<void>((resolve, reject) => { tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => { db.close(); reject(tx.error); }; tx.onabort = () => { db.close(); reject(tx.error); }; });
}
export const newSession = (name: string): Session => ({ id: crypto.randomUUID(), name, status: 'empty', createdAt: Date.now(), updatedAt: Date.now(), messages: [], documents: [], selectedDocumentIds: [] });
