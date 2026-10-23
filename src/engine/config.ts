export const CONFIG = {
  // Cosine similarity / hybrid threshold for out-of-context gate
  THRESHOLD: 0.30,
  // Minimum score threshold for individual sentences/bullets
  SENT_FLOOR: 0.30,
  // Hybrid search weights: final = 0.6*embedding + 0.4*normalized_bm25
  EMBEDDING_WEIGHT: 0.6,
  BM25_WEIGHT: 0.4,
  SOURCE_ROUTING_BOOST: 0.05,
  KEYWORD_BOOST: 0.03,
  MAX_KEYWORD_BOOST_WORDS: 3,
  OUT_OF_CONTEXT_MESSAGE: 'Out of context — I can only answer from the provided documents.',
  MODEL_NAME: 'Xenova/all-MiniLM-L6-v2',
  TOP_K: 3,
  INDEX_URL: '/index.json',

  SYNONYM_MAP: [
    {
      match: ['marking scheme', 'marking', 'negative marking', 'negative marks'],
      synonyms: ['marks', 'negative marking', 'correct answer', 'wrong answer', '+3', '-1', 'penalty', '130 questions', '3 hours', 'reduction'],
    },
    {
      match: ['fee', 'fees', 'tuition'],
      synonyms: ['payment', 'tuition fee', 'cost', 'charges', 'semester fees'],
    },
    {
      match: ['dates', 'date', 'application dates', 'schedule'],
      synonyms: ['deadline', 'last date', 'schedule', 'tentative dates', 'calendar', 'sessions'],
    },
    {
      match: ['eligibility', 'eligible', 'qualification'],
      synonyms: ['criteria', 'qualification', 'minimum marks', '75%', 'pcm', 'pcb', 'aggregate'],
    },
    {
      match: ['stipend', 'scholarship', 'financial assistance'],
      synonyms: ['fellowship', 'assistantship', 'tuition waiver', 'concession', 'financial assistance'],
    },
  ] as Array<{ match: string[]; synonyms: string[] }>,

  // Source routing: soft boost (+0.05) based on query keywords
  ROUTING_RULES: [
    {
      patterns: [/\bbitsat\b/i, /\bonline test\b/i, /\btest center\b/i, /\bmarking\b/i, /\b130 questions\b/i],
      targetFile: 'BITSAT-2026_brochure.pdf',
    },
    {
      patterns: [/\bm\.?e\.?\b/i, /\bm\.?pharm\.?\b/i, /\bhigher degree\b/i, /\bph\.?d\b/i, /\bassistantship\b/i, /\bhd\b/i],
      targetFile: 'HD_Brochure_2025_26.pdf',
    },
    {
      patterns: [/\bfirst degree\b/i, /\bboard topper\b/i, /\bdirect admission\b/i, /\bdual degree\b/i, /\bcampus\b/i, /\bbranch\b/i],
      targetFile: 'Admission_Modality_FD.pdf',
    },
  ],

  SOURCE_PDFS: [
    { name: 'Admission_Modality_FD.pdf', label: 'First Degree Admissions' },
    { name: 'BITSAT-2026_brochure.pdf', label: 'BITSAT-2026 Brochure' },
    { name: 'HD_Brochure_2025_26.pdf', label: 'Higher Degree Admissions' },
  ],

  EXAMPLE_QUESTIONS: [
    'What is the marking scheme for BITSAT-2026?',
    'What is the direct admission policy for Board toppers?',
    'eligibility for BITSAT',
    'What financial assistance is provided for Higher Degree students?',
    'test centers in Delhi',
  ],
};
