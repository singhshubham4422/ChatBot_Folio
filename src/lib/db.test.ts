import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { allSessions, clearApplicationData, getChunks, getDocument, getPages, newSession, removeSession, saveDocProgress, saveDocument, savePageAndChunks, saveSession } from './db';

describe('IndexedDB recovery', () => {
  beforeEach(async () => { await clearApplicationData(); });
  it('persists the session, original PDF, page map, and indexed chunks separately', async () => {
    const session = newSession('Research notes'); session.documentId = 'doc-1'; session.fileName = 'notes.pdf'; session.status = 'partial';
    await saveSession(session); await saveDocument('doc-1', new Blob(['%PDF-1.7']), 'hash-1');
    await saveDocProgress('doc-1', 1, { phase: 'indexing', completedPages: 1, totalPages: 1, failedPages: [], updatedAt: Date.now() });
    await savePageAndChunks('doc-1', { page: 1, text: 'A useful paragraph.', quality: 'good' }, [{ id: '1:0', page: 1, text: 'A useful paragraph.', start: 0, end: 19, quality: 'good' }]);
    expect((await allSessions())[0].status).toBe('partial');
    expect((await getDocument('doc-1'))?.hash).toBe('hash-1');
    expect((await getPages('doc-1'))[0].page).toBe(1);
    expect((await getChunks('doc-1'))[0].text).toBe('A useful paragraph.');
  });
  it('can clear local app data after a restart-safe write', async () => {
    await saveSession(newSession('To delete'));
    await clearApplicationData();
    expect(await allSessions()).toEqual([]);
  });
  it('deletes the session together with its PDF, page map, and chunks', async () => {
    const session = newSession('To remove'); session.documentId = 'doc-delete'; await saveSession(session);
    await saveDocument('doc-delete', new Blob(['%PDF-1.7']), 'hash-delete');
    await savePageAndChunks('doc-delete', { page: 1, text: 'Stored text', quality: 'good' }, [{ id: '1:0', page: 1, text: 'Stored text', start: 0, end: 11, quality: 'good' }]);
    await removeSession(session.id);
    expect(await allSessions()).toEqual([]); expect(await getDocument('doc-delete')).toBeUndefined();
    expect(await getPages('doc-delete')).toEqual([]); expect(await getChunks('doc-delete')).toEqual([]);
  });
});
