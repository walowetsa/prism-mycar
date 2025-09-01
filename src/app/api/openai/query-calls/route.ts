/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

// Types
interface CallRecord {
  id: string;
  agent_username?: string;
  queue_name?: string;
  call_duration?: any;
  disposition_title?: string;
  sentiment_analysis?: any;
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

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Rate limiting and retry configuration
const RATE_LIMIT_CONFIG = {
  maxRetries: 5,
  baseDelay: 1000, // 1 second
  maxDelay: 30000, // 30 seconds
  backoffMultiplier: 2,
};

// Helper functions
const extractNumericValue = (value: any): number => {
  if (!value) return 0;
  
  try {
    let parsedDuration: { minutes?: number; seconds: number };
    
    if (typeof value === "string") {
      // Try to parse as JSON first (matching dashboard logic)
      parsedDuration = JSON.parse(value);
    } else if (typeof value === "object") {
      parsedDuration = value;
    } else if (typeof value === "number") {
      // If it's already a number, assume it's total seconds
      return value;
    } else {
      return 0;
    }

    const { seconds, minutes = 0 } = parsedDuration;

    // Validate that seconds is a valid number
    if (typeof seconds !== "number" || seconds < 0) {
      return 0;
    }

    // Validate that minutes is a valid number (if present)
    if (minutes !== undefined && (typeof minutes !== "number" || minutes < 0)) {
      return 0;
    }

    return minutes * 60 + seconds;
  } catch {
    // If JSON parsing fails, try parseFloat as fallback
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

// Smart transcript selection based on query type
const selectRelevantTranscripts = (
  records: CallRecord[],
  queryType: string,
  query: string,
  maxTranscripts: number = 3
): TranscriptSample[] => {
  console.log(`🔍 Transcript Selection Debug:`);
  console.log(`Total records received: ${records.length}`);
  
  // Debug: Check what transcript data we have
  const recordsWithTranscripts = records.filter(record => record.transcript_text);
  const recordsWithLongTranscripts = records.filter(record => 
    record.transcript_text && 
    record.transcript_text.trim().length > 50
  );
  
  console.log(`Records with transcript_text: ${recordsWithTranscripts.length}`);
  console.log(`Records with transcript_text >50 chars: ${recordsWithLongTranscripts.length}`);
  
  if (recordsWithTranscripts.length > 0) {
    const sampleLengths = recordsWithTranscripts.slice(0, 5).map(r => 
      r.transcript_text ? r.transcript_text.length : 0
    );
    console.log(`Sample transcript lengths: ${sampleLengths.join(', ')}`);
  }

  const availableTranscripts = records.filter(record => 
    record.transcript_text && 
    record.transcript_text.trim().length > 20  // Lowered threshold for debugging
  );

  console.log(`Available transcripts after filtering: ${availableTranscripts.length}`);

  if (availableTranscripts.length === 0) {
    console.log(`❌ No transcripts available for analysis`);
    return [];
  }

  const queryLower = query.toLowerCase();
  const queryKeywords = queryLower.split(' ').filter(word => word.length > 3);

  // Score transcripts based on relevance to query
  const scoredTranscripts = availableTranscripts.map(record => {
    const transcript = record.transcript_text || '';
    const transcriptLower = transcript.toLowerCase();
    let relevanceScore = 0;

    // Base scoring
    queryKeywords.forEach(keyword => {
      const matches = (transcriptLower.match(new RegExp(keyword, 'g')) || []).length;
      relevanceScore += matches * 2;
    });

    // Query type specific scoring
    switch (queryType) {
      case 'sentiment':
        const sentimentKeywords = ['happy', 'satisfied', 'angry', 'frustrated', 'pleased', 'upset', 'good', 'bad', 'excellent', 'terrible', 'love', 'hate'];
        sentimentKeywords.forEach(word => {
          if (transcriptLower.includes(word)) relevanceScore += 3;
        });
        break;

      case 'disposition':
        const dispositionKeywords = ['resolve', 'resolved', 'issue', 'problem', 'solution', 'help', 'transfer', 'escalate', 'cancel', 'refund'];
        dispositionKeywords.forEach(word => {
          if (transcriptLower.includes(word)) relevanceScore += 3;
        });
        break;

      case 'agent_performance':
        const performanceKeywords = ['thank', 'helpful', 'professional', 'rude', 'slow', 'quick', 'efficient', 'understand'];
        performanceKeywords.forEach(word => {
          if (transcriptLower.includes(word)) relevanceScore += 3;
        });
        break;

      case 'queue_analysis':
        const queueKeywords = ['wait', 'hold', 'transfer', 'department', 'long time', 'waiting'];
        queueKeywords.forEach(word => {
          if (transcriptLower.includes(word)) relevanceScore += 3;
        });
        break;
    }

    // Boost score for diversity (different agents, dispositions, sentiments)
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

  // Sort by relevance score and select top transcripts
  const sortedTranscripts = scoredTranscripts
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, maxTranscripts * 2); // Get more candidates

  // Ensure diversity in selection
  const selected: TranscriptSample[] = [];
  const usedAgents = new Set<string>();
  const usedDispositions = new Set<string>();
  const usedSentiments = new Set<string>();

  for (const transcript of sortedTranscripts) {
    if (selected.length >= maxTranscripts) break;
    
    // Prioritize diversity while maintaining relevance
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

  // If we don't have enough, add the highest scoring ones regardless of diversity
  if (selected.length < Math.min(maxTranscripts, 2)) {
    for (const transcript of sortedTranscripts) {
      if (selected.length >= maxTranscripts) break;
      if (!selected.find(s => s.id === transcript.id)) {
        selected.push(transcript);
      }
    }
  }

  console.log(`✅ Selected ${selected.length} transcripts for query type: ${queryType}`);
  selected.forEach((transcript, i) => {
    console.log(`Transcript ${i + 1}: Agent=${transcript.agent}, Score=${transcript.relevanceScore}, Length=${transcript.excerpt.length}`);
  });

  return selected;
};

const truncateTranscript = (transcript: string, maxLength: number = 400): string => {
  if (!transcript || transcript.length <= maxLength) return transcript;
  
  // Try to find a natural break point (sentence end)
  const truncated = transcript.substring(0, maxLength);
  const lastPeriod = truncated.lastIndexOf('.');
  const lastExclamation = truncated.lastIndexOf('!');
  const lastQuestion = truncated.lastIndexOf('?');
  
  const lastSentenceEnd = Math.max(lastPeriod, lastExclamation, lastQuestion);
  
  if (lastSentenceEnd > maxLength * 0.7) {
    return truncated.substring(0, lastSentenceEnd + 1);
  }
  
  // If no good break point, cut at word boundary
  const lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace > maxLength * 0.8) {
    return truncated.substring(0, lastSpace) + '...';
  }
  
  return truncated + '...';
};

// Comprehensive data preprocessing
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
    // Basic metrics
    const duration = extractNumericValue(record.call_duration);
    const holdTime = extractNumericValue(record.total_hold_time);
    
    totalDuration += duration;
    totalHoldTime += holdTime;
    
    if (duration > 900) callsOver15Min++; // 15 minutes
    if (duration < 120) callsUnder2Min++; // 2 minutes

    // Disposition tracking
    const disposition = record.disposition_title || 'Unknown';
    dispositions[disposition] = (dispositions[disposition] || 0) + 1;

    // Sentiment tracking
    const sentiment = extractSentiment(record.sentiment_analysis);
    sentiments[sentiment] = (sentiments[sentiment] || 0) + 1;

    // Agent metrics
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

    // Queue metrics
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

    // Time pattern analysis
    if (record.initiation_timestamp) {
      const date = new Date(record.initiation_timestamp);
      const hour = date.getHours();
      const day = date.toDateString();
      
      hourlyDistribution[hour] = (hourlyDistribution[hour] || 0) + 1;
      dailyTrends[day] = (dailyTrends[day] || 0) + 1;
    }
  });

  // Calculate percentages and derived metrics
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

  // Process agent metrics
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

  // Process queue metrics
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
      abandonmentRate: 0, // Would need specific logic based on disposition
      firstCallResolution: 0, // Would need specific logic based on disposition
    },
  };
};

