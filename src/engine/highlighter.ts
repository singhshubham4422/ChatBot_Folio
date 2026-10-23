const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'else', 'when',
  'at', 'by', 'for', 'with', 'about', 'against', 'between', 'into',
  'through', 'during', 'before', 'after', 'above', 'below', 'to', 'from',
  'up', 'down', 'in', 'out', 'on', 'off', 'over', 'under', 'again',
  'further', 'then', 'once', 'here', 'there', 'all', 'any', 'both',
  'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor',
  'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'can',
  'will', 'just', 'should', 'now', 'what', 'which', 'who', 'whom',
  'this', 'that', 'these', 'those', 'am', 'is', 'are', 'was', 'were',
  'be', 'been', 'being', 'have', 'has', 'had', 'having', 'do', 'does',
  'did', 'doing', 'would', 'could', 'how', 'why'
]);

export function extractKeywords(query: string): Set<string> {
  const words = query
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOP_WORDS.has(w));
  return new Set(words);
}

/**
 * Safely appends text with highlighted keywords directly to a target element.
 * Strictly adheres to security rules: never uses innerHTML, only DOM nodes and textContent.
 */
export function appendHighlightedText(text: string, query: string, targetEl: HTMLElement): void {
  const keywords = extractKeywords(query);

  if (keywords.size === 0) {
    targetEl.appendChild(document.createTextNode(text));
    return;
  }

  // Tokenize by word boundary
  const tokens = text.split(/(\b[\w'-]+\b)/g);

  for (const token of tokens) {
    if (!token) continue;
    const lower = token.toLowerCase();

    if (keywords.has(lower)) {
      const mark = document.createElement('mark');
      mark.className = 'match-highlight';
      mark.textContent = token;
      targetEl.appendChild(mark);
    } else {
      targetEl.appendChild(document.createTextNode(token));
    }
  }
}

/**
 * Safely renders passage text into a container element with highlighted query keywords.
 */
export function createHighlightedPassageElement(passageText: string, query: string): HTMLElement {
  const container = document.createElement('p');
  container.className = 'passage-body';
  appendHighlightedText(passageText, query, container);
  return container;
}

