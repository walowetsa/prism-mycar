/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

// Types (keeping existing types)
interface CallRecord {
  id: string;
  agent_username?: string;
  queue_name?: string;
  call_duration?: any;
  disposition_title?: string;
  primary_category?: string;
  initiation_timestamp?: string;
  total_hold_time?: any;
  transcript_text?: string;
  [key: string]: any;
}

interface ProcessedMetrics {
  totalCalls: number;
  avgCallDuration: number;
  avgHoldTime: number;
  dispositionBreakdown: Record<string, { count: number; percentage: number }>;
  sentimentBreakdown: Record<string, { count: number; percentage: number }>;
  agentMetrics: Record<string, {
    totalCalls: number;
    avgDuration: number;
    avgHoldTime: number;
    topDispositions: string[];
    sentimentScore: number;
  }>;
  queueMetrics: Record<string, {
    totalCalls: number;
    avgDuration: number;
    avgWaitTime: number;
    topDispositions: string[];
  }>;
  timePatterns: {
    hourlyDistribution: Record<string, number>;
    dailyTrends: Record<string, number>;
  };
  performanceIndicators: {
    callsOver15Min: number;
    callsUnder2Min: number;
    abandonmentRate: number;
    firstCallResolution: number;
  };
}

interface TranscriptSample {
  id: string;
  agent: string;
  disposition: string;
  sentiment: string;
  excerpt: string;
  relevanceScore: number;
  duration: number;
}

interface KeywordSearchResult {
  totalMatches: number;
  searchTerms: string[];
  expandedTerms: string[]; // NEW: Show what variations were searched
  matchingRecords: Array<{
    id: string;
    agent: string;
    disposition: string;
    sentiment: string;
    duration: number;
    matchingSnippets: string[];
    matchCount: number;
    matchedVariations: string[]; // NEW: Show which variations matched
  }>;
  searchStats: {
    totalRecordsSearched: number;
    recordsWithTranscripts: number;
    matchPercentage: number;
  };
}

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Rate limiting and retry configuration
const RATE_LIMIT_CONFIG = {
  maxRetries: 5,
  baseDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2,
};

// NEW: Specific tire sizes to search for when tire stock queries are detected
const COMMON_TIRE_SIZES = [
  "195/65R15",
  "205/55R16",
  "215/60R16", 
  "215/55R17",
  "225/45R17",
  "195/60R14", 
  "255/45R19", 
  "245/40R20", 
  "285/35R20", 
  "195/65/15",
  "205/55/16",
  "215/60/16", 
  "215/55/17",
  "225/45/17",
  "195/60/14", 
  "245/40/20", 
  "285/35/20"   
];

// NEW: Enhanced call center and automotive synonyms for better matching
const CALL_CENTER_SYNONYMS: Record<string, string[]> = {
  'angry': ['mad', 'upset', 'furious', 'irritated', 'frustrated', 'annoyed', 'irate'],
  'happy': ['pleased', 'satisfied', 'content', 'glad', 'delighted', 'thrilled'],
  'problem': ['issue', 'trouble', 'difficulty', 'concern', 'matter', 'fault', 'defect'],
  'refund': ['return', 'reimbursement', 'money back', 'credit', 'chargeback'],
  'cancel': ['terminate', 'end', 'stop', 'discontinue', 'abort'],
  'billing': ['payment', 'invoice', 'charge', 'fee', 'cost', 'bill'],
  'account': ['profile', 'membership', 'subscription', 'login'],
  'service': ['support', 'help', 'assistance', 'repair', 'maintenance'],
  'product': ['item', 'merchandise', 'goods', 'part', 'component'],
  'delivery': ['shipping', 'shipment', 'sent', 'mail', 'transport'],
  'urgent': ['emergency', 'critical', 'important', 'rush', 'asap'],
  'waiting': ['hold', 'queue', 'pending', 'delay', 'wait'],
  // Automotive specific synonyms
  'alignment': ['align', 'aligned', 'balancing', 'adjustment', 'calibration'],
  'wheel': ['tire', 'rim', 'hub', 'wheels'],
  'brake': ['brakes', 'braking', 'stop', 'stopping'],
  'engine': ['motor', 'powerplant', 'drivetrain'],
  'oil': ['lubricant', 'fluid', 'lube'],
  'tire': ['tyre', 'wheel', 'rubber'],
  'repair': ['fix', 'service', 'maintenance', 'work'],
  'quote': ['estimate', 'price', 'cost', 'pricing'],
  'warranty': ['guarantee', 'coverage', 'protection'],
  'appointment': ['booking', 'schedule', 'reservation', 'slot'],
  // NEW: Tire and stock related terms
  'stock': ['inventory', 'availability', 'available', 'supply', 'in stock', 'out of stock'],
  'size': ['sizes', 'dimension', 'dimensions', 'specification', 'specs'],
  'common': ['popular', 'frequent', 'usual', 'typical', 'standard'],
  'unavailable': ['out of stock', 'not available', 'sold out', 'backordered', 'no stock'],
  // NEW: Mobile tyre fitting synonyms
  'mobile': ['mobile tyre', 'mobile tire', 'mobile service', 'on-site', 'home service', 'mobile fitting'],
  'fitting': ['installation', 'mounting', 'changing', 'replacing', 'fit'],
  'appointment': ['booking', 'schedule', 'reservation', 'slot', 'visit'],
};

// NEW: Function to detect Mobile Tyre Fitting (MTF) queries
const detectMTFQuery = (query: string): boolean => {
  const lowerQuery = query.toLowerCase();
  
  // Patterns that indicate MTF-related queries
  const mtfPatterns = [
    /mobile\s*(tyre|tire)\s*fitting/i,
    /mobile\s*(tyre|tire)\s*service/i,
    /mobile\s*(tyre|tire)\s*appointment/i,
    /mobile\s*(tyre|tire)\s*booking/i,
    /mtf\s*appointment/i,
    /mtf\s*booking/i,
    /mtf\s*service/i,
    /mobile.*fitting.*appointment/i,
    /mobile.*service.*appointment/i,
    /on.?site.*tyre/i,
    /on.?site.*tire/i,
    /home.*tyre.*service/i,
    /home.*tire.*service/i,
    /mobile.*tyre.*installation/i,
    /mobile.*tire.*installation/i,
  ];
  
  return mtfPatterns.some(pattern => pattern.test(query));
};

// NEW: Function to detect tire size queries and extract tire size patterns
const detectTireSizeQuery = (query: string): { isTireQuery: boolean; detectedSizes: string[] } => {
  // const lowerQuery = query.toLowerCase();
  
  // Patterns that indicate tire size queries
  const tireSizePatterns = [
    /tyre?\s*size/i,
    /tire?\s*size/i,
    /stock.*tyre/i,
    /stock.*tire/i,
    /out\s*of\s*stock.*tyre/i,
    /out\s*of\s*stock.*tire/i,
    /unavailable.*tyre/i,
    /unavailable.*tire/i,
    /common.*tyre.*size/i,
    /common.*tire.*size/i,
    /popular.*tyre/i,
    /popular.*tire/i,
    /\d{3}\/\d{2}R?\d{2}/i, // Direct tire size pattern like 195/65R15
  ];
  
  const isTireQuery = tireSizePatterns.some(pattern => pattern.test(query));
  
  // Extract any tire sizes mentioned in the query
  const tireSizeRegex = /\b\d{3}\/\d{2}R?\d{2}\b/gi;
  const detectedSizes = query.match(tireSizeRegex) || [];
  
  return { isTireQuery, detectedSizes };
};

