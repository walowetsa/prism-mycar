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
  if (typeof value === 'number') return value;
  if (typeof value === 'object' && value.minutes !== undefined && value.seconds !== undefined) {
    return value.minutes * 60 + value.seconds;
  }
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? 0 : parsed;
  }
  return 0;
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

// Smart data chunking based on query type
const prepareContextForQuery = (
  queryType: string,
  metrics: ProcessedMetrics,
  rawRecords: CallRecord[],
  maxTokens: number = 100000
): string => {
  let context = '';

  // Base statistics (always include)
  context += `## Call Center Analytics Summary\n`;
  context += `**Total Calls Analyzed:** ${metrics.totalCalls.toLocaleString()}\n`;
  context += `**Average Call Duration:** ${Math.round(metrics.avgCallDuration / 60)} minutes ${Math.round(metrics.avgCallDuration % 60)} seconds\n`;
  context += `**Average Hold Time:** ${Math.round(metrics.avgHoldTime / 60)} minutes ${Math.round(metrics.avgHoldTime % 60)} seconds\n\n`;

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
        .slice(0, 20) // Top 20 agents to stay within token limits
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
        .slice(0, 10)
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
      
      // Add sample records for context
      context += `\n**Sample Call Records:**\n`;
      rawRecords.slice(0, 5).forEach((record, index) => {
        context += `${index + 1}. Agent: ${record.agent_username || 'Unknown'}, `;
        context += `Duration: ${Math.round(extractNumericValue(record.call_duration) / 60)}m, `;
        context += `Disposition: ${record.disposition_title || 'Unknown'}\n`;
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
    const metrics = preprocessCallData(recordsToAnalyze);

    // Prepare context based on query type
    const context = prepareContextForQuery(queryType || 'general', metrics, recordsToAnalyze);

    // Create the prompt
    const systemPrompt = `You are PRISM AI, an expert call center analytics assistant. Analyze the provided call center data and answer questions with precise, actionable insights.

Key Guidelines:
- Provide specific numbers, percentages, and trends
- Highlight actionable recommendations
- Use professional language appropriate for call center management
- When discussing performance, include both positive insights and improvement opportunities
- Format responses with clear headers and bullet points for readability
- If data seems incomplete, mention limitations but still provide valuable insights from available data

Always structure your response with:
1. Direct answer to the question
2. Supporting data/statistics
3. Key insights or patterns
4. Actionable recommendations (when relevant)`;

    const userPrompt = `Based on the following call center data, please answer this question: "${query}"

${context}

Please provide a comprehensive analysis with specific metrics and actionable insights.`;

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
    const metadata = {
      model: response.model,
      tokensUsed: response.usage?.total_tokens || 0,
      dataPoints: recordsToAnalyze.length,
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