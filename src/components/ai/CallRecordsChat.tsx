/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, AlertCircle, Loader2, Clock } from "lucide-react";
import ReactMarkdown from "react-markdown";
import CallRecord from "@/types/CallRecord";

interface Message {
  id: string;
  type: "user" | "assistant";
  content: string;
  timestamp: Date;
  error?: boolean;
  queryType?: string;
  metadata?: {
    tokensUsed?: number;
    model?: string;
    dataPoints?: number;
    processingTime?: number;
    hasFullDispositions?: boolean;
  };
}

interface CallRecordsChatProps {
  filteredRecords: CallRecord[];
  totalRecords: number;
  loading: boolean;
  allRecords?: CallRecord[];
}

const MarkdownComponents = {
  h1: ({ children }: any) => (
    <h1 className="text-lg font-bold mb-2 text-black">{children}</h1>
  ),
  h2: ({ children }: any) => (
    <h2 className="text-base font-semibold mb-2 text-black">{children}</h2>
  ),
  h3: ({ children }: any) => (
    <h3 className="text-xs font-medium mb-1 text-black">{children}</h3>
  ),
  p: ({ children }: any) => (
    <p className="mb-2 text-black leading-relaxed">{children}</p>
  ),
  ul: ({ children }: any) => (
    <ul className="list-disc list-inside mb-2 space-y-1 text-black">
      {children}
    </ul>
  ),
  ol: ({ children }: any) => (
    <ol className="list-decimal list-inside mb-2 space-y-1 text-black">
      {children}
    </ol>
  ),
  li: ({ children }: any) => <li className="text-black">{children}</li>,
  strong: ({ children }: any) => (
    <strong className="font-semibold text-black">{children}</strong>
  ),
  em: ({ children }: any) => (
    <em className="italic text-black">{children}</em>
  ),
  code: ({ children }: any) => (
    <code className="bg-gray-200 px-1 py-0.5 rounded text-xs font-mono text-black">
      {children}
    </code>
  ),
  blockquote: ({ children }: any) => (
    <blockquote className="border-l-4 pl-3 italic text-black mb-2">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-gray-300" />,
  table: ({ children }: any) => (
    <div className="overflow-x-auto mb-2">
      <table className="min-w-full border-collapse border border-gray-300 text-xs">
        {children}
      </table>
    </div>
  ),
  th: ({ children }: any) => (
    <th className="border border-gray-300 px-2 py-1 bg-gray-50 text-left font-semibold text-black text-xs">
      {children}
    </th>
  ),
  td: ({ children }: any) => (
    <td className="border border-gray-300 px-2 py-1 text-black text-xs">
      {children}
    </td>
  ),
};

const calculateDataComplexity = (
  records: CallRecord[]
): {
  complexity: "low" | "medium" | "high" | "extreme";
  estimatedTokens: number;
  recommendation: string;
} => {
  const recordCount = records.length;
  const avgFieldsPerRecord = 15;
  const estimatedTokens = recordCount * avgFieldsPerRecord * 1.5;

  if (recordCount < 100) {
    return {
      complexity: "low",
      estimatedTokens,
      recommendation: "Full dataset analysis recommended",
    };
  } else if (recordCount < 1000) {
    return {
      complexity: "medium",
      estimatedTokens,
      recommendation: "Smart aggregation will be applied",
    };
  } else if (recordCount < 5000) {
    return {
      complexity: "high",
      estimatedTokens,
      recommendation: "Statistical sampling will be used",
    };
  } else {
    return {
      complexity: "extreme",
      estimatedTokens,
      recommendation: "Advanced chunking strategy required",
    };
  }
};

// ccaching
const queryCache = new Map<
  string,
  { response: string; timestamp: number; metadata: any }
>();
const CACHE_DURATION = 120 * 60 * 1000;

const getCachedResponse = (query: string, recordCount: number): any | null => {
  const cacheKey = `${query.toLowerCase().trim()}_${recordCount}`;
  const cached = queryCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached;
  }

  for (const [key, value] of queryCache.entries()) {
    if (Date.now() - value.timestamp > CACHE_DURATION) {
      queryCache.delete(key);
    }
  }

  return null;
};

const setCachedResponse = (
  query: string,
  recordCount: number,
  response: string,
  metadata: any
) => {
  const cacheKey = `${query.toLowerCase().trim()}_${recordCount}`;
  queryCache.set(cacheKey, {
    response,
    metadata,
    timestamp: Date.now(),
  });
};

