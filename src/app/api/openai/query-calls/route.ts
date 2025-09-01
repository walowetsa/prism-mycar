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
  matchingRecords: Array<{
    id: string;
    agent: string;
    disposition: string;
    sentiment: string;
    duration: number;
    matchingSnippets: string[];
    matchCount: number;
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

// NEW: Enhanced query detection that works automatically
const detectQueryType = (query: string): { 
  type: string; 
  isKeywordSearch: boolean; 
  extractedKeywords: string[] 
} => {
  const lowerQuery = query.toLowerCase();
  
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
  ];

  const isKeywordSearch = keywordSearchPatterns.some(pattern => pattern.test(query));
  
  let extractedKeywords: string[] = [];
  if (isKeywordSearch) {
    extractedKeywords = extractKeywordsFromQuery(query);
  }

  // Determine base query type
  let type = 'general';
  if (isKeywordSearch) {
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

  return { type, isKeywordSearch, extractedKeywords };
};

// Extract keywords from query (same as before)
const extractKeywordsFromQuery = (query: string): string[] => {
  const cleanQuery = query
    .toLowerCase()
    .replace(/\b(how many|count|find|search|show me|what|where|when|calls?|records?|included?|contain|mentioned?|about)\b/gi, '')
    .replace(/[^\w\s]/g, ' ')
    .trim();
  
  // Extract quoted phrases first
  const quotedPhrases = query.match(/"([^"]+)"/g);
  const keywords: string[] = [];
  
  if (quotedPhrases) {
    keywords.push(...quotedPhrases.map(phrase => phrase.replace(/"/g, '')));
  }
  
  // Extract remaining significant words (longer than 3 characters)
  const words = cleanQuery
    .split(/\s+/)
    .filter(word => word.length > 3)
    .filter(word => !['that', 'with', 'have', 'were', 'been', 'this', 'they', 'them', 'from', 'call'].includes(word));
  
  keywords.push(...words);
  
  return [...new Set(keywords)].slice(0, 5);
};

// Keyword search functionality (same as before)
const performKeywordSearch = (
  records: CallRecord[],
  searchTerms: string[]
): KeywordSearchResult => {
  console.log(`🔍 Performing keyword search for: ${searchTerms.join(', ')}`);
  
  const recordsWithTranscripts = records.filter(record => 
    record.transcript_text && record.transcript_text.trim().length
  );
  
  console.log(`📊 Total records: ${records.length}, Records with transcripts: ${recordsWithTranscripts.length}`);
  
  const matchingRecords: KeywordSearchResult['matchingRecords'] = [];
  let totalMatches = 0;
  
  recordsWithTranscripts.forEach(record => {
    const transcript = record.transcript_text?.toLowerCase() || '';
    const matchingSnippets: string[] = [];
    let recordMatchCount = 0;
    
    searchTerms.forEach(term => {
      const termLower = term.toLowerCase();
      const regex = new RegExp(`\\b${termLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
      const matches = transcript.match(regex);
      
      if (matches) {
        recordMatchCount += matches.length;
        
        let lastIndex = 0;
        let match;
        const snippetRegex = new RegExp(`(.{0,50})\\b${termLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b(.{0,50})`, 'gi');
        
        while ((match = snippetRegex.exec(transcript)) !== null && matchingSnippets.length < 3) {
          const snippet = match[0].trim();
          if (snippet.length > 10) {
            matchingSnippets.push(`...${snippet}...`);
          }
          
          if (snippetRegex.lastIndex === lastIndex) break;
          lastIndex = snippetRegex.lastIndex;
        }
      }
    });
    
    if (recordMatchCount > 0) {
      totalMatches += recordMatchCount;
      matchingRecords.push({
        id: record.id,
        agent: record.agent_username || 'Unknown',
        disposition: record.disposition_title || 'Unknown',
        sentiment: extractSentiment(record.sentiment_analysis),
        duration: extractNumericValue(record.call_duration),
        matchingSnippets: matchingSnippets.slice(0, 2),
        matchCount: recordMatchCount,
      });
    }
  });
  
  matchingRecords.sort((a, b) => b.matchCount - a.matchCount);
  
  const result: KeywordSearchResult = {
    totalMatches,
    searchTerms,
    matchingRecords: matchingRecords,
    searchStats: {
      totalRecordsSearched: records.length,
      recordsWithTranscripts: recordsWithTranscripts.length,
      matchPercentage: recordsWithTranscripts.length > 0 ? 
        (matchingRecords.length / recordsWithTranscripts.length) * 100 : 0
    }
  };
  
  console.log(`✅ Keyword search complete: ${totalMatches} total matches in ${matchingRecords.length} records`);
  
  return result;
};

// Smart transcript selection (existing function, updated to handle keyword search)
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
    console.log(`❌ No transcripts available for analysis`);
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

    // Enhanced scoring for keyword searches
    if (queryType === 'keyword_search') {
      const searchTerms = extractKeywordsFromQuery(query);
      searchTerms.forEach(term => {
        const regex = new RegExp(`\\b${term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
        const matches = (transcriptLower.match(regex) || []).length;
        relevanceScore += matches * 10;
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

// Other helper functions (truncateTranscript, preprocessCallData) remain the same...
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

// Updated context preparation
const prepareContextForQuery = (
  detectedQueryType: string,
  query: string,
  metrics: ProcessedMetrics,
  rawRecords: CallRecord[],
  keywordSearchResults?: KeywordSearchResult,
  maxTokens: number = 100000
): string => {
  console.log(`🔍 Preparing context for detected query type: ${detectedQueryType}`);
  
  let context = '';

  context += `## Call Center Analytics Summary\n`;
  context += `**Total Calls Analyzed:** ${metrics.totalCalls.toLocaleString()}\n`;
  context += `**Average Call Duration:** ${Math.round(metrics.avgCallDuration / 60)} minutes ${Math.round(metrics.avgCallDuration % 60)} seconds\n`;
  context += `**Average Hold Time:** ${Math.round(metrics.avgHoldTime / 60)} minutes ${Math.round(metrics.avgHoldTime % 60)} seconds\n\n`;

  // Handle keyword search results
  if (detectedQueryType === 'keyword_search' && keywordSearchResults) {
    const totalCallsPercentage = ((keywordSearchResults.matchingRecords.length / metrics.totalCalls) * 100);
    const transcriptCallsPercentage = keywordSearchResults.searchStats.matchPercentage;
    
    context += `## Keyword Search Results\n`;
    context += `**Search Terms:** ${keywordSearchResults.searchTerms.join(', ')}\n`;
    context += `**CALL COUNT WITH KEYWORDS:** ${keywordSearchResults.matchingRecords.length} calls\n`;
    context += `**PERCENTAGE OF TOTAL CALLS:** ${totalCallsPercentage.toFixed(1)}% (${keywordSearchResults.matchingRecords.length} out of ${metrics.totalCalls} total calls)\n`;
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
        if (match.matchingSnippets.length > 0) {
          context += `**Relevant Excerpts:**\n`;
          match.matchingSnippets.forEach(snippet => {
            context += `- "${snippet}"\n`;
          });
        }
        context += `\n`;
      });
    }
    context += `---\n\n`;
  } else {
    // Add regular transcript samples for other query types
    const transcriptSamples = selectRelevantTranscripts(rawRecords, detectedQueryType, query, 3);
    
    if (transcriptSamples.length > 0) {
      context += `## Relevant Call Transcript Examples\n`;
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
    case 'keyword_search':
      // Already handled above
      break;
      
    case 'disposition':
      context += `## Disposition Analysis\n`;
      Object.entries(metrics.dispositionBreakdown)
        .sort(([, a], [, b]) => (b as any).count - (a as any).count)
        .forEach(([disposition, data]) => {
          context += `**${disposition}:** ${data.count} calls (${data.percentage.toFixed(1)}%)\n`;
        });
      break;

    // ... other cases remain the same
    default:
      context += `## Key Metrics Overview\n`;
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

    // NEW: Automatic query type detection BEFORE determining which records to use
    const detectedQuery = detectQueryType(query);
    const actualQueryType = detectedQuery.type;
    
    console.log(`🔍 Query: "${query}"`);
    console.log(`📋 Frontend suggested type: ${queryType}`);
    console.log(`🤖 Backend detected type: ${actualQueryType}`);
    console.log(`🔎 Is keyword search: ${detectedQuery.isKeywordSearch}`);
    
    // Debug the available data
    console.log(`📊 Data available:`);
    console.log(`  - fullRecords: ${fullRecords ? fullRecords.length : 'null'} records`);
    console.log(`  - callData?.data?.sampleRecords: ${callData?.data?.sampleRecords ? callData.data.sampleRecords.length : 'null'} records`);
    console.log(`  - callData?.data?.fullRecords: ${callData?.data?.fullRecords ? callData.data.fullRecords.length : 'null'} records`);

    // NEW: For keyword searches, we MUST have access to all records
    let allAvailableRecords: CallRecord[] = [];
    
    if (actualQueryType === 'keyword_search' && detectedQuery.isKeywordSearch) {
      // Try multiple sources for complete dataset
      if (fullRecords && fullRecords.length > 100) {
        allAvailableRecords = fullRecords;
        console.log(`✅ Using fullRecords for keyword search: ${allAvailableRecords.length} records`);
      } else if (callData?.data?.fullRecords && callData.data.fullRecords.length > 100) {
        allAvailableRecords = callData.data.fullRecords;
        console.log(`✅ Using callData.fullRecords for keyword search: ${allAvailableRecords.length} records`);
      } else if (callData?.data?.sampleRecords) {
        allAvailableRecords = callData.data.sampleRecords;
        console.log(`⚠️ WARNING: Only sample records available for keyword search: ${allAvailableRecords.length} records`);
        console.log(`⚠️ This will give inaccurate keyword counts. Full dataset needed for accurate results.`);
      } else {
        return NextResponse.json({ 
          error: 'Insufficient data for keyword search. Full dataset required for accurate keyword counting.',
          suggestion: 'Please ensure all call records are sent to the backend for keyword searches.'
        }, { status: 400 });
      }
    } else {
      // For non-keyword searches, use the normal data selection
      allAvailableRecords = fullRecords && fullRecords.length > 0 ? fullRecords : 
                           (callData?.data?.sampleRecords || []);
    }

    if (!allAvailableRecords || allAvailableRecords.length === 0) {
      return NextResponse.json({ 
        error: 'No call records available for analysis' 
      }, { status: 400 });
    }

    let keywordSearchResults: KeywordSearchResult | undefined;
    let recordsToAnalyze = allAvailableRecords;
    
    // NEW: Perform keyword search on ALL available records first
    if (actualQueryType === 'keyword_search' && detectedQuery.extractedKeywords.length > 0) {
      console.log(`🔍 Performing keyword search on ALL ${allAvailableRecords.length} records...`);
      
      // Search ALL available records for accurate counts
      keywordSearchResults = performKeywordSearch(allAvailableRecords, detectedQuery.extractedKeywords);
      console.log(`✅ Complete keyword search results:`);
      console.log(`   - Total matches: ${keywordSearchResults.totalMatches}`);
      console.log(`   - Records with matches: ${keywordSearchResults.matchingRecords.length}`);
      console.log(`   - Records searched: ${keywordSearchResults.searchStats.totalRecordsSearched}`);
      console.log(`   - Records with transcripts: ${keywordSearchResults.searchStats.recordsWithTranscripts}`);
      
      // For AI processing, create a smart subset that includes:
      // 1. All matching records (up to 100 for context)
      // 2. A sample of non-matching records for baseline metrics
      if (keywordSearchResults.matchingRecords.length > 0) {
        const matchingRecordIds = new Set(keywordSearchResults.matchingRecords.map(r => r.id));
        const matchingRecords = allAvailableRecords.filter(r => matchingRecordIds.has(r.id));
        const nonMatchingRecords = allAvailableRecords.filter(r => !matchingRecordIds.has(r.id));
        
        // Limit matching records for AI context (but keep all for search results)
        const limitedMatchingRecords = matchingRecords.slice(0, 100);
        const sampleNonMatchingRecords = nonMatchingRecords.slice(0, 200);
        
        recordsToAnalyze = [...limitedMatchingRecords, ...sampleNonMatchingRecords];
        
        console.log(`📋 Records for AI analysis: ${recordsToAnalyze.length} (${limitedMatchingRecords.length} matching + ${sampleNonMatchingRecords.length} sample)`);
      } else {
        // No matches found, use a sample for baseline metrics
        recordsToAnalyze = allAvailableRecords.slice(0, 500);
        console.log(`📋 No matches found. Using ${recordsToAnalyze.length} sample records for baseline metrics.`);
      }
    } else {
      // For non-keyword searches, limit records for performance
      const maxRecordsForAnalysis = allAvailableRecords.length;
      if (allAvailableRecords.length > maxRecordsForAnalysis) {
        recordsToAnalyze = allAvailableRecords.slice(0, maxRecordsForAnalysis);
        console.log(`📊 Limited to ${maxRecordsForAnalysis} records for non-keyword analysis`);
      }
    }

    console.log(`Processing ${recordsToAnalyze.length} call records for AI analysis (detected query type: ${actualQueryType})`);
    
    // Create metrics from the AI analysis subset, but override totals for keyword searches
    let metrics = preprocessCallData(recordsToAnalyze);
    
    // NEW: For keyword searches, override totalCalls to reflect the complete dataset
    if (actualQueryType === 'keyword_search' && keywordSearchResults) {
      metrics = {
        ...metrics,
        totalCalls: allAvailableRecords.length, // Use complete dataset count
      };
      console.log(`📈 Metrics updated: totalCalls set to ${metrics.totalCalls} (complete dataset)`);
    }

    // Prepare context using detected query type
    const context = prepareContextForQuery(
      actualQueryType, 
      query, 
      metrics, 
      recordsToAnalyze, 
      keywordSearchResults
    );

    // Enhanced system prompt that handles keyword searches automatically
    const systemPrompt = `You are PRISM AI, an expert call center analytics assistant. Analyze the provided call center data and answer questions with precise, actionable insights.

Key Guidelines:
- Provide specific numbers, percentages, and trends
- When transcript examples are provided, reference them to support your analysis with concrete evidence
- For keyword searches, ALWAYS prominently highlight both the exact call count AND the percentage of total calls that contained the keywords
- For keyword searches, start your response with the key statistics: "X calls (Y.Z% of all calls) contained the searched keywords"
- Use the transcript examples to illustrate patterns and validate statistical findings
- Highlight actionable recommendations based on both metrics AND conversation patterns
- Use professional language appropriate for call center management
- When discussing performance, include both positive insights and improvement opportunities
- Format responses with clear headers and bullet points for readability
- Quote relevant parts of transcripts when they directly support your analysis
- For keyword search results, provide clear statistics and highlight the most relevant findings
- If data seems incomplete, mention limitations but still provide valuable insights from available data

Always structure your response with:
1. Direct answer to the question (for keyword searches: lead with "X calls (Y.Z% of total calls) contained [keywords]")
2. Supporting data/statistics
3. Key insights or patterns (reference transcripts/keyword matches when relevant)
4. Actionable recommendations (when relevant)`;

    const userPrompt = `Based on the following call center data, please answer this question: "${query}"

${context}

Please provide a comprehensive analysis with specific metrics and actionable insights. When transcript examples or keyword search results are available, use them to validate and illustrate your findings.`;

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
}).length;    const metadata = {
      model: response.model,
      tokensUsed: response.usage?.total_tokens || 0,
      dataPoints: recordsToAnalyze.length,
      transcriptsAvailable: transcriptCount,
      processingTime,
      queryType: actualQueryType, // Return the detected type
      detectedKeywordSearch: detectedQuery.isKeywordSearch,
      hasFullDispositions: fullRecords && fullRecords.length > 0,
      keywordSearchResults: keywordSearchResults ? {
        totalMatches: keywordSearchResults.totalMatches,
        recordsWithMatches: keywordSearchResults.matchingRecords.length,
        searchTerms: keywordSearchResults.searchTerms,
      } : undefined,
      cacheKey: `${query}_${recordsToAnalyze.length}`,
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