// TODO: fix data type issues (15/07)
/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useState, useRef, useEffect } from "react";
import { Send, AlertCircle } from "lucide-react";
import ReactMarkdown from "react-markdown";
import CallRecord from "@/types/CallRecord";
import { TranscriptSegment } from "@/types/Transcription";

interface Message {
  id: string;
  type: "user" | "assistant";
  content: string;
  timestamp: Date;
  error?: boolean;
}

interface CallDetailChatProps {
  callRecord: CallRecord;
  transcriptData?: TranscriptSegment[];
}

// components for markdown support
const MarkdownComponents = {
  h1: ({ children }: any) => (
    <h1 className="text-lg font-bold mb-2 text-[var(--color-text-primary)]">{children}</h1>
  ),
  h2: ({ children }: any) => (
    <h2 className="text-base font-semibold mb-2 text-[var(--color-text-primary)]">{children}</h2>
  ),
  h3: ({ children }: any) => (
    <h3 className="text-sm font-medium mb-1 text-[var(--color-text-primary)]">{children}</h3>
  ),
  p: ({ children }: any) => (
    <p className="mb-2 text-[var(--color-text-primary)] leading-relaxed">{children}</p>
  ),
  ul: ({ children }: any) => (
    <ul className="list-disc list-inside mb-2 space-y-1 text-[var(--color-text-primary)]">
      {children}
    </ul>
  ),
  ol: ({ children }: any) => (
    <ol className="list-decimal list-inside mb-2 space-y-1 text-[var(--color-text-primary)]">
      {children}
    </ol>
  ),
  li: ({ children }: any) => <li className="text-[var(--color-text-primary)]">{children}</li>,
  strong: ({ children }: any) => (
    <strong className="font-semibold text-[var(--color-text-primary)]">{children}</strong>
  ),
  em: ({ children }: any) => (
    <em className="italic text-[var(--color-text-primary)]">{children}</em>
  ),
  code: ({ children }: any) => (
    <code className="bg-gray-200 px-1 py-0.5 rounded text-sm font-mono text-[var(--color-text-primary)]">
      {children}
    </code>
  ),
  blockquote: ({ children }: any) => (
    <blockquote className="border-l-4 pl-3 italic text-[var(--color-text-primary)] mb-2">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-gray-300" />,
  table: ({ children }: any) => (
    <div className="overflow-x-auto mb-2">
      <table className="min-w-full border-collapse border border-gray-300 text-sm">
        {children}
      </table>
    </div>
  ),
  th: ({ children }: any) => (
    <th className="border border-gray-300 px-2 py-1 bg-gray-50 text-left font-semibold text-[var(--color-text-primary)] text-xs">
      {children}
    </th>
  ),
  td: ({ children }: any) => (
    <td className="border border-gray-300 px-2 py-1 text-[var(--color-text-primary)] text-xs">
      {children}
    </td>
  ),
};

// response formatting
const formatAIResponse = (content: string): string => {
  content = content.replace(/\n{3,}/g, "\n\n");

  content = content.replace(/^(#{1,3})\s*(.+)$/gm, "$1 $2\n");

  content = content.replace(/^[•·-]\s*/gm, "• ");

  content = content.replace(/^(#{1,3}.*?)$/gm, "\n$1");

  return content.trim();
};

const CallDetailChat: React.FC<CallDetailChatProps> = ({
  callRecord,
  transcriptData = [],
}) => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      type: "assistant",
      content:
        "Welcome to PRISM - I can help you analyse this call. What would you like to know?",
      timestamp: new Date(),
    },
  ]);
  const [inputValue, setInputValue] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const prepareCallDataForAI = (
    record: CallRecord,
    transcript: TranscriptSegment[]
  ) => {
    return {
      callRecord: {
        id: record.id,
        agent_username: record.agent_username,
        queue_name: record.queue_name,
        initiation_timestamp: record.initiation_timestamp,
        call_duration: record.call_duration,
        total_hold_time: record.total_hold_time,
        time_in_queue: record.time_in_queue,
        categories: record.categories,
        primary_category: record.primary_category,
        disposition_title: record.disposition_title,
        campaign_name: record.campaign_name,
        sentiment_analysis: record.sentiment_analysis,
        entities: record.entities,
        call_summary: record.call_summary,
        customer_cli: record.customer_cli,
        processed_at: record.processed_at,
        transcript_text: record.transcript_text,
      },
      transcript: transcript,
      callInfo: {
        hasTranscript: !!record.transcript_text || transcript.length > 0,
        hasSentiment: !!record.sentiment_analysis?.length,
        hasEntities: !!record.entities?.length,
        hasSummary: !!record.call_summary,
        transcriptLength: transcript.length,
        speakerCount: new Set(transcript.map((t) => t.speaker)).size,
      },
    };
  };

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isTyping) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      type: "user",
      content: inputValue.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue("");
    setIsTyping(true);

    try {
      const preparedData = prepareCallDataForAI(callRecord, transcriptData);

      const response = await fetch("/api/openai/query-call-detail", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: userMessage.content,
          callData: preparedData,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      const formattedContent = formatAIResponse(data.response);

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        type: "assistant",
        content: formattedContent,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      console.error("Error calling OpenAI:", error);

      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        type: "assistant",
        content:
          "I apologize, but I'm having trouble processing your request right now. This could be due to:\n\n• Network connectivity issues\n• OpenAI API rate limits\n• Server configuration issues\n\nPlease try again in a moment, or contact your administrator if the problem persists.",
        timestamp: new Date(),
        error: true,
      };

      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsTyping(false);
    }
  };

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

  const quickPrompts = [
    "Summarise this call",
    "Analyse customer sentiment",
    "Extract key topics discussed",
    "Evaluate agent performance",
    "Identify action items",
  ];

  return (
    <div className="flex flex-col h-full rounded-lg shadow-sm">
      <div className="flex items-center gap-3 p-4 border-b bg-black/20 rounded-t-lg">
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
          <p className="text-sm text-[var(--color-text-primary)] flex items-center gap-1">
            <span className="w-2 h-2 bg-gradient-to-r from-[var(--color-prism-blue)] to-[var(--color-prism-orange)] rounded-full"></span>
            {callRecord.agent_username || "Agent"} •{" "}
            {callRecord.queue_name || "Queue"}
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-black/60 [&::-webkit-scrollbar]:w-2
  [&::-webkit-scrollbar-track]:rounded-full
  [&::-webkit-scrollbar-track]:bg-gray-100
  [&::-webkit-scrollbar-thumb]:rounded-full
  [&::-webkit-scrollbar-thumb]:bg-gray-300
  dark:[&::-webkit-scrollbar-track]:bg-neutral-700
  dark:[&::-webkit-scrollbar-thumb]:bg-neutral-500">
        {!callRecord && (
          <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg ">
            <AlertCircle className="w-5 h-5 text-amber-600" />
            <div className="text-sm text-amber-800">
              No call record available for analysis.
            </div>
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex gap-3  ${
              message.type === "user" ? "justify-end" : "justify-start "
            }`}
          >
            <div
              className={`max-w-[85%]  ${
                message.type === "user" ? "order-1" : ""
              }`}
            >
              <div
                className={`rounded-lg px-3 py-2 text-sm bg-[var(--color-bg-primary)]  ${
                  message.type === "user"
                    ? "bg-[var(--color-prism-orange)] text-[var(--color-text-primary)]"
                    : message.error
                    ? "bg-red-50 text-red-900 border border-red-200"
                    : "bg-[var(--color-prism-blue)] text-[var(--color-text-primary)]"
                }`}
              >
                {message.type === "assistant" && !message.error ? (
                  <div className="prose prose-sm max-w-none text-sm ">
                    <ReactMarkdown components={MarkdownComponents}>
                      {message.content}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap text-sm leading-relaxed ">
                    {message.content}
                  </div>
                )}
              </div>
              <div
                className={`text-sm text-gray-500 mt-1  ${
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
            <div className="bg-gray-100 rounded-lg px-3 py-2">
              <div className="flex items-center gap-1">
                <div className="text-xs text-black mr-2">
                  Thinking
                </div>
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
              !callRecord
                ? "No call data available..."
                : "Ask me anything about this call..."
            }
            disabled={!callRecord || isTyping}
            className="flex-1 px-3 py-2 bg-white border border-neutral-200 rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--color-text-primary)] focus:border-[var(--color-text-primary)] disabled:bg-gray-100 disabled:cursor-not-allowed text-sm"
          />
          <button
            onClick={handleSendMessage}
            disabled={!inputValue.trim() || !callRecord || isTyping}
            className="px-4 py-2 bg-black/60 text-white rounded-md hover:bg-black/40 focus:outline-none focus:ring-2 focus:ring-[var(--color-text-primary)] focus:border-[var(--color-text-primary)] disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>

        {callRecord && (
          <div className="flex gap-2 mt-2 flex-wrap">
            {quickPrompts.map((prompt) => (
              <button
                key={prompt}
                onClick={() => setInputValue(prompt)}
                disabled={isTyping}
                className="px-2 py-1 text-xs bg-black/60 text-neutral-200 rounded hover:bg-gray-50 hover:text-black hover:border-gray-300 transition-colors disabled:opacity-50"
              >
                {prompt}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default CallDetailChat;