const classifyQuery = (
  query: string,
  recordCount: number
): {
  type: string;
  priority: "low" | "medium" | "high";
  complexity: "simple" | "complex";
} => {
  const lowerQuery = query.toLowerCase();
  let type = "general";
  let complexity: "simple" | "complex" = "simple";
  let priority: "low" | "medium" | "high" = "medium";

  // Query typing
  if (lowerQuery.includes("disposition") || lowerQuery.includes("outcome")) {
    type = "disposition";
    priority = "high";
  } else if (
    lowerQuery.includes("sentiment") ||
    lowerQuery.includes("satisfaction")
  ) {
    type = "sentiment";
  } else if (
    lowerQuery.includes("agent") ||
    lowerQuery.includes("performance")
  ) {
    type = "agent_performance";
    complexity = "complex";
  } else if (lowerQuery.includes("time") || lowerQuery.includes("duration")) {
    type = "timing";
  } else if (
    lowerQuery.includes("queue") ||
    lowerQuery.includes("department")
  ) {
    type = "queue_analysis";
  } else if (
    lowerQuery.includes("summary") ||
    lowerQuery.includes("overview")
  ) {
    type = "summary";
    complexity = "complex";
    priority = "high";
  } else if (lowerQuery.includes("trend") || lowerQuery.includes("pattern")) {
    type = "trends";
    complexity = "complex";
  }

  if (recordCount > 1000) {
    complexity = "complex";
  }

  return { type, priority, complexity };
};

const prepareProgressiveData = (
  records: CallRecord[],
  queryType: string,
  complexity: "simple" | "complex"
) => {
  const maxRecords = complexity === "simple" ? 200 : 500;
  const workingRecords = records.slice(0, maxRecords);
  return prepareSmartDataEnhanced(workingRecords, queryType, records.length);
};

