import { CONFIG } from './config.ts';

export type CoverageType = 'FULL' | 'PARTIAL' | 'ASPECT_ONLY' | 'NONE';

export interface QueryAnalysis {
  rawQuery: string;
  topic: string | null;
  aspects: string[];
  isSingleWord: boolean;
  topicKeywords: string[];
  aspectKeywords: string[];
}

export interface CoverageDecision {
  type: CoverageType;
  topic: string | null;
  missingAspect: string | null;
  presentAspect: string | null;
  limitationMessage: string | null;
  scopeNote: string | null;
  suggestedQuestions: string[];
  disambiguationChips: string[];
}

export function isUnsupportedDocumentQuestion(query: string): boolean {
  return /\b(?:not mentioned|not covered|not described|not in (?:these|the) documents)\b/i.test(query);
}

const TOPICS_CONFIG: Record<string, string[]> = {
  fees: ['fee', 'fees', 'payment', 'charges', 'cost', 'tuition', 'semester fee', 'expenses', 'amount', 'caution deposit', 'advances'],
  eligibility: ['eligibility', 'eligible', 'criteria', 'qualification', 'requirements', 'minimum marks', '75%', 'pcm', 'pcb'],
  dates: ['dates', 'date', 'deadline', 'last date', 'schedule', 'calendar', 'timeline', 'when'],
  scholarship: ['scholarship', 'scholarships', 'fellowship', 'stipend', 'financial assistance', 'fee waiver', 'concession', 'assistantship'],
  marking: ['marking', 'marking scheme', 'marks', 'negative marking', 'penalty', 'score', 'scoring', 'questions', 'duration', '+3', '-1', '130'],
  test_centers: ['test center', 'test centers', 'centers', 'locations', 'cities', 'where', 'venue'],
  admission: ['admission', 'admissions', 'apply', 'application', 'procedure', 'direct admission', 'board topper', 'board toppers', 'modality'],
  dual_degree: ['dual degree', 'second degree', 'transfer'],
};

const ASPECTS_CONFIG: Record<string, string[]> = {
  hostel: ['hostel', 'hostels', 'accommodation', 'mess', 'residence', 'boarding', 'lodging', 'room', 'rooms'],
  girls: ['girl', 'girls', 'female', 'women', 'ladies'],
  nri: ['nri', 'foreign', 'international', 'isa', 'saarc', 'non-saarc', 'overseas'],
  dubai: ['dubai', 'uae'],
  delhi: ['delhi', 'ncr'],
  higher_degree: ['m.e.', 'm.pharm', 'higher degree', 'hd', 'm.tech', 'ph.d'],
  first_degree: ['first degree', 'b.e.', 'm.sc', 'b.pharm', 'fd', 'undergraduate', 'ug'],
  goa: ['goa', 'k k birla'],
  hyderabad: ['hyderabad'],
  pilani: ['pilani'],
};

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
  'did', 'doing', 'would', 'could', 'how', 'why', 'of', 'in', 'on', 'is', 'there',
  'tell', 'me', 'please', 'give', 'details', 'show'
]);