// Smart data chunking based on query type with transcript integration
const prepareContextForQuery = (
  queryType: string,
  query: string,
  metrics: ProcessedMetrics,
  rawRecords: CallRecord[],
  maxTokens: number = 100000
): string => {
  console.log(`📝 Preparing context for query type: ${queryType}`);
  
  let context = '';

  // Base statistics (always include)
  context += `## Call Center Analytics Summary\n`;
  context += `**Total Calls Analyzed:** ${metrics.totalCalls.toLocaleString()}\n`;
  context += `**Average Call Duration:** ${Math.round(metrics.avgCallDuration / 60)} minutes ${Math.round(metrics.avgCallDuration % 60)} seconds\n`;
  context += `**Average Hold Time:** ${Math.round(metrics.avgHoldTime / 60)} minutes ${Math.round(metrics.avgHoldTime % 60)} seconds\n\n`;

  // Add relevant transcript samples
  console.log(`🔍 Attempting to select relevant transcripts...`);
  const transcriptSamples = selectRelevantTranscripts(rawRecords, queryType, query, 3);
  console.log(`📊 Selected ${transcriptSamples.length} transcript samples`);
  
  if (transcriptSamples.length > 0) {
    context += `## Relevant Call Transcript Examples\n`;
    transcriptSamples.forEach((sample, index) => {
      context += `### Example ${index + 1}\n`;
      context += `**Agent:** ${sample.agent} | **Disposition:** ${sample.disposition} | **Sentiment:** ${sample.sentiment} | **Duration:** ${Math.round(sample.duration / 60)}m\n`;
      context += `**Transcript:** "${sample.excerpt}"\n\n`;
    });
    context += `---\n\n`;
    console.log(`✅ Added ${transcriptSamples.length} transcript examples to context`);
  } else {
    console.log(`❌ No transcript samples to add to context`);
    // Add a debug section to the context
    context += `## Debug Information\n`;
    context += `**Note:** No transcript examples could be selected from the available ${rawRecords.length} records.\n\n`;
  }

  switch (queryType) {
    case 'disposition':
      context += `## Disposition Analysis\n`;
      Object.entries(metrics.dispositionBreakdown)
        .sort(([, a], [, b]) => (b as any).count - (a as any).count)
        .forEach(([disposition, data]) => {
          context += `**${disposition}:** ${data.count} calls (${data.percentage.toFixed(1)}%)\n`;
        });
      break;

    case 'agent_performance':
      context += `## Agent Performance Metrics\n`;
      Object.entries(metrics.agentMetrics)
        .sort(([, a], [, b]) => (b as any).totalCalls - (a as any).totalCalls)
        .slice(0, 15) // Reduced from 20 to make room for transcripts
        .forEach(([agent, data]) => {
          context += `**${agent}:**\n`;
          context += `- Calls: ${data.totalCalls}\n`;
          context += `- Avg Duration: ${Math.round(data.avgDuration / 60)}m ${Math.round(data.avgDuration % 60)}s\n`;
          context += `- Sentiment Score: ${data.sentimentScore.toFixed(1)}\n`;
          context += `- Top Dispositions: ${data.topDispositions.join(', ')}\n\n`;
        });
      break;

    case 'sentiment':
      context += `## Sentiment Analysis\n`;
      Object.entries(metrics.sentimentBreakdown)
        .sort(([, a], [, b]) => (b as any).count - (a as any).count)
        .forEach(([sentiment, data]) => {
          context += `**${sentiment}:** ${data.count} calls (${data.percentage.toFixed(1)}%)\n`;
        });
      break;

    case 'queue_analysis':
      context += `## Queue Performance\n`;
      Object.entries(metrics.queueMetrics)
        .sort(([, a], [, b]) => (b as any).totalCalls - (a as any).totalCalls)
        .forEach(([queue, data]) => {
          context += `**${queue}:**\n`;
          context += `- Calls: ${data.totalCalls}\n`;
          context += `- Avg Duration: ${Math.round(data.avgDuration / 60)}m ${Math.round(data.avgDuration % 60)}s\n`;
          context += `- Avg Wait: ${Math.round(data.avgWaitTime / 60)}m ${Math.round(data.avgWaitTime % 60)}s\n`;
          context += `- Top Dispositions: ${data.topDispositions.join(', ')}\n\n`;
        });
      break;

    case 'timing':
      context += `## Time Pattern Analysis\n`;
      context += `**Hourly Distribution (Top 10):**\n`;
      Object.entries(metrics.timePatterns.hourlyDistribution)
        .sort(([, a], [, b]) => (b as number) - (a as number))
        .slice(0, 10)
        .forEach(([hour, count]) => {
          context += `- ${hour}:00: ${count} calls\n`;
        });
      break;

    case 'summary':
      // Include all key metrics for summary
      context += `## Complete Overview\n\n`;
      
      context += `### Top Dispositions\n`;
      Object.entries(metrics.dispositionBreakdown)
        .sort(([, a], [, b]) => (b as any).count - (a as any).count)
        .slice(0, 8) // Reduced to make room for transcripts
        .forEach(([disposition, data]) => {
          context += `- ${disposition}: ${data.count} (${data.percentage.toFixed(1)}%)\n`;
        });
      
      context += `\n### Performance Indicators\n`;
      context += `- Calls over 15 minutes: ${metrics.performanceIndicators.callsOver15Min}\n`;
      context += `- Calls under 2 minutes: ${metrics.performanceIndicators.callsUnder2Min}\n`;
      
      context += `\n### Top Performing Agents (by call volume)\n`;
      Object.entries(metrics.agentMetrics)
        .sort(([, a], [, b]) => (b as any).totalCalls - (a as any).totalCalls)
        .slice(0, 5)
        .forEach(([agent, data]) => {
          context += `- ${agent}: ${data.totalCalls} calls, sentiment score: ${data.sentimentScore.toFixed(1)}\n`;
        });
      break;

    default:
      // General query - include sample records and key metrics
      context += `## Key Metrics Overview\n`;
      context += `**Top 5 Dispositions:**\n`;
      Object.entries(metrics.dispositionBreakdown)
        .sort(([, a], [, b]) => (b as any).count - (a as any).count)
        .slice(0, 5)
        .forEach(([disposition, data]) => {
          context += `- ${disposition}: ${data.percentage.toFixed(1)}%\n`;
        });
  }

  // Truncate if too long (rough token estimation: 1 token ≈ 4 characters)
  const estimatedTokens = context.length / 4;
  if (estimatedTokens > maxTokens) {
    const maxChars = maxTokens * 4;
    context = context.substring(0, maxChars) + '\n\n[Data truncated due to size limits]';
  }

  return context;
};