const prepareSmartDataEnhanced = (
  records: CallRecord[],
  queryType: string,
  totalCount: number
) => {
  const baseStats = {
    totalRecords: totalCount,
    analysedRecords: records.length,
    samplingRatio: records.length / totalCount,
    dateRange:
      records.length > 0
        ? {
            earliest: records
              .map((r) => r.initiation_timestamp)
              .filter(Boolean)
              .sort()[0],
            latest: records
              .map((r) => r.initiation_timestamp)
              .filter(Boolean)
              .sort()
              .reverse()[0],
          }
        : null,
  };

  // Helper funcs
  const extractSentiment = (sentimentAnalysis: any): string => {
    if (!sentimentAnalysis) return "Unknown";
    if (Array.isArray(sentimentAnalysis) && sentimentAnalysis.length > 0) {
      return sentimentAnalysis[0].sentiment || "Unknown";
    } else if (typeof sentimentAnalysis === "string") {
      return sentimentAnalysis;
    }
    return "Unknown";
  };

  const extractDuration = (duration: any): number => {
    if (!duration) return 0;
    if (typeof duration === "number") {
      return duration;
    } else if (
      typeof duration === "object" &&
      duration.minutes !== undefined &&
      duration.seconds !== undefined
    ) {
      return duration.minutes * 60 + duration.seconds;
    }
    return 0;
  };

  const extractTime = (time: any): number => {
    if (!time) return 0;
    if (typeof time === "number") {
      return time;
    } else if (
      typeof time === "object" &&
      time.minutes !== undefined &&
      time.seconds !== undefined
    ) {
      return time.minutes * 60 + time.seconds;
    }
    return 0;
  };

  switch (queryType) {
    case "disposition":
      const dispositions = records.reduce((acc, record) => {
        const disp = record.disposition_title || "Unknown";
        acc[disp] = (acc[disp] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      return {
        type: "disposition",
        data: {
          dispositions,
          sampleSize: records.length,
          ...baseStats,
          note: "Sample data - full disposition counts will be calculated server-side",
        },
      };

    case "agent_performance":
      const agentStats = records.reduce((acc, record) => {
        const agent = record.agent_username || "Unknown";
        if (!acc[agent]) {
          acc[agent] = {
            totalCalls: 0,
            totalDuration: 0,
            totalHoldTime: 0,
            dispositions: {},
            sentiments: {},
          };
        }

        acc[agent].totalCalls++;
        acc[agent].totalDuration += extractDuration(record.call_duration);
        acc[agent].totalHoldTime += extractTime(record.total_hold_time);

        const disp = record.disposition_title || "Unknown";
        acc[agent].dispositions[disp] =
          (acc[agent].dispositions[disp] || 0) + 1;

        const sentiment = extractSentiment(record.sentiment_analysis);
        acc[agent].sentiments[sentiment] =
          (acc[agent].sentiments[sentiment] || 0) + 1;

        return acc;
      }, {} as Record<string, any>);

      return {
        type: "agent_performance",
        data: {
          agentMetrics: agentStats,
          totalAgents: Object.keys(agentStats).length,
          ...baseStats,
        },
      };

    case "summary":
      const topDispositions = Object.entries(
        records.reduce((acc, r) => {
          const disp = r.disposition_title || "Unknown";
          acc[disp] = (acc[disp] || 0) + 1;
          return acc;
        }, {} as Record<string, number>)
      )
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5);

      return {
        type: "summary",
        data: {
          overview: {
            totalCalls: totalCount,
            analysedCalls: records.length,
            uniqueAgents: new Set(
              records.map((r) => r.agent_username).filter(Boolean)
            ).size,
            uniqueQueues: new Set(
              records.map((r) => r.queue_name).filter(Boolean)
            ).size,
            avgCallDuration:
              records.reduce(
                (sum, r) => sum + extractDuration(r.call_duration),
                0
              ) / records.length,
            avgHoldTime:
              records.reduce(
                (sum, r) => sum + extractTime(r.total_hold_time),
                0
              ) / records.length,
            topDispositions,
            sentimentDistribution: records.reduce((acc, r) => {
              const sentiment = extractSentiment(r.sentiment_analysis);
              acc[sentiment] = (acc[sentiment] || 0) + 1;
              return acc;
            }, {} as Record<string, number>),
          },
          ...baseStats,
        },
      };

    default:
      const sampleRecords = records.slice(0, 10).map((record) => ({
        id: record.id,
        agent_username: record.agent_username,
        queue_name: record.queue_name,
        call_duration: extractDuration(record.call_duration),
        disposition_title: record.disposition_title,
        sentiment_analysis: extractSentiment(record.sentiment_analysis),
        primary_category: record.primary_category,
      }));

      return {
        type: "general",
        data: {
          sampleRecords,
          quickStats: {
            totalRecords: totalCount,
            avgDuration:
              records.reduce(
                (sum, r) => sum + extractDuration(r.call_duration),
                0
              ) / records.length,
            topDisposition:
              Object.entries(
                records.reduce((acc, r) => {
                  const disp = r.disposition_title || "Unknown";
                  acc[disp] = (acc[disp] || 0) + 1;
                  return acc;
                }, {} as Record<string, number>)
              ).sort(([, a], [, b]) => b - a)[0]?.[0] || "None",
          },
          ...baseStats,
        },
      };
  }
};

const CallRecordsChat: React.FC<CallRecordsChatProps> = ({
  filteredRecords,
  loading,
  allRecords,
}) => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      type: "assistant",
      content:
        "Welcome to PRISM AI Analytics!\n\nI'm your intelligent call center analytics assistant. What would you like to explore?",
      timestamp: new Date(),
    },
  ]);
  const [inputValue, setInputValue] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [dataComplexity, setDataComplexity] = useState<ReturnType<
    typeof calculateDataComplexity
  > | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (filteredRecords.length > 0) {
      setDataComplexity(calculateDataComplexity(filteredRecords));
    }
  }, [filteredRecords]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSendMessage = useCallback(
    async (customQuery?: string) => {
      const queryText = customQuery || inputValue.trim();
      if (!queryText || loading || isTyping) return;

      const cachedResponse = getCachedResponse(
        queryText,
        filteredRecords.length
      );
      if (cachedResponse) {
        const userMessage: Message = {
          id: Date.now().toString(),
          type: "user",
          content: queryText,
          timestamp: new Date(),
        };

        const assistantMessage: Message = {
          id: (Date.now() + 1).toString(),
          type: "assistant",
          content:
            cachedResponse.response +
            "\n\n*📋 Cached result for faster response*",
          timestamp: new Date(),
          metadata: cachedResponse.metadata,
        };

        setMessages((prev) => [...prev, userMessage, assistantMessage]);
        if (!customQuery) setInputValue("");
        return;
      }

      const startTime = Date.now();
      const queryClassification = classifyQuery(
        queryText,
        filteredRecords.length
      );

      const userMessage: Message = {
        id: Date.now().toString(),
        type: "user",
        content: queryText,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, userMessage]);
      if (!customQuery) setInputValue("");
      setIsTyping(true);
      setRetryCount(0);

      const attemptQuery = async (retryAttempt = 0): Promise<void> => {
        try {
          const smartData = prepareProgressiveData(
            filteredRecords,
            queryClassification.type,
            queryClassification.complexity
          );

          const recordsForDispositions =
            allRecords && allRecords.length > 0 ? allRecords : filteredRecords;

          const response = await fetch("/api/openai/query-calls", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              query: queryText,
              callData: smartData,
              queryType: queryClassification.type,
              fullRecords: recordsForDispositions,
            }),
          });

          const data = await response.json();

          if (response.status === 429 && retryAttempt < 5) {
            const delay = Math.min(Math.pow(2, retryAttempt) * 1000, 30000);
            await new Promise((resolve) => setTimeout(resolve, delay));
            setRetryCount(retryAttempt + 1);
            return attemptQuery(retryAttempt + 1);
          }

          if (!response.ok) {
            throw new Error(
              data.error || `HTTP error! status: ${response.status}`
            );
          }

          if (data.error) {
            throw new Error(data.error);
          }

          const processingTime = Date.now() - startTime;
          const assistantMessage: Message = {
            id: (Date.now() + 1).toString(),
            type: "assistant",
            content: data.response,
            timestamp: new Date(),
            queryType: queryClassification.type,
            metadata: {
              ...data.metadata,
              processingTime,
            },
          };

          setMessages((prev) => [...prev, assistantMessage]);

          setCachedResponse(
            queryText,
            filteredRecords.length,
            data.response,
            data.metadata
          );
        } catch (error) {
          console.error("Error calling OpenAI:", error);

          const errorMessage: Message = {
            id: (Date.now() + 1).toString(),
            type: "assistant",
            content: `❌ **Analysis Error**\n\n${
              error instanceof Error ? error.message : "Unknown error occurred"
            }\n\n**Suggestions:**\n• Try a more specific question\n• Use one of the quick prompts below\n• Filter your dataset if it's very large\n• Wait a moment and try again`,
            timestamp: new Date(),
            error: true,
          };

          setMessages((prev) => [...prev, errorMessage]);
        } finally {
          setIsTyping(false);
          setRetryCount(0);
        }
      };

      await attemptQuery();
    },
    [inputValue, loading, isTyping, filteredRecords, allRecords]
  );

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const formatTimestamp = (timestamp: Date) => {
    return timestamp.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getSmartPrompts = () => {
    const basePrompts = [
      "Show me complete disposition breakdown with percentages",
      "Analyse customer sentiment trends",
      "What are our average call times?",
    ];

    if (filteredRecords.length > 1000) {
      return [
        ...basePrompts,
        "Identify top performing agents.",
        "Show queue efficiency metrics",
        "What are the main customer issues?",
        "Analyse peak call times and disposition patterns",
      ];
    }

    return [
      ...basePrompts,
      "Compare agent performances.",
      "Which queues need attention based on outcomes?",
      "Identify improvement opportunities",
    ];
  };

  const hasFullDispositionData =
    allRecords && allRecords.length > filteredRecords.length;

  return (
    <div className="flex flex-col h-full rounded-lg shadow-sm">
      <div className="flex items-center gap-3 p-4 bg-black/20 rounded-t-lg">
        <div className="flex items-center justify-center w-8 h-8 bg-black/60 rounded-full">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
            <defs>
              <linearGradient
                id="messageGradient"
                x1="0%"
                y1="0%"
                x2="100%"
                y2="100%"
              >
                <stop offset="0%" stopColor="var(--color-prism-blue)" />
                <stop offset="100%" stopColor="var(--color-prism-orange)" />
              </linearGradient>
            </defs>
            <path
              d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
              stroke="url(#messageGradient)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <div>
          <h3 className="font-semibold text-[var(--color-text-primary)]">
            <span className="bg-gradient-to-r from-[var(--color-prism-blue)] to-[var(--color-prism-orange)] bg-clip-text text-transparent">
              PRISM - Call Analysis
            </span>
          </h3>
        </div>
        {retryCount > 0 && (
          <div className="flex items-center gap-2 text-[var(--color-text-primary)] text-xs">
            <Loader2 className="w-4 h-4 animate-spin" />
            Retry {retryCount}/5
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-black/60 [&::-webkit-scrollbar]:w-2
  [&::-webkit-scrollbar-track]:rounded-full
  [&::-webkit-scrollbar-track]:bg-gray-100
  [&::-webkit-scrollbar-thumb]:rounded-full
  [&::-webkit-scrollbar-thumb]:bg-gray-300
  dark:[&::-webkit-scrollbar-track]:bg-neutral-700
  dark:[&::-webkit-scrollbar-thumb]:bg-neutral-500">
        {filteredRecords.length === 0 && !loading && (
          <div className="flex items-center gap-3 p-4 bg-white border rounded-lg">
            <AlertCircle className="w-5 h-5" />
            <div className="text-xs text-black">
              No call records available for analysis. Please adjust your filters
              or check your data source.
            </div>
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex gap-3  ${
              message.type === "user" ? "justify-end" : "justify-start"
            }`}
          >
            <div
              className={`max-w-[85%]  ${
                message.type === "user" ? "order-1" : ""
              }`}
            >
              <div
                className={`rounded-lg px-3 py-2 text-black text-sm bg-white ${
                  message.type === "user"
                    ? "bg-[var(--color-prism-orange)] text-[var(--color-text-primary)]"
                    : message.error
                    ? "bg-white text-black border border-red-300"
                    : "bg-[var(--color-prism-blue)] text-[var(--color-text-primary)]"
                }`}
              >
                {message.type === "assistant" && !message.error ? (
                  <div className="prose prose-sm max-w-none ">
                    <ReactMarkdown components={MarkdownComponents}>
                      {message.content}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap text-sm leading-relaxed text-inherit">
                    {message.content}
                  </div>
                )}

                {message.metadata && (
                  <div className="text-sm mt-2 pt-2 border-t border-gray-200 flex items-center gap-4 opacity-70 ">
                    {message.metadata.processingTime && (
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {(message.metadata.processingTime / 1000).toFixed(1)}s
                      </span>
                    )}
                    {message.metadata.dataPoints && (
                      <span>
                        {message.metadata.dataPoints.toLocaleString()} data
                        points
                      </span>
                    )}
                    {message.metadata.hasFullDispositions && (
                      <span className="text-[var(--color-text-primary)] font-medium">
                        ✓ Full disposition data
                      </span>
                    )}
                  </div>
                )}
              </div>
              <div
                className={`text-xs text-white mt-1 ${
                  message.type === "user" ? "text-right" : "text-left"
                }`}
              >
                {formatTimestamp(message.timestamp)}
              </div>
            </div>
          </div>
        ))}

        {isTyping && (
          <div className="flex gap-3 justify-start">
            <div className="bg-white rounded-xl px-4 py-3 border ">
              <div className="flex items-center gap-2">
                <div className="text-xs text-black">
                  {dataComplexity?.complexity === "extreme"
                    ? "Thinking..."
                    : hasFullDispositionData
                    ? "Thinking..."
                    : "Thinking..."}
                </div>
                <div className="flex gap-1">
                  <div className="w-2 h-2 bg-[var(--color-bg-primary)] rounded-full animate-bounce"></div>
                  <div
                    className="w-2 h-2 bg-[var(--color-bg-primary)] rounded-full animate-bounce"
                    style={{ animationDelay: "0.1s" }}
                  ></div>
                  <div
                    className="w-2 h-2 bg-[var(--color-bg-primary)] rounded-full animate-bounce"
                    style={{ animationDelay: "0.2s" }}
                  ></div>
                </div>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 border-t border-black bg-black/20">
        <div className="flex gap-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={
              loading
                ? "Loading data..."
                : filteredRecords.length === 0
                ? "No data available for analysis..."
                : dataComplexity?.complexity === "extreme"
                ? hasFullDispositionData
                  ? "Ask about your data - full disposition analysis enabled..."
                  : "Ask about your data - optimized processing enabled..."
                : hasFullDispositionData
                ? "Ask me anything - complete disposition data available..."
                : "Ask me anything about your call data..."
            }
            disabled={loading || filteredRecords.length === 0 || isTyping}
            className="flex-1 px-3 py-2 bg-white border border-neutral-200 rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--color-text-primary)] focus:border-[var(--color-text-primary)] disabled:bg-gray-100 disabled:cursor-not-allowed text-sm"
          />
          <button
            onClick={() => handleSendMessage()}
            disabled={
              !inputValue.trim() ||
              loading ||
              filteredRecords.length === 0 ||
              isTyping
            }
            className="px-4 py-2 bg-black/60 text-white rounded-md hover:bg-black/40 focus:outline-none focus:ring-2 focus:ring-[var(--color-text-primary)] focus:border-[var(--color-text-primary)] disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>

        {messages.length < 2 && (
          <div>
            {filteredRecords.length > 0 && (
              <div className="mt-3">
                <div className="grid grid-cols-2 gap-2">
                  {getSmartPrompts().map((prompt) => (
                    <button
                      key={prompt}
                      onClick={() => handleSendMessage(prompt)}
                      disabled={loading || isTyping}
                      className="px-2 py-1 text-xs bg-black/60 text-neutral-200 rounded hover:bg-gray-50 hover:text-black hover:border-gray-300 transition-colors disabled:opacity-50"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default CallRecordsChat;