// NEW: Enhanced word expansion function with phrase decomposition and tire size handling
const expandKeyword = (keyword: string): string[] => {
  const variations = new Set<string>();
  const lower = keyword.toLowerCase().trim();
  
  // Add the original term
  variations.add(lower);
  
  // Check if this is a tire size pattern
  const tireSizePattern = /^\d{3}\/\d{2}R?\d{2}$/i;
  if (tireSizePattern.test(keyword)) {
    // For tire sizes, add variations with and without 'R'
    variations.add(keyword); // Original
    variations.add(keyword.toLowerCase());
    variations.add(keyword.toUpperCase());
    
    // Add version without R if it has R
    if (keyword.includes('R') || keyword.includes('r')) {
      const withoutR = keyword.replace(/r/gi, '');
      variations.add(withoutR);
      variations.add(withoutR.toLowerCase());
      variations.add(withoutR.toUpperCase());
    } else {
      // Add version with R if it doesn't have R
      const parts = keyword.match(/(\d{3}\/\d{2})(\d{2})/);
      if (parts) {
        const withR = `${parts[1]}R${parts[2]}`;
        variations.add(withR);
        variations.add(withR.toLowerCase());
        variations.add(withR.toUpperCase());
      }
    }
    
    return Array.from(variations);
  }
  
  // PHRASE DECOMPOSITION: If this is a multi-word phrase, break it down
  if (lower.includes(' ')) {
    const words = lower.split(/\s+/).filter(word => word.length > 1);
    
    // Add each individual word from the phrase
    words.forEach(word => {
      if (word.length > 2) {
        // Add the individual word and all its variations
        const wordVariations = expandSingleWord(word);
        wordVariations.forEach(variation => variations.add(variation));
      }
    });
    
    // Add different phrase combinations
    variations.add(words.join('-')); // hyphenated version
    variations.add(words.join('')); // concatenated version
    
    // Add partial phrases (for 3+ word phrases)
    if (words.length >= 3) {
      for (let i = 0; i < words.length - 1; i++) {
        variations.add(words.slice(i, i + 2).join(' '));
      }
    }
  } else {
    // For single words, apply all variations
    const singleWordVariations = expandSingleWord(lower);
    singleWordVariations.forEach(variation => variations.add(variation));
  }
  
  // Filter out very short or empty variations
  return Array.from(variations).filter(v => v.length > 1);
};

// NEW: Helper function to expand a single word with all variations
const expandSingleWord = (word: string): string[] => {
  const variations = new Set<string>();
  const lower = word.toLowerCase().trim();
  
  // Add the original word
  variations.add(lower);
  
  // Handle plurals and singulars
  if (lower.endsWith('s') && lower.length > 3) {
    // Remove 's' for potential singular
    variations.add(lower.slice(0, -1));
    
    // Handle 'ies' -> 'y'
    if (lower.endsWith('ies') && lower.length > 4) {
      variations.add(lower.slice(0, -3) + 'y');
    }
    
    // Handle 'es' -> remove 'es'
    if (lower.endsWith('es') && lower.length > 3) {
      variations.add(lower.slice(0, -2));
    }
  } else {
    // Add plural forms
    variations.add(lower + 's');
    variations.add(lower + 'es');
    
    // Handle 'y' -> 'ies'
    if (lower.endsWith('y') && lower.length > 2) {
      variations.add(lower.slice(0, -1) + 'ies');
    }
  }
  
  // Handle verb forms
  if (!lower.endsWith('ing')) {
    variations.add(lower + 'ing');
  }
  if (!lower.endsWith('ed')) {
    variations.add(lower + 'ed');
  }
  if (!lower.endsWith('er')) {
    variations.add(lower + 'er');
  }
  if (!lower.endsWith('est')) {
    variations.add(lower + 'est');
  }
  
  // Handle common suffixes removal
  const suffixes = ['ing', 'ed', 'er', 'est', 'ly', 'tion', 'sion', 'ness', 'ment'];
  suffixes.forEach(suffix => {
    if (lower.endsWith(suffix) && lower.length > suffix.length + 2) {
      variations.add(lower.slice(0, -suffix.length));
    }
  });
  
  // Add synonyms if available
  if (CALL_CENTER_SYNONYMS[lower]) {
    CALL_CENTER_SYNONYMS[lower].forEach(synonym => {
      variations.add(synonym);
      // Also add plural forms of synonyms
      variations.add(synonym + 's');
      variations.add(synonym + 'es');
    });
  }
  
  // Add variations for compound words (hyphenated)
  if (lower.includes('-')) {
    const parts = lower.split('-');
    parts.forEach(part => {
      if (part.trim().length > 1) {
        variations.add(part.trim());
      }
    });
    variations.add(parts.join(' '));
    variations.add(parts.join(''));
  }
  
  return Array.from(variations).filter(v => v.length > 1);
};

// NEW: Fuzzy matching function for handling typos
const createFuzzyRegex = (term: string): RegExp => {
  // For tire sizes, use exact matching
  const tireSizePattern = /^\d{3}\/\d{2}R?\d{2}$/i;
  if (tireSizePattern.test(term)) {
    return new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
  }
  
  // For short terms, use exact matching
  if (term.length <= 3) {
    return new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
  }
  
  // For longer terms, allow for 1 character difference
  const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  
  // Create pattern that allows for:
  // 1. Exact match
  // 2. One character substitution
  // 3. One character insertion or deletion
  const patterns = [
    `\\b${escapedTerm}\\b`, // Exact match
    `\\b${escapedTerm.split('').join('.?')}\\b`, // Allow character insertions
  ];
  
  return new RegExp(`(${patterns.join('|')})`, 'gi');
};