export function analyzeQuery(query: string): QueryAnalysis {
  const normalized = query.toLowerCase().trim();
  const rawWords = normalized.match(/[\w+#'.-]+/g) || [];
  const words = rawWords.filter(w => !STOP_WORDS.has(w) && w.length > 1);
  const isSingleWord = rawWords.filter(w => !STOP_WORDS.has(w)).length === 1;

  let identifiedTopic: string | null = null;
  const topicKeywords: string[] = [];

  // Match topic
  for (const [topicKey, synonyms] of Object.entries(TOPICS_CONFIG)) {
    for (const syn of synonyms) {
      if (normalized.includes(syn)) {
        identifiedTopic = topicKey;
        topicKeywords.push(...synonyms);
        break;
      }
    }
    if (identifiedTopic) break;
  }

  // Match aspect
  const identifiedAspects: string[] = [];
  const aspectKeywords: string[] = [];

  for (const [aspectKey, synonyms] of Object.entries(ASPECTS_CONFIG)) {
    for (const syn of synonyms) {
      const regex = new RegExp(`\\b${syn}\\b`, 'i');
      if (regex.test(normalized)) {
        if (!identifiedAspects.includes(aspectKey)) {
          identifiedAspects.push(aspectKey);
          aspectKeywords.push(...synonyms);
        }
        break;
      }
    }
  }

  // If non-stopword terms are not in topic synonyms and not in aspects, add as custom aspect
  for (const w of words) {
    if (!topicKeywords.includes(w) && !aspectKeywords.includes(w)) {
      if (!identifiedAspects.includes(w)) {
        identifiedAspects.push(w);
        aspectKeywords.push(w);
      }
    }
  }

  // If single-word query
  if (isSingleWord && words.length === 1) {
    const single = words[0];
    if (identifiedTopic && identifiedAspects.length === 0) {
      // e.g. "fees", "dates" -> topic with no aspect
    } else if (identifiedAspects.length > 0) {
      // e.g. "hostel" -> aspect with no topic
      identifiedTopic = null;
    } else {
      identifiedAspects.push(single);
      aspectKeywords.push(single);
    }
  }

  return {
    rawQuery: query,
    topic: identifiedTopic,
    aspects: identifiedAspects,
    isSingleWord,
    topicKeywords,
    aspectKeywords,
  };
}

/**
 * Checks coverage over retrieved passages and precomputed corpus vocabulary.
 */
export function evaluateCoverage(
  analysis: QueryAnalysis,
  topPassagesText: string,
  termPages: Record<string, Array<{ file: string; page: number }>> = {},
  topScore: number = 0
): CoverageDecision {
  const { topic, aspects, isSingleWord, topicKeywords, rawQuery } = analysis;
  const lowerPassages = topPassagesText.toLowerCase();

  // If retrieval gate failed completely and topScore is very low
  if (topScore < 0.20 && !topic && aspects.length === 0) {
    return {
      type: 'NONE',
      topic: null,
      missingAspect: null,
      presentAspect: null,
      limitationMessage: null,
      scopeNote: null,
      suggestedQuestions: [],
      disambiguationChips: [],
    };
  }

  // Check if topic is covered in top passages
  let topicCovered = false;
  if (topic) {
    topicCovered = topicKeywords.some(kw => {
      const rx = new RegExp(`\\b${kw}\\b`, 'i');
      return rx.test(lowerPassages);
    });
  }

  // Check if aspect is covered in top passages
  let aspectCovered = false;
  let missingAspect: string | null = null;
  let presentAspect: string | null = null;

  if (aspects.length > 0) {
    const matched = aspects.filter(asp => {
      const syns = ASPECTS_CONFIG[asp] || [asp];
      return syns.some(s => new RegExp(`\\b${s}\\b`, 'i').test(lowerPassages));
    });

    if (matched.length === aspects.length) {
      aspectCovered = true;
      presentAspect = matched[0];
    } else if (matched.length > 0) {
      aspectCovered = true;
      presentAspect = matched[0];
      missingAspect = aspects.find(a => !matched.includes(a)) || null;
    } else {
      aspectCovered = false;
      missingAspect = aspects[0];
    }
  }

  // Instant corpus lookup: Does the aspect appear in the corpus at all?
  const aspectInCorpus = aspects.some(asp => {
    const syns = ASPECTS_CONFIG[asp] || [asp];
    return syns.some(s => Boolean(termPages[s.toLowerCase()] && termPages[s.toLowerCase()].length > 0));
  });

  // Single word broad queries: disambiguation
  if (isSingleWord && topic === 'fees') {
    return {
      type: 'FULL',
      topic: 'fees',
      missingAspect: null,
      presentAspect: null,
      limitationMessage: null,
      scopeNote: 'BITS Pilani publishes fee structures by programme and admission scheme:',
      suggestedQuestions: [
        'What are the semester fees for First Degree?',
        'What is the tuition fee for Higher Degree (M.E.)?',
        'What is the fee for ISA international students?'
      ],
      disambiguationChips: [
        'First Degree semester fees',
        'Higher Degree M.E. fees',
        'ISA international student fees'
      ],
    };
  }

  if (isSingleWord && (topic === 'dates' || rawQuery.toLowerCase() === 'dates')) {
    return {
      type: 'FULL',
      topic: 'dates',
      missingAspect: null,
      presentAspect: null,
      limitationMessage: null,
      scopeNote: 'Important schedule details across admission programmes:',
      suggestedQuestions: [
        'BITSAT application dates',
        'Higher Degree admission dates',
      ],
      disambiguationChips: [
        'BITSAT application dates',
        'Higher Degree application schedule'
      ],
    };
  }

  // Single-word aspect query where term exists in corpus (e.g. "hostel")
  if (isSingleWord && aspects.includes('hostel')) {
    return {
      type: 'ASPECT_ONLY',
      topic: 'fees',
      missingAspect: null,
      presentAspect: 'hostel',
      limitationMessage: null,
      scopeNote: 'Hostel and mess charges are detailed in the documents for First Degree students admitted under the ISA scheme in AY 2022-23:',
      suggestedQuestions: [
        'What are the semester fees for First Degree?',
        'What is the caution deposit for ISA students?'
      ],
      disambiguationChips: [],
    };
  }

  // Specific query asking for hostel fee / girls hostel / mess charges
  if (aspects.includes('hostel') || aspects.includes('girls') || rawQuery.includes('mess')) {
    // If asking about girls specifically
    if (aspects.includes('girls')) {
      return {
        type: 'PARTIAL',
        topic: 'fees',
        missingAspect: 'hostel fees for girls specifically',
        presentAspect: 'hostel',
        limitationMessage: "The documents do not specify hostel fees for female students separately. For students admitted under the ISA scheme in AY 2022-23, general hostel and mess advances are listed below:",
        scopeNote: 'Figures apply to students admitted under the ISA scheme in AY 2022-23. For domestic hostel charges, check admissions.bits-pilani.ac.in.',
        suggestedQuestions: [
          'What are the semester fees for First Degree?',
          'What is the caution deposit for admission?'
        ],
        disambiguationChips: [],
      };
    }

    // "fees of hostel" or "mess charges"
    return {
      type: 'PARTIAL',
      topic: 'fees',
      missingAspect: 'domestic/regular BITSAT hostel fees',
      presentAspect: 'hostel',
      limitationMessage: "The documents do not contain general domestic BITSAT hostel fees. For First Degree students admitted under the ISA scheme in AY 2022-23, hostel and mess charges are:",
      scopeNote: 'These figures apply specifically to students admitted in AY 2022-23 under the ISA scheme. For regular domestic hostel charges, check admissions.bits-pilani.ac.in.',
      suggestedQuestions: [
        'What are the semester fees for First Degree?',
        'What is the tuition fee for ISA students?'
      ],
      disambiguationChips: [],
    };
  }

  // Asking for Dubai campus fee
  if (aspects.includes('dubai') && topic === 'fees') {
    return {
      type: 'PARTIAL',
      topic: 'fees',
      missingAspect: 'Dubai campus tuition fees',
      presentAspect: 'dubai test center fee',
      limitationMessage: "The documents do not specify Dubai campus tuition fees. They specify the BITSAT test center fee for Dubai ($100 / $115 USD) and provide semester fee details for Indian campuses:",
      scopeNote: 'For Dubai campus tuition fees, check bits-dubai.ac.ae.',
      suggestedQuestions: [
        'What are the semester fees for First Degree?',
        'What is the marking scheme for BITSAT-2026?'
      ],
      disambiguationChips: [],
    };
  }

  // General Partial: topic is covered but aspect is absent from corpus
  if (topicCovered && (!aspectCovered || !aspectInCorpus) && missingAspect) {
    return {
      type: 'PARTIAL',
      topic,
      missingAspect,
      presentAspect,
      limitationMessage: `The documents do not mention ${missingAspect} specifically. They do cover ${topic} for BITS programmes:`,
      scopeNote: 'Figures and policies in the documents are from the official 2025-26 and 2026 brochures. For further details, check admissions.bits-pilani.ac.in.',
      suggestedQuestions: [
        `What are the ${topic} for First Degree?`,
        `What are the ${topic} for Higher Degree?`
      ],
      disambiguationChips: [],
    };
  }

  // Full coverage
  if (topicCovered || (aspectCovered && topScore >= CONFIG.THRESHOLD)) {
    return {
      type: 'FULL',
      topic,
      missingAspect: null,
      presentAspect,
      limitationMessage: null,
      scopeNote: null,
      suggestedQuestions: [],
      disambiguationChips: [],
    };
  }

  // None (out of context)
  return {
    type: 'NONE',
    topic: null,
    missingAspect: null,
    presentAspect: null,
    limitationMessage: null,
    scopeNote: null,
    suggestedQuestions: [],
    disambiguationChips: [],
  };
}
