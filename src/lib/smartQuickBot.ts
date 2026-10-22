import type { Chunk } from '../types';

type SmartPassage = { id: string; fileName: string; page: number; text: string; weights: Record<string, number> };
type SmartModel = { version: number; kind: string; vocabulary: string[]; idf: Record<string, number>; passages: SmartPassage[] };
const STOP = new Set('a an and are as at be by can does for from how i in is it of on or that the this to was what when where which who why with'.split(' '));
let cached: SmartModel | undefined;
let loading: Promise<SmartModel> | undefined;

function tokens(value: string) { return (value.toLowerCase().match(/[a-z0-9]{2,}/g) ?? []).filter(token => !STOP.has(token)); }

async function loadSmartModel() {
  if (cached) return cached;
  if (!loading) {
    loading = fetch('/quick-bot/smart-model.json', { cache: 'force-cache' })
      .then(async response => {
        if (!response.ok) throw new Error('The Smart Quick Bot model is not available.');
        const model = await response.json() as SmartModel;
        if (model.kind !== 'smart-quickbot-tfidf-router' || !Array.isArray(model.passages)) throw new Error('The Smart Quick Bot model is invalid.');
        cached = model;
        return model;
      }).finally(() => { loading = undefined; });
  }
  return loading;
}

export async function searchSmartQuickBot(question: string, limit = 5): Promise<Chunk[]> {
  const model = await loadSmartModel();
  const query = new Map<string, number>();
  for (const token of tokens(question)) query.set(token, (query.get(token) ?? 0) + (model.idf[token] ?? 0));
  const queryLength = Math.sqrt([...query.values()].reduce((sum, value) => sum + value * value, 0)) || 1;
  return model.passages.map(passage => {
    let dot = 0; let passageLength = 0;
    for (const [term, weight] of Object.entries(passage.weights)) {
      passageLength += weight * weight;
      dot += weight * (query.get(term) ?? 0);
    }
    const score = dot / ((Math.sqrt(passageLength) || 1) * queryLength);
    return { passage, score };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, limit)
    .map(({ passage }) => ({ id: passage.id, fileName: passage.fileName, page: passage.page, text: passage.text, start: 0, end: passage.text.length, quality: 'good', documentId: `quick:${passage.fileName}` }));
}