// Helper functions (keeping existing ones)
const extractNumericValue = (value: any): number => {
  if (!value) return 0;
  
  try {
    let parsedDuration: { minutes?: number; seconds: number };
    
    if (typeof value === "string") {
      parsedDuration = JSON.parse(value);
    } else if (typeof value === "object") {
      parsedDuration = value;
    } else if (typeof value === "number") {
      return value;
    } else {
      return 0;
    }

    const { seconds, minutes = 0 } = parsedDuration;

    if (typeof seconds !== "number" || seconds < 0) {
      return 0;
    }

    if (minutes !== undefined && (typeof minutes !== "number" || minutes < 0)) {
      return 0;
    }

    return minutes * 60 + seconds;
  } catch {
    if (typeof value === 'string') {
      const parsed = parseFloat(value);
      return isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  }
};

const extractSentiment = (sentimentAnalysis: any): string => {
  if (!sentimentAnalysis) return 'Unknown';
  if (Array.isArray(sentimentAnalysis) && sentimentAnalysis.length > 0) {
    return sentimentAnalysis[0].sentiment || 'Unknown';
  }
  if (typeof sentimentAnalysis === 'string') return sentimentAnalysis;
  if (typeof sentimentAnalysis === 'object' && sentimentAnalysis.sentiment) {
    return sentimentAnalysis.sentiment;
  }
  return 'Unknown';
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Enhanced query detection with tire size support and MTF detection
const detectQueryType = (query: string): { 
  type: string; 
  isKeywordSearch: boolean; 
  extractedKeywords: string[];
  isTireQuery: boolean;
  isMTFQuery: boolean; // NEW: MTF query detection
} => {
  const lowerQuery = query.toLowerCase();
  
  // Check for MTF queries first
  const isMTFQuery = detectMTFQuery(query);
  
  // Check for tire size queries
  const tireDetection = detectTireSizeQuery(query);
  const isTireQuery = tireDetection.isTireQuery;
  
  // Keyword search detection patterns
  const keywordSearchPatterns = [
    /how many.*calls?.*contain/i,
    /how many.*calls?.*mention/i,
    /how many.*calls?.*include/i,
    /how many.*calls?.*about/i,
    /count.*calls?.*contain/i,
    /count.*calls?.*mention/i,
    /count.*calls?.*with/i,
    /search.*for/i,
    /find.*calls?.*with/i,
    /calls?.*about/i,
    /calls?.*regarding/i,
    /calls?.*discussing/i,
    /".*"/,  // Quoted phrases
    /\b\w+\s+\w+\b.*offer/i, // Product/service offers
    /\b\w+\s+\w+\b.*issue/i, // Specific issues
    /\b\w+\s+\w+\b.*problem/i, // Problems
    // NEW: Tire-specific patterns
    /tyre?\s*size/i,
    /tire?\s*size/i,
    /stock.*tyre/i,
    /stock.*tire/i,
    /out\s*of\s*stock/i,
    /unavailable.*tyre/i,
    /unavailable.*tire/i,
    /common.*tyre/i,
    /common.*tire/i,
    // NEW: MTF-specific patterns
    /mobile.*tyre.*fitting/i,
    /mobile.*tire.*fitting/i,
    /mobile.*service/i,
    /mtf/i,
    /reasons.*not.*getting/i,
    /why.*not.*getting/i,
    /problems.*with.*appointment/i,
  ];

  const isKeywordSearch = keywordSearchPatterns.some(pattern => pattern.test(query)) || isTireQuery || isMTFQuery;
  
  let extractedKeywords: string[] = [];
  if (isKeywordSearch) {
    if (isTireQuery) {
      // For tire queries, use the predefined tire sizes plus any keywords from the query
      extractedKeywords = [...COMMON_TIRE_SIZES, ...tireDetection.detectedSizes];
      // Add some general tire/stock related terms
      const generalTireTerms = extractKeywordsFromQuery(query).filter(keyword => 
        !COMMON_TIRE_SIZES.includes(keyword)
      );
      extractedKeywords = [...extractedKeywords, ...generalTireTerms];
    } else if (isMTFQuery) {
      // For MTF queries, extract relevant keywords but analysis will be limited to MTF calls
      extractedKeywords = extractKeywordsFromQuery(query);
    } else {
      extractedKeywords = extractKeywordsFromQuery(query);
    }
  }

  // Determine base query type
  let type = 'general';
  if (isMTFQuery) {
    type = 'mtf_analysis'; // NEW: MTF analysis type
  } else if (isTireQuery) {
    type = 'tire_size_search';
  } else if (isKeywordSearch) {
    type = 'keyword_search';
  } else if (lowerQuery.includes('disposition') || lowerQuery.includes('outcome')) {
    type = 'disposition';
  } else if (lowerQuery.includes('sentiment') || lowerQuery.includes('satisfaction')) {
    type = 'sentiment';
  } else if (lowerQuery.includes('agent') || lowerQuery.includes('performance')) {
    type = 'agent_performance';
  } else if (lowerQuery.includes('time') || lowerQuery.includes('duration')) {
    type = 'timing';
  } else if (lowerQuery.includes('queue') || lowerQuery.includes('department')) {
    type = 'queue_analysis';
  } else if (lowerQuery.includes('summary') || lowerQuery.includes('overview')) {
    type = 'summary';
  } else if (lowerQuery.includes('trend') || lowerQuery.includes('pattern')) {
    type = 'trends';
  }

  return { type, isKeywordSearch, extractedKeywords, isTireQuery, isMTFQuery };
};

// ENHANCED: Much better phrase decomposition with separate individual word search terms
const extractKeywordsFromQuery = (query: string): string[] => {
  const keywords: string[] = [];
  const processedTerms = new Set<string>(); // Track to avoid duplicates
  
  // Extract quoted phrases first (these are high priority)
  const quotedPhrases = query.match(/"([^"]+)"/g);
  if (quotedPhrases) {
    quotedPhrases.forEach(phrase => {
      const cleaned = phrase.replace(/"/g, '').trim();
      if (cleaned.length > 0) {
        // Add the complete phrase as a search term
        keywords.push(cleaned);
        processedTerms.add(cleaned.toLowerCase());
        
        // EXPLICITLY ADD EACH WORD FROM QUOTED PHRASES AS SEPARATE SEARCH TERMS
        const phraseWords = cleaned.split(/\s+/).filter(word => word.length > 2);
        phraseWords.forEach(word => {
          const lowerWord = word.toLowerCase();
          if (!processedTerms.has(lowerWord) && 
              (word.length > 3 || ['fee', 'pay', 'buy', 'new', 'old', 'bad', 'mad', 'oil', 'gas', 'air'].includes(lowerWord))) {
            keywords.push(word); // Add as separate search term
            processedTerms.add(lowerWord);
          }
        });
      }
    });
  }
  
  // Remove quoted phrases from query for further processing
  let cleanQuery = query.replace(/"[^"]+"/g, '');
  
  // Remove common query words
  cleanQuery = cleanQuery
    .toLowerCase()
    .replace(/\b(how many|count|find|search|show me|what|where|when|calls?|records?|included?|contain|mentioned?|about|with|have|were|that|this|they|them|from|call|and|or|the|a|an|is|are|was|be|been|being|for|offer|offers|offered|reasons|why|not|getting|problems)\b/gi, '')
    .replace(/[^\w\s]/g, ' ')
    .trim();
  
  // Extract significant words and phrases
  const words = cleanQuery.split(/\s+/).filter(word => word.length > 2);
  
  // IMPROVED: Extract meaningful phrases (2-3 consecutive words) as SEPARATE search terms
  for (let i = 0; i < words.length - 1; i++) {
    const phrase2 = words.slice(i, i + 2).join(' ');
    const phrase3 = words.slice(i, i + 3).join(' ');
    
    // Add 2-word phrases if they seem meaningful and automotive/service related
    if (phrase2.length > 5 && !processedTerms.has(phrase2.toLowerCase())) {
      const isAutomotivePhrase = /\b(wheel|tire|tyre|brake|oil|engine|alignment|service|repair|quote|warranty|appointment|battery|transmission|filter|fluid|stock|size|mobile|fitting)\b/i.test(phrase2);
      const isServicePhrase = /\b(customer|billing|account|refund|cancel|support|help|delivery|payment|schedule)\b/i.test(phrase2);
      
      if (isAutomotivePhrase || isServicePhrase || phrase2.split(' ').every(w => w.length > 4)) {
        keywords.push(phrase2); // Add phrase as separate search term
        processedTerms.add(phrase2.toLowerCase());
        
        // ALSO ADD INDIVIDUAL WORDS from the phrase as separate search terms
        const phrase2Words = words.slice(i, i + 2);
        phrase2Words.forEach(word => {
          const lowerWord = word.toLowerCase();
          if (!processedTerms.has(lowerWord) && word.length > 2) {
            keywords.push(word); // Add as separate search term
            processedTerms.add(lowerWord);
          }
        });
      }
    }
    
    // Add 3-word phrases if they seem very meaningful
    if (i < words.length - 2 && phrase3.length > 10 && phrase3.length < 30 && !processedTerms.has(phrase3.toLowerCase())) {
      const isAutomotivePhrase = /\b(wheel|tire|tyre|brake|oil|engine|alignment|service|repair|quote|warranty|appointment|battery|transmission|filter|fluid|stock|size|mobile|fitting)\b/i.test(phrase3);
      
      if (isAutomotivePhrase) {
        keywords.push(phrase3); // Add phrase as separate search term  
        processedTerms.add(phrase3.toLowerCase());
        
        // ALSO ADD INDIVIDUAL WORDS from the phrase as separate search terms
        const phrase3Words = words.slice(i, i + 3);
        phrase3Words.forEach(word => {
          const lowerWord = word.toLowerCase();
          if (!processedTerms.has(lowerWord) && word.length > 2) {
            keywords.push(word); // Add as separate search term
            processedTerms.add(lowerWord);
          }
        });
      }
    }
  }
  
  // Add individual significant words that weren't already processed in phrases
  words.forEach(word => {
    const lowerWord = word.toLowerCase();
    if (!processedTerms.has(lowerWord) && 
        (word.length > 3 || ['fee', 'pay', 'buy', 'new', 'old', 'bad', 'mad', 'oil', 'gas', 'air', 'tire', 'tyre', 'mtf'].includes(lowerWord))) {
      keywords.push(word);
      processedTerms.add(lowerWord);
    }
  });
  
  // Remove duplicates and limit to most relevant terms
  const uniqueKeywords = [...new Set(keywords)];
  
  // Prioritize: quoted phrases first, then multi-word phrases, then individual words
  return uniqueKeywords
    .sort((a, b) => {
      // Quoted phrases (from original query) get highest priority
      if (quotedPhrases?.some(p => p.includes(a)) && !quotedPhrases?.some(p => p.includes(b))) return -1;
      if (quotedPhrases?.some(p => p.includes(b)) && !quotedPhrases?.some(p => p.includes(a))) return 1;
      
      // Multi-word phrases get priority over single words
      const aWordCount = a.split(' ').length;
      const bWordCount = b.split(' ').length;
      if (aWordCount !== bWordCount) {
        return bWordCount - aWordCount;
      }
      
      // Then by length
      return b.length - a.length;
    })
    .slice(0, 15); // Increased limit to accommodate phrase decomposition
};

// ENHANCED: Much more sophisticated keyword search with individual word counting and tire size support
const performKeywordSearch = (
  records: CallRecord[],
  searchTerms: string[]
): KeywordSearchResult => {
  console.log(`🔍 Performing ENHANCED keyword search for: ${searchTerms.join(', ')}`);
  
  // Expand all search terms to include variations (each term is expanded individually)
  const allExpandedTerms = new Map<string, string[]>();
  const allVariations = new Set<string>();
  
  searchTerms.forEach(term => {
    const expanded = expandKeyword(term);
    allExpandedTerms.set(term, expanded);
    expanded.forEach(variation => allVariations.add(variation));
  });
  
  console.log(`📈 Expanded ${searchTerms.length} search terms to ${allVariations.size} total variations:`);
  console.log(`   Search terms: ${searchTerms.join(', ')}`);
  console.log(`   All variations: ${Array.from(allVariations).slice(0, 20).join(', ')}${allVariations.size > 20 ? '...' : ''}`);
  
  const recordsWithTranscripts = records.filter(record => 
    record.transcript_text && record.transcript_text.trim().length
  );
  
  console.log(`📊 Total records: ${records.length}, Records with transcripts: ${recordsWithTranscripts.length}`);
  
  const matchingRecords: KeywordSearchResult['matchingRecords'] = [];
  let totalMatches = 0;
  
  recordsWithTranscripts.forEach(record => {
    const transcript = record.transcript_text?.toLowerCase() || '';
    const matchingSnippets: string[] = [];
    const matchedVariations: string[] = [];
    let recordMatchCount = 0;
    
    // Check each original search term and its variations
    searchTerms.forEach(originalTerm => {
      const variations = allExpandedTerms.get(originalTerm) || [originalTerm];
      
      variations.forEach(variation => {
        // Use different matching strategies based on term length and type
        let regex: RegExp;
        
        if (variation.includes(' ')) {
          // For phrases, use exact phrase matching with some flexibility
          const phraseWords = variation.split(' ');
          const flexiblePhrase = phraseWords.join('\\s+(?:\\w+\\s+){0,2}'); // Allow 0-2 words between
          regex = new RegExp(`\\b${flexiblePhrase}\\b`, 'gi');
        } else if (variation.length <= 3) {
          // For short terms, use exact word boundary matching
          regex = new RegExp(`\\b${variation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
        } else {
          // For longer terms, use fuzzy matching
          regex = createFuzzyRegex(variation);
        }
        
        const matches = transcript.match(regex);
        
        if (matches) {
          const matchCount = matches.length;
          recordMatchCount += matchCount;
          
          if (!matchedVariations.includes(variation)) {
            matchedVariations.push(variation);
          }
          
          // Extract context snippets around matches
          let lastIndex = 0;
          const snippetRegex = new RegExp(regex.source, 'gi');
          let match;
          
          while ((match = snippetRegex.exec(transcript)) !== null && matchingSnippets.length < 4) {
            const matchStart = Math.max(0, match.index - 60);
            const matchEnd = Math.min(transcript.length, match.index + match[0].length + 60);
            const snippet = transcript.substring(matchStart, matchEnd).trim();
            
            if (snippet.length > 15 && !matchingSnippets.some(existing => existing.includes(snippet.substring(10, 30)))) {
              const highlightedSnippet = snippet.replace(
                new RegExp(`(${match[0]})`, 'gi'),
                '**$1**'
              );
              matchingSnippets.push(`...${highlightedSnippet}...`);
            }
            
            if (snippetRegex.lastIndex === lastIndex) break;
            lastIndex = snippetRegex.lastIndex;
          }
        }
      });
    });
    
    if (recordMatchCount > 0) {
      totalMatches += recordMatchCount;
      matchingRecords.push({
        id: record.id,
        agent: record.agent_username || 'Unknown',
        disposition: record.disposition_title || 'Unknown',
        sentiment: extractSentiment(record.sentiment_analysis),
        duration: extractNumericValue(record.call_duration),
        matchingSnippets: matchingSnippets.slice(0, 3), // Limit snippets
        matchCount: recordMatchCount,
        matchedVariations: matchedVariations,
      });
    }
  });
  
  // Sort by relevance (match count, then by number of different variations matched)
  matchingRecords.sort((a, b) => {
    if (b.matchCount !== a.matchCount) {
      return b.matchCount - a.matchCount;
    }
    return b.matchedVariations.length - a.matchedVariations.length;
  });
  
  const result: KeywordSearchResult = {
    totalMatches,
    searchTerms,
    expandedTerms: Array.from(allVariations),
    matchingRecords: matchingRecords,
    searchStats: {
      totalRecordsSearched: records.length,
      recordsWithTranscripts: recordsWithTranscripts.length,
      matchPercentage: recordsWithTranscripts.length > 0 ? 
        (matchingRecords.length / recordsWithTranscripts.length) * 100 : 0
    }
  };
  
  console.log(`✅ Enhanced keyword search complete:`);
  console.log(`   - Original search terms: ${searchTerms.length}`);
  console.log(`   - Expanded variations: ${allVariations.size}`);
  console.log(`   - Total matches found: ${totalMatches}`);
  console.log(`   - Records with matches: ${matchingRecords.length}`);
  console.log(`   - Match percentage: ${result.searchStats.matchPercentage.toFixed(1)}%`);
  
  return result;
};

// Smart transcript selection (updated to handle enhanced keyword search, tire queries, and MTF queries)
const selectRelevantTranscripts = (
  records: CallRecord[],
  queryType: string,
  query: string,
  maxTranscripts: number = 3
): TranscriptSample[] => {
  console.log(`🔍 Transcript Selection Debug:`);
  console.log(`Total records received: ${records.length}`);
  
  const recordsWithTranscripts = records.filter(record => record.transcript_text);
  const recordsWithLongTranscripts = records.filter(record => 
    record.transcript_text && 
    record.transcript_text.trim().length > 50
  );
  
  console.log(`Records with transcript_text: ${recordsWithTranscripts.length}`);
  console.log(`Records with transcript_text >50 chars: ${recordsWithLongTranscripts.length}`);
  
  const availableTranscripts = records.filter(record => 
    record.transcript_text
  );

  console.log(`Available transcripts after filtering: ${availableTranscripts.length}`);

  if (availableTranscripts.length === 0) {
    console.log(`⚠️ No transcripts available for analysis`);
    return [];
  }

  const queryLower = query.toLowerCase();
  const queryKeywords = queryLower.split(' ').filter(word => word.length > 3);

  const scoredTranscripts = availableTranscripts.map(record => {
    const transcript = record.transcript_text || '';
    const transcriptLower = transcript.toLowerCase();
    let relevanceScore = 0;

    queryKeywords.forEach(keyword => {
      const matches = (transcriptLower.match(new RegExp(keyword, 'g')) || []).length;
      relevanceScore += matches * 2;
    });

    // Enhanced scoring for keyword searches using the new expansion
    if (queryType === 'keyword_search' || queryType === 'tire_size_search' || queryType === 'mtf_analysis') {
      const searchTerms = extractKeywordsFromQuery(query);
      
      // For tire queries, add the common tire sizes to search terms
      if (queryType === 'tire_size_search') {
        searchTerms.push(...COMMON_TIRE_SIZES);
      }
      
      // For MTF queries, add mobile service related terms
      if (queryType === 'mtf_analysis') {
        searchTerms.push('mobile', 'fitting', 'appointment', 'booking', 'service', 'mtf');
      }
      
      searchTerms.forEach(term => {
        const expandedTerms = expandKeyword(term);
        expandedTerms.forEach(expandedTerm => {
          const regex = new RegExp(`\\b${expandedTerm.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
          const matches = (transcriptLower.match(regex) || []).length;
          relevanceScore += matches * (expandedTerm === term ? 10 : 5); // Original terms get higher weight
        });
      });
    }

    const sentiment = extractSentiment(record.sentiment_analysis);
    if (sentiment === 'Negative') relevanceScore += 1;
    if (sentiment === 'Positive') relevanceScore += 1;
    
    return {
      id: record.id,
      agent: record.agent_username || 'Unknown',
      disposition: record.disposition_title || 'Unknown',
      sentiment,
      excerpt: truncateTranscript(transcript, 400),
      relevanceScore,
      duration: extractNumericValue(record.call_duration),
      fullRecord: record
    };
  });

  const sortedTranscripts = scoredTranscripts
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, maxTranscripts * 2);

  const selected: TranscriptSample[] = [];
  const usedAgents = new Set<string>();
  const usedDispositions = new Set<string>();
  const usedSentiments = new Set<string>();

  for (const transcript of sortedTranscripts) {
    if (selected.length >= maxTranscripts) break;
    
    const diversityBonus = 
      (!usedAgents.has(transcript.agent) ? 1 : 0) +
      (!usedDispositions.has(transcript.disposition) ? 1 : 0) +
      (!usedSentiments.has(transcript.sentiment) ? 1 : 0);
    
    if (diversityBonus > 0 || selected.length === 0 || transcript.relevanceScore > 5) {
      selected.push(transcript);
      usedAgents.add(transcript.agent);
      usedDispositions.add(transcript.disposition);
      usedSentiments.add(transcript.sentiment);
    }
  }

  if (selected.length < Math.min(maxTranscripts, 2)) {
    for (const transcript of sortedTranscripts) {
      if (selected.length >= maxTranscripts) break;
      if (!selected.find(s => s.id === transcript.id)) {
        selected.push(transcript);
      }
    }
  }

  console.log(`✅ Selected ${selected.length} transcripts for query type: ${queryType}`);
  
  return selected;
};

// Other helper functions remain the same...
const truncateTranscript = (transcript: string, maxLength: number = 400): string => {
  if (!transcript || transcript.length <= maxLength) return transcript;
  
  const truncated = transcript.substring(0, maxLength);
  const lastPeriod = truncated.lastIndexOf('.');
  const lastExclamation = truncated.lastIndexOf('!');
  const lastQuestion = truncated.lastIndexOf('?');
  
  const lastSentenceEnd = Math.max(lastPeriod, lastExclamation, lastQuestion);
  
  if (lastSentenceEnd > maxLength * 0.7) {
    return truncated.substring(0, lastSentenceEnd + 1);
  }
  
  const lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace > maxLength * 0.8) {
    return truncated.substring(0, lastSpace) + '...';
  }
  
  return truncated + '...';
};

// Comprehensive data preprocessing (keeping existing)
const preprocessCallData = (records: CallRecord[]): ProcessedMetrics => {
  const totalCalls = records.length;
  let totalDuration = 0;
  let totalHoldTime = 0;
  let callsOver15Min = 0;
  let callsUnder2Min = 0;

  const dispositions: Record<string, number> = {};
  const sentiments: Record<string, number> = {};
  const agentStats: Record<string, any> = {};
  const queueStats: Record<string, any> = {};
  const hourlyDistribution: Record<string, number> = {};
  const dailyTrends: Record<string, number> = {};

  records.forEach(record => {
    const duration = extractNumericValue(record.call_duration);
    const holdTime = extractNumericValue(record.total_hold_time);
    
    totalDuration += duration;
    totalHoldTime += holdTime;
    
    if (duration > 900) callsOver15Min++;
    if (duration < 120) callsUnder2Min++;

    const disposition = record.disposition_title || 'Unknown';
    dispositions[disposition] = (dispositions[disposition] || 0) + 1;

    const sentiment = extractSentiment(record.sentiment_analysis);
    sentiments[sentiment] = (sentiments[sentiment] || 0) + 1;

    const agent = record.agent_username || 'Unknown';
    if (!agentStats[agent]) {
      agentStats[agent] = {
        totalCalls: 0,
        totalDuration: 0,
        totalHoldTime: 0,
        dispositions: {},
        sentiments: {},
      };
    }
    agentStats[agent].totalCalls++;
    agentStats[agent].totalDuration += duration;
    agentStats[agent].totalHoldTime += holdTime;
    agentStats[agent].dispositions[disposition] = (agentStats[agent].dispositions[disposition] || 0) + 1;
    agentStats[agent].sentiments[sentiment] = (agentStats[agent].sentiments[sentiment] || 0) + 1;

    const queue = record.queue_name || 'Unknown';
    if (!queueStats[queue]) {
      queueStats[queue] = {
        totalCalls: 0,
        totalDuration: 0,
        totalWaitTime: 0,
        dispositions: {},
      };
    }
    queueStats[queue].totalCalls++;
    queueStats[queue].totalDuration += duration;
    queueStats[queue].totalWaitTime += holdTime;
    queueStats[queue].dispositions[disposition] = (queueStats[queue].dispositions[disposition] || 0) + 1;

    if (record.initiation_timestamp) {
      const date = new Date(record.initiation_timestamp);
      const hour = date.getHours();
      const day = date.toDateString();
      
      hourlyDistribution[hour] = (hourlyDistribution[hour] || 0) + 1;
      dailyTrends[day] = (dailyTrends[day] || 0) + 1;
    }
  });

  const dispositionBreakdown: Record<string, { count: number; percentage: number }> = {};
  Object.entries(dispositions).forEach(([key, count]) => {
    dispositionBreakdown[key] = {
      count,
      percentage: (count / totalCalls) * 100
    };
  });

  const sentimentBreakdown: Record<string, { count: number; percentage: number }> = {};
  Object.entries(sentiments).forEach(([key, count]) => {
    sentimentBreakdown[key] = {
      count,
      percentage: (count / totalCalls) * 100
    };
  });

  const agentMetrics: Record<string, any> = {};
  Object.entries(agentStats).forEach(([agent, stats]) => {
    const topDispositions = Object.entries(stats.dispositions)
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .slice(0, 3)
      .map(([disp]) => disp);

    const positiveCount = stats.sentiments['Positive'] || 0;
    const negativeCount = stats.sentiments['Negative'] || 0;
    const sentimentScore = stats.totalCalls > 0 ? 
      ((positiveCount - negativeCount) / stats.totalCalls) * 100 : 0;

    agentMetrics[agent] = {
      totalCalls: stats.totalCalls,
      avgDuration: stats.totalCalls > 0 ? stats.totalDuration / stats.totalCalls : 0,
      avgHoldTime: stats.totalCalls > 0 ? stats.totalHoldTime / stats.totalCalls : 0,
      topDispositions,
      sentimentScore,
    };
  });

  const queueMetrics: Record<string, any> = {};
  Object.entries(queueStats).forEach(([queue, stats]) => {
    const topDispositions = Object.entries(stats.dispositions)
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .slice(0, 3)
      .map(([disp]) => disp);

    queueMetrics[queue] = {
      totalCalls: stats.totalCalls,
      avgDuration: stats.totalCalls > 0 ? stats.totalDuration / stats.totalCalls : 0,
      avgWaitTime: stats.totalCalls > 0 ? stats.totalWaitTime / stats.totalCalls : 0,
      topDispositions,
    };
  });

  return {
    totalCalls,
    avgCallDuration: totalCalls > 0 ? totalDuration / totalCalls : 0,
    avgHoldTime: totalCalls > 0 ? totalHoldTime / totalCalls : 0,
    dispositionBreakdown,
    sentimentBreakdown,
    agentMetrics,
    queueMetrics,
    timePatterns: {
      hourlyDistribution,
      dailyTrends,
    },
    performanceIndicators: {
      callsOver15Min,
      callsUnder2Min,
      abandonmentRate: 0,
      firstCallResolution: 0,
    },
  };
};

// ENHANCED: Updated context preparation with expanded terms info, tire size support, and MTF filtering info
const prepareContextForQuery = (
  detectedQueryType: string,
  query: string,
  metrics: ProcessedMetrics,
  rawRecords: CallRecord[],
  keywordSearchResults?: KeywordSearchResult,
  isMTFFiltered?: boolean, // NEW: Indicate if MTF filtering was applied
  totalRecordsBeforeMTFFilter?: number, // NEW: Total records before MTF filtering
  maxTokens: number = 100000
): string => {
  console.log(`🔍 Preparing context for detected query type: ${detectedQueryType}`);
  
  let context = '';

  context += `## Call Center Analytics Summary\n`;
  
  // NEW: Add MTF filtering information
  if (isMTFFiltered && totalRecordsBeforeMTFFilter) {
    context += `**IMPORTANT: Analysis filtered to Mobile Tyre Fitting (MTF) calls only**\n`;
    context += `**Total Calls Before Filtering:** ${totalRecordsBeforeMTFFilter.toLocaleString()}\n`;
    context += `**MTF Calls Analyzed:** ${metrics.totalCalls.toLocaleString()}\n`;
    context += `**MTF Percentage of Total Calls:** ${((metrics.totalCalls / totalRecordsBeforeMTFFilter) * 100).toFixed(1)}%\n`;
  } else {
    context += `**Total Calls Analyzed:** ${metrics.totalCalls.toLocaleString()}\n`;
  }
  
  context += `**Average Call Duration:** ${Math.round(metrics.avgCallDuration / 60)} minutes ${Math.round(metrics.avgCallDuration % 60)} seconds\n`;
  context += `**Average Hold Time:** ${Math.round(metrics.avgHoldTime / 60)} minutes ${Math.round(metrics.avgHoldTime % 60)} seconds\n\n`;

  // Handle enhanced keyword search results (including tire size searches and MTF analysis)
  if ((detectedQueryType === 'keyword_search' || detectedQueryType === 'tire_size_search' || detectedQueryType === 'mtf_analysis') && keywordSearchResults) {
    const totalCallsPercentage = ((keywordSearchResults.matchingRecords.length / metrics.totalCalls) * 100);
    const transcriptCallsPercentage = keywordSearchResults.searchStats.matchPercentage;
    
    let analysisTitle = 'Enhanced Keyword Search Results';
    if (detectedQueryType === 'tire_size_search') {
      analysisTitle = 'Tire Size Stock Analysis';
    } else if (detectedQueryType === 'mtf_analysis') {
      analysisTitle = 'Mobile Tyre Fitting (MTF) Analysis';
    }
    
    context += `## ${analysisTitle}\n`;
    if (isMTFFiltered) {
      context += `**Note: All results below are from MTF calls only**\n`;
    }
    context += `**Original Search Terms:** ${keywordSearchResults.searchTerms.join(', ')}\n`;
    context += `**Expanded to ${keywordSearchResults.expandedTerms.length} Variations:** ${keywordSearchResults.expandedTerms.slice(0, 15).join(', ')}${keywordSearchResults.expandedTerms.length > 15 ? '...' : ''}\n`;
    context += `**CALL COUNT WITH KEYWORDS:** ${keywordSearchResults.matchingRecords.length} calls\n`;
    context += `**PERCENTAGE OF ${isMTFFiltered ? 'MTF' : 'TOTAL'} CALLS:** ${totalCallsPercentage.toFixed(1)}% (${keywordSearchResults.matchingRecords.length} out of ${metrics.totalCalls} ${isMTFFiltered ? 'MTF' : 'total'} calls)\n`;
    context += `**PERCENTAGE OF CALLS WITH TRANSCRIPTS:** ${transcriptCallsPercentage.toFixed(1)}% (${keywordSearchResults.matchingRecords.length} out of ${keywordSearchResults.searchStats.recordsWithTranscripts} calls with transcript data)\n`;
    context += `**Total Keyword Mentions:** ${keywordSearchResults.totalMatches}\n`;
    context += `**Records Searched:** ${keywordSearchResults.searchStats.totalRecordsSearched}\n`;
    context += `**Records with Transcript Data:** ${keywordSearchResults.searchStats.recordsWithTranscripts}\n\n`;

    if (keywordSearchResults.matchingRecords.length > 0) {
      context += `### Top Matching Records\n`;
      keywordSearchResults.matchingRecords.slice(0, 10).forEach((match, index) => {
        context += `#### Match ${index + 1}\n`;
        context += `**Agent:** ${match.agent} | **Disposition:** ${match.disposition} | **Sentiment:** ${match.sentiment}\n`;
        context += `**Duration:** ${Math.round(match.duration / 60)}m | **Keyword Occurrences:** ${match.matchCount}\n`;
        context += `**Matched Variations:** ${match.matchedVariations.slice(0, 5).join(', ')}${match.matchedVariations.length > 5 ? '...' : ''}\n`;
        if (match.matchingSnippets.length > 0) {
          context += `**Relevant Excerpts:**\n`;
          match.matchingSnippets.forEach(snippet => {
            context += `- "${snippet}"\n`;
          });
        }
        context += `\n`;
      });
      
      // Special analysis for tire size queries
      if (detectedQueryType === 'tire_size_search') {
        context += `### Tire Size Analysis Summary\n`;
        const tireSizeMatches: Record<string, number> = {};
        
        keywordSearchResults.matchingRecords.forEach(match => {
          match.matchedVariations.forEach(variation => {
            COMMON_TIRE_SIZES.forEach(tireSize => {
              if (variation.toLowerCase().includes(tireSize.toLowerCase()) || 
                  tireSize.toLowerCase().includes(variation.toLowerCase())) {
                tireSizeMatches[tireSize] = (tireSizeMatches[tireSize] || 0) + 1;
              }
            });
          });
        });
        
        if (Object.keys(tireSizeMatches).length > 0) {
          context += `**Individual Tire Size Mentions:**\n`;
          Object.entries(tireSizeMatches)
            .sort(([, a], [, b]) => b - a)
            .forEach(([size, count]) => {
              context += `- ${size}: ${count} mentions\n`;
            });
        }
        context += `\n`;
      }
    }
    context += `---\n\n`;
  } else {
    // Add regular transcript samples for other query types
    const transcriptSamples = selectRelevantTranscripts(rawRecords, detectedQueryType, query, 3);
    
    if (transcriptSamples.length > 0) {
      context += `## Relevant Call Transcript Examples\n`;
      if (isMTFFiltered) {
        context += `**Note: All transcript examples below are from MTF calls only**\n`;
      }
      transcriptSamples.forEach((sample, index) => {
        context += `### Example ${index + 1}\n`;
        context += `**Agent:** ${sample.agent} | **Disposition:** ${sample.disposition} | **Sentiment:** ${sample.sentiment} | **Duration:** ${Math.round(sample.duration / 60)}m\n`;
        context += `**Transcript:** "${sample.excerpt}"\n\n`;
      });
      context += `---\n\n`;
    }
  }

  // Rest of context preparation based on query type (existing logic)
  switch (detectedQueryType) {
    case 'mtf_analysis':
      context += `## MTF-Specific Analysis\n`;
      if (isMTFFiltered) {
        context += `### MTF Disposition Breakdown\n`;
        Object.entries(metrics.dispositionBreakdown)
          .sort(([, a], [, b]) => (b as any).count - (a as any).count)
          .forEach(([disposition, data]) => {
            context += `**${disposition}:** ${data.count} calls (${data.percentage.toFixed(1)}% of MTF calls)\n`;
          });
        
        context += `\n### MTF Agent Performance\n`;
        Object.entries(metrics.agentMetrics)
          .sort(([, a], [, b]) => (b as any).totalCalls - (a as any).totalCalls)
          .slice(0, 5)
          .forEach(([agent, data]) => {
            context += `**${agent}:** ${data.totalCalls} MTF calls, ${Math.round(data.avgDuration / 60)}m avg duration\n`;
          });
      }
      break;
      
    case 'tire_size_search':
    case 'keyword_search':
      // Already handled above
      break;
      
    case 'disposition':
      context += `## Disposition Analysis\n`;
      if (isMTFFiltered) {
        context += `**Note: Disposition analysis below is for MTF calls only**\n`;
      }
      Object.entries(metrics.dispositionBreakdown)
        .sort(([, a], [, b]) => (b as any).count - (a as any).count)
        .forEach(([disposition, data]) => {
          context += `**${disposition}:** ${data.count} calls (${data.percentage.toFixed(1)}%)\n`;
        });
      break;

    // ... other cases remain the same
    default:
      context += `## Key Metrics Overview\n`;
      if (isMTFFiltered) {
        context += `**Note: All metrics below are for MTF calls only**\n`;
      }
      context += `**Top 5 Dispositions:**\n`;
      Object.entries(metrics.dispositionBreakdown)
        .sort(([, a], [, b]) => (b as any).count - (a as any).count)
        .slice(0, 5)
        .forEach(([disposition, data]) => {
          context += `- ${disposition}: ${data.percentage.toFixed(1)}%\n`;
        });
  }

  const estimatedTokens = context.length / 4;
  if (estimatedTokens > maxTokens) {
    const maxChars = maxTokens * 4;
    context = context.substring(0, maxChars) + '\n\n[Data truncated due to size limits]';
  }

  return context;
};

// Rate-limited OpenAI API call (keeping existing)
const callOpenAIWithRetry = async (
  messages: any[],
  model: string = 'gpt-4o-mini',
  retryCount: number = 0
): Promise<any> => {
  try {
    const response = await openai.chat.completions.create({
      model,
      messages,
      max_tokens: 2000,
      temperature: 0.7,
    });
    
    return response;
  } catch (error: any) {
    if (error?.status === 429 && retryCount < RATE_LIMIT_CONFIG.maxRetries) {
      const delay = Math.min(
        RATE_LIMIT_CONFIG.baseDelay * Math.pow(RATE_LIMIT_CONFIG.backoffMultiplier, retryCount),
        RATE_LIMIT_CONFIG.maxDelay
      );
      
      console.log(`Rate limited. Retrying in ${delay}ms (attempt ${retryCount + 1}/${RATE_LIMIT_CONFIG.maxRetries})`);
      await sleep(delay);
      return callOpenAIWithRetry(messages, model, retryCount + 1);
    }
    
    if (error?.status === 400 && error?.message?.includes('context_length_exceeded')) {
      if (model === 'gpt-4o') {
        return callOpenAIWithRetry(messages, 'gpt-4o-mini', retryCount);
      }
      throw new Error('Query too complex for available models. Please try a more specific question.');
    }
    
    throw error;
  }
};

export async function POST(request: NextRequest) {
  try {
    const { query, callData, queryType, fullRecords } = await request.json();

    if (!query) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 });
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: 'OpenAI API key not configured' }, { status: 500 });
    }

    // Automatic query type detection with enhanced keyword handling, tire size support, and MTF detection
    const detectedQuery = detectQueryType(query);
    const actualQueryType = detectedQuery.type;
    
    console.log(`🔍 Query: "${query}"`);
    console.log(`📋 Frontend suggested type: ${queryType}`);
    console.log(`🤖 Backend detected type: ${actualQueryType}`);
    console.log(`🔎 Is keyword search: ${detectedQuery.isKeywordSearch}`);
    console.log(`🏷️ Extracted keywords: ${detectedQuery.extractedKeywords.join(', ')}`);
    console.log(`🚗 Is tire query: ${detectedQuery.isTireQuery}`);
    console.log(`📱 Is MTF query: ${detectedQuery.isMTFQuery}`); // NEW: Log MTF detection
    
    // Debug the available data
    console.log(`📊 Data available:`);
    console.log(`  - fullRecords: ${fullRecords ? fullRecords.length : 'null'} records`);
    console.log(`  - callData?.data?.sampleRecords: ${callData?.data?.sampleRecords ? callData.data.sampleRecords.length : 'null'} records`);
    console.log(`  - callData?.data?.fullRecords: ${callData?.data?.fullRecords ? callData.data.fullRecords.length : 'null'} records`);

    // Get the complete dataset first
    let allAvailableRecords: CallRecord[] = [];
    
    if (fullRecords && fullRecords.length > 100) {
      allAvailableRecords = fullRecords;
      console.log(`✅ Using fullRecords: ${allAvailableRecords.length} records`);
    } else if (callData?.data?.fullRecords && callData.data.fullRecords.length > 100) {
      allAvailableRecords = callData.data.fullRecords;
      console.log(`✅ Using callData.fullRecords: ${allAvailableRecords.length} records`);
    } else if (callData?.data?.sampleRecords) {
      allAvailableRecords = callData.data.sampleRecords;
      console.log(`⚠️ WARNING: Only sample records available: ${allAvailableRecords.length} records`);
    } else {
      return NextResponse.json({ 
        error: 'No call records available for analysis' 
      }, { status: 400 });
    }

    // NEW: Apply MTF filtering if MTF query is detected
    let recordsToAnalyze = allAvailableRecords;
    let isMTFFiltered = false;
    let totalRecordsBeforeMTFFilter = 0;
    
    if (detectedQuery.isMTFQuery) {
      totalRecordsBeforeMTFFilter = allAvailableRecords.length;
      const mtfRecords = allAvailableRecords.filter(record => 
        record.disposition_title && 
        record.disposition_title.toLowerCase().includes('mtf')
      );
      
      if (mtfRecords.length === 0) {
        return NextResponse.json({ 
          error: 'No MTF (Mobile Tyre Fitting) calls found in the dataset. Please check if disposition titles contain "MTF".',
          suggestion: 'Verify that mobile tyre fitting calls are properly categorized with "MTF" in the disposition_title field.'
        }, { status: 400 });
      }
      
      recordsToAnalyze = mtfRecords;
      isMTFFiltered = true;
      
      console.log(`🔍 MTF FILTERING APPLIED:`);
      console.log(`   - Total records before filtering: ${totalRecordsBeforeMTFFilter}`);
      console.log(`   - MTF records found: ${recordsToAnalyze.length}`);
      console.log(`   - MTF percentage: ${((recordsToAnalyze.length / totalRecordsBeforeMTFFilter) * 100).toFixed(1)}%`);
    } else {
      // For non-MTF searches, use normal selection logic
      if ((actualQueryType === 'keyword_search' || actualQueryType === 'tire_size_search') && detectedQuery.isKeywordSearch) {
        // For keyword searches, we need all records for accurate counting
        if (allAvailableRecords.length < 100) {
          console.log(`⚠️ WARNING: Only ${allAvailableRecords.length} records available for keyword search`);
          console.log(`⚠️ This will give inaccurate keyword counts. Full dataset needed for accurate results.`);
        }
        recordsToAnalyze = allAvailableRecords;
      } else {
        recordsToAnalyze = allAvailableRecords;
      }
    }

    let keywordSearchResults: KeywordSearchResult | undefined;
    
    // Perform keyword search on the (potentially MTF-filtered) records
    if ((actualQueryType === 'keyword_search' || actualQueryType === 'tire_size_search' || actualQueryType === 'mtf_analysis') && detectedQuery.extractedKeywords.length > 0) {
      console.log(`🔍 Performing ENHANCED keyword search on ${recordsToAnalyze.length} ${isMTFFiltered ? 'MTF-filtered' : ''} records...`);
      
      keywordSearchResults = performKeywordSearch(recordsToAnalyze, detectedQuery.extractedKeywords);
      console.log(`✅ Enhanced keyword search results:`);
      console.log(`   - Original terms: ${keywordSearchResults.searchTerms.length}`);
      console.log(`   - Expanded variations: ${keywordSearchResults.expandedTerms.length}`);
      console.log(`   - Total matches: ${keywordSearchResults.totalMatches}`);
      console.log(`   - Records with matches: ${keywordSearchResults.matchingRecords.length}`);
      console.log(`   - Records searched: ${keywordSearchResults.searchStats.totalRecordsSearched}`);
      console.log(`   - Records with transcripts: ${keywordSearchResults.searchStats.recordsWithTranscripts}`);
    }

    console.log(`Processing ${recordsToAnalyze.length} call records for AI analysis (detected query type: ${actualQueryType})${isMTFFiltered ? ' [MTF FILTERED]' : ''}`);
    
    // Create metrics from the (potentially MTF-filtered) records
    const metrics = preprocessCallData(recordsToAnalyze);

    // Prepare context using detected query type with enhanced keyword results and MTF filtering info
    const context = prepareContextForQuery(
      actualQueryType, 
      query, 
      metrics, 
      recordsToAnalyze, 
      keywordSearchResults,
      isMTFFiltered, // NEW: Pass MTF filtering status
      totalRecordsBeforeMTFFilter || undefined // NEW: Pass original total if MTF filtered
    );

    // Enhanced system prompt for better keyword search handling including tire sizes and MTF analysis
    const systemPrompt = `You are PRISM AI, an expert call center analytics assistant with advanced keyword matching capabilities. You use enhanced search algorithms that include plurals, synonyms, word variations, and fuzzy matching to provide comprehensive insights.

Key Guidelines:
- Provide specific numbers, percentages, and trends
- When transcript examples are provided, reference them to support your analysis with concrete evidence
- For keyword searches, ALWAYS prominently highlight both the exact call count AND the percentage of total calls that contained the keywords (including variations)
- For keyword searches, start your response with the key statistics: "X calls (Y.Z% of all calls) contained variations of the searched keywords"
- For MTF-filtered analyses, clearly state that the analysis is limited to Mobile Tyre Fitting calls only
- Explain that your search includes plurals, synonyms, and word variations for comprehensive matching
- When search terms are expanded (e.g., "refund" to include "refunds", "reimbursement", "return"), mention the enhanced matching capability
- Use the transcript examples to illustrate patterns and validate statistical findings
- Highlight actionable recommendations based on both metrics AND conversation patterns
- Use professional language appropriate for call center management
- When discussing performance, include both positive insights and improvement opportunities
- Format responses with clear headers and bullet points for readability
- Quote relevant parts of transcripts when they directly support your analysis
- For keyword search results, provide clear statistics and highlight the most relevant findings
- If data seems incomplete, mention limitations but still provide valuable insights from available data

Enhanced Search Features:
- Automatically includes plurals and singulars (e.g., "problem" finds "problems")
- Includes word variations (e.g., "billing" finds "bill", "billed", "bills")
- Uses call center synonyms (e.g., "angry" finds "mad", "upset", "frustrated")
- Allows fuzzy matching for minor typos and variations
- Searches phrases with flexibility for natural conversation flow
- For multi-word phrases like "wheel alignment", searches for both the complete phrase AND individual words ("wheel", "alignment") with all their variations
- For tire size queries, automatically searches for specific tire sizes: 195/65R15, 205/55R16, 215/60R16, 215/55R17, 225/45R17, 195/60R14, 255/45R19, 245/40R20, 285/35R20

Special Analysis Types:
- MTF Analysis: When analyzing Mobile Tyre Fitting queries, focus on appointment booking issues, service delivery problems, scheduling conflicts, and customer satisfaction specific to mobile services
- Tire Size Analysis: When detecting tire size or stock-related queries, automatically searches for common tire sizes and provides specific counts for each tire size mentioned in calls
- When data is filtered (e.g., MTF-only calls), always clarify the scope of analysis and what percentage of total calls this represents

Always structure your response with:
1. Direct answer to the question (for keyword searches: lead with "X calls (Y.Z% of total calls) contained variations of [keywords]")
2. Brief explanation of enhanced matching used (for keyword searches) and any filtering applied
3. Supporting data/statistics
4. Key insights or patterns (reference transcripts/keyword matches when relevant)
5. Actionable recommendations (when relevant)`;

    const userPrompt = `Based on the following call center data analyzed with enhanced keyword matching (including plurals, synonyms, and variations), please answer this question: "${query}"

${context}

Please provide a comprehensive analysis with specific metrics and actionable insights. When enhanced keyword search results are available, explain the scope of matching used and use the examples to validate and illustrate your findings.${actualQueryType === 'tire_size_search' ? ' This is a tire size analysis - provide specific insights about tire stock patterns and customer demand for different tire sizes.' : ''}${actualQueryType === 'mtf_analysis' ? ' This is a Mobile Tyre Fitting (MTF) analysis - focus on appointment booking issues, service delivery problems, and customer satisfaction specific to mobile tyre fitting services.' : ''}${isMTFFiltered ? ' IMPORTANT: This analysis is limited to MTF calls only - clearly state this limitation in your response.' : ''}`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    const startTime = Date.now();
    const response = await callOpenAIWithRetry(messages);
    const processingTime = Date.now() - startTime;

    const assistantResponse = response.choices[0]?.message?.content || 
      'Unable to generate response. Please try rephrasing your question.';

    const transcriptCount = recordsToAnalyze.filter(record => {
      return record.transcript_text && 
             typeof record.transcript_text === 'string';
    }).length;    
    
    const metadata = {
      model: response.model,
      tokensUsed: response.usage?.total_tokens || 0,
      dataPoints: recordsToAnalyze.length,
      transcriptsAvailable: transcriptCount,
      processingTime,
      queryType: actualQueryType, // Return the detected type
      detectedKeywordSearch: detectedQuery.isKeywordSearch,
      detectedTireQuery: detectedQuery.isTireQuery,
      detectedMTFQuery: detectedQuery.isMTFQuery, // NEW: Include MTF detection in metadata
      isMTFFiltered, // NEW: Include MTF filtering status
      totalRecordsBeforeMTFFilter, // NEW: Include original total if filtered
      hasFullDispositions: fullRecords && fullRecords.length > 0,
      enhancedKeywordSearch: actualQueryType === 'keyword_search' || actualQueryType === 'tire_size_search' || actualQueryType === 'mtf_analysis',
      keywordSearchResults: keywordSearchResults ? {
        totalMatches: keywordSearchResults.totalMatches,
        recordsWithMatches: keywordSearchResults.matchingRecords.length,
        searchTerms: keywordSearchResults.searchTerms,
        expandedTerms: keywordSearchResults.expandedTerms.length,
      } : undefined,
      cacheKey: `${query}_${recordsToAnalyze.length}_${isMTFFiltered ? 'mtf' : 'all'}`,
    };

    return NextResponse.json({
      response: assistantResponse,
      metadata,
    });

  } catch (error: any) {
    console.error('OpenAI API Error:', error);

    let errorMessage = 'An unexpected error occurred while processing your request.';
    let statusCode = 500;

    if (error?.status === 429) {
      errorMessage = 'Rate limit exceeded. Please wait a moment and try again.';
      statusCode = 429;
    } else if (error?.status === 400) {
      errorMessage = error.message || 'Invalid request. Please try a different question.';
      statusCode = 400;
    } else if (error?.status === 401) {
      errorMessage = 'Authentication failed. Please check API configuration.';
      statusCode = 401;
    } else if (error?.message) {
      errorMessage = error.message;
    }

    return NextResponse.json({ 
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }, { status: statusCode });
  }
}