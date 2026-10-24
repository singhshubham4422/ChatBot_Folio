export type DocumentStatus = 'empty' | 'processing' | 'ready' | 'partial' | 'error';
export type DocumentRef = { id: string; fileName: string; hash?: string; pageCount?: number; status: DocumentStatus; processing?: ProcessingState; error?: string };
export type Citation = { documentId: string; fileName: string; page: number };
export type Chunk = { id: string; documentId?: string; fileName?: string; page: number; text: string; section?: string; start: number; end: number; quality: PageRecord['quality'] };
export type PageRecord = { page: number; text: string; quality: 'good' | 'thin' | 'ocr' | 'failed'; error?: string };
export type ProcessingState = { phase: 'idle' | 'parsing' | 'ocr' | 'indexing' | 'paused' | 'complete' | 'error'; completedPages: number; totalPages: number; failedPages: number[]; lowQualityPages?: number[]; updatedAt: number };
export type Message = { id: string; role: 'user' | 'assistant'; content: string; createdAt: number; citations?: Citation[]; mode?: 'online' | 'offline'; error?: boolean };
export type Session = {
  id: string; documentId?: string; name: string; fileName?: string; pageCount?: number; status: 'empty' | 'processing' | 'ready' | 'partial' | 'error';
  createdAt: number; updatedAt: number; processing?: ProcessingState; messages: Message[]; summary?: string; summaryThrough?: number;
  documents?: DocumentRef[]; selectedDocumentIds?: string[];
};
export type Preferences = { displayName: string; selectedSessionId?: string; modelId: string; modelAutoDownload: boolean; ocrEnabled: boolean; onlineConsent: boolean; geminiConsent?: boolean; readAloud?: boolean; answerMode: 'online' | 'offline' };