// Rate-limited OpenAI API call with exponential backoff
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
      // Try with a smaller model or reduced context
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

    // Use fullRecords if available for complete analysis, otherwise use callData
    const recordsToAnalyze = fullRecords && fullRecords.length > 0 ? fullRecords : 
                           (callData?.data?.sampleRecords || []);

    if (!recordsToAnalyze || recordsToAnalyze.length === 0) {
      return NextResponse.json({ 
        error: 'No call records available for analysis' 
      }, { status: 400 });
    }

    // Preprocess the data for efficient analysis
    console.log(`Processing ${recordsToAnalyze.length} call records for query type: ${queryType}`);
    console.log(`📋 Sample record keys:`, recordsToAnalyze[0] ? Object.keys(recordsToAnalyze[0]) : 'No records');
    console.log(`📝 First record has transcript_text:`, !!recordsToAnalyze[0]?.transcript_text);
    if (recordsToAnalyze[0]?.transcript_text) {
      console.log(`📄 First transcript length:`, recordsToAnalyze[0].transcript_text.length);
      console.log(`📃 First transcript preview:`, recordsToAnalyze[0].transcript_text.substring(0, 100) + '...');
    }
    
    const metrics = preprocessCallData(recordsToAnalyze);

    // Prepare context based on query type - now includes transcripts
    console.log(`🔧 Preparing context with query: "${query}"`);
    const context = prepareContextForQuery(queryType || 'general', query, metrics, recordsToAnalyze);
    console.log(`📊 Context length: ${context.length} characters`);
    console.log(`🔍 Context includes 'Transcript'?`, context.includes('Transcript'));
    console.log(`📋 Context preview:\n${context.substring(0, 500)}...`);

    // Create the prompt with enhanced instructions for transcript analysis
    const systemPrompt = `You are PRISM AI, an expert call center analytics assistant. Analyze the provided call center data and answer questions with precise, actionable insights.

Key Guidelines:
- Provide specific numbers, percentages, and trends
- When transcript examples are provided, reference them to support your analysis with concrete evidence
- Use the transcript examples to illustrate patterns and validate statistical findings
- Highlight actionable recommendations based on both metrics AND conversation patterns
- Use professional language appropriate for call center management
- When discussing performance, include both positive insights and improvement opportunities
- Format responses with clear headers and bullet points for readability
- Quote relevant parts of transcripts when they directly support your analysis
- If data seems incomplete, mention limitations but still provide valuable insights from available data

Always structure your response with:
1. Direct answer to the question
2. Supporting data/statistics
3. Key insights or patterns (reference transcripts when relevant)
4. Actionable recommendations (when relevant)`;

    const userPrompt = `Based on the following call center data, please answer this question: "${query}"

${context}

Please provide a comprehensive analysis with specific metrics and actionable insights. When transcript examples are available, use them to validate and illustrate your findings.`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    // Call OpenAI with retry logic
    const startTime = Date.now();
    const response = await callOpenAIWithRetry(messages);
    const processingTime = Date.now() - startTime;

    const assistantResponse = response.choices[0]?.message?.content || 
      'Unable to generate response. Please try rephrasing your question.';

    // Calculate metadata
    const transcriptCount = recordsToAnalyze.filter((r: { transcript_text: { trim: () => { (): any; new(): any; length: number; }; }; }) => r.transcript_text && r.transcript_text.trim().length > 50).length;
    const metadata = {
      model: response.model,
      tokensUsed: response.usage?.total_tokens || 0,
      dataPoints: recordsToAnalyze.length,
      transcriptsAvailable: transcriptCount,
      processingTime,
      queryType,
      hasFullDispositions: fullRecords && fullRecords.length > 0,
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