"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import CallRecord from "@/types/CallRecord";
import Transcript from "@/components/ui/Transcript";
import { TranscriptSegment } from "@/types/Transcription";
import CallDetailChat from "@/components/ai/CallDetailChat";
import { SentimentData } from "@/types/SentimentData";
import Image from "next/image";
import Loader from '../../../public/prism-loader.gif'

const CallLogPage = () => {
  const params = useParams();
  const router = useRouter();
  const contact_id = params.contact_id as string;

  const [callRecord, setCallRecord] = useState<CallRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [transcriptData, setTranscriptData] = useState<TranscriptSegment[]>([]);
  const [showChat, setShowChat] = useState(false);

  useEffect(() => {
    if (contact_id) {
      fetchCallRecord();
    }
  }, [contact_id]);

  const fetchCallRecord = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`/api/supabase/${contact_id}`);

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error("Call record not found");
        }
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();

      if (result.error) {
        throw new Error(result.error);
      }

      setCallRecord(result.data);

      if (result.data.speaker_data) {
        try {
          const parsedTranscript =
            typeof result.data.speaker_data === "string"
              ? JSON.parse(result.data.speaker_data)
              : result.data.speaker_data;
          setTranscriptData(parsedTranscript);
        } catch (err) {
          console.error("Error parsing transcript data:", err);
          setTranscriptData([]);
        }
      }
    } catch (err) {
      console.error("Error fetching call record:", err);
      setError(
        err instanceof Error ? err.message : "Failed to fetch call record"
      );
    } finally {
      setLoading(false);
    }
  };

  const formatTimestamp = (timestamp: string | null): string => {
    if (!timestamp) return "N/A";

    try {
      const date = new Date(timestamp);
      return date.toLocaleString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZoneName: "short",
      });
    } catch {
      return "Invalid Date";
    }
  };

  const formatDuration = (
    duration: string | { minutes?: number; seconds: number } | null
  ): string => {
    if (!duration) return "N/A";
    try {
      let parsedDuration: { minutes?: number; seconds: number };
      if (typeof duration === "string") {
        parsedDuration = JSON.parse(duration);
      } else {
        parsedDuration = duration;
      }
      const { seconds, minutes = 0 } = parsedDuration;

      // Validate numbers
      if (typeof seconds !== "number" || seconds < 0) {
        return "N/A";
      }

      // Do minutes exist?
      if (
        minutes !== undefined &&
        (typeof minutes !== "number" || minutes < 0)
      ) {
        return "N/A";
      }

      // Format
      if (minutes === 0 || minutes === undefined) {
        return `${seconds}s`;
      }
      return `${minutes}m ${seconds}s`;
    } catch (error) {
      console.error("Error parsing call duration:", error);
      return "N/A";
    }
  };

  // Helper Func - Sentiment
  // TODO: fix data type issues (15/07)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parseSentimentData = (sentimentAnalysis: any): SentimentData[] => {
    if (!sentimentAnalysis) return [];

    try {
      let parsedData: SentimentData[];

      if (typeof sentimentAnalysis === "string") {
        parsedData = JSON.parse(sentimentAnalysis);
      } else {
        parsedData = sentimentAnalysis;
      }

      return Array.isArray(parsedData) ? parsedData : [];
    } catch (error) {
      console.error("Error parsing sentiment data:", error);
      return [];
    }
  };

  const calculateSentimentStats = (sentimentData: SentimentData[]) => {
    if (sentimentData.length === 0) return null;
    type ValidSentiment = "positive" | "negative" | "neutral";
    const isValidSentiment = (
      sentiment: string
    ): sentiment is ValidSentiment => {
      return ["positive", "negative", "neutral"].includes(sentiment);
    };

    const stats = sentimentData.reduce(
      (acc, item) => {
        acc.total++;

        const normalizedSentiment = item.sentiment.toLowerCase();

        // Increment valid sentiments
        if (isValidSentiment(normalizedSentiment)) {
          acc[normalizedSentiment]++;
        }

        acc.totalConfidence += item.confidence;

        if (!acc.speakers[item.speaker]) {
          acc.speakers[item.speaker] = {
            positive: 0,
            negative: 0,
            neutral: 0,
            total: 0,
          };
        }

        if (isValidSentiment(normalizedSentiment)) {
          acc.speakers[item.speaker][normalizedSentiment]++;
        }
        acc.speakers[item.speaker].total++;

        return acc;
      },
      {
        positive: 0,
        negative: 0,
        neutral: 0,
        total: 0,
        totalConfidence: 0,
        speakers: {} as Record<
          string,
          { positive: number; negative: number; neutral: number; total: number }
        >,
      }
    );

    return {
      ...stats,
      averageConfidence: stats.totalConfidence / stats.total,
      percentages: {
        positive: (stats.positive / stats.total) * 100,
        negative: (stats.negative / stats.total) * 100,
        neutral: (stats.neutral / stats.total) * 100,
      },
    };
  };

  const getSentimentBgColor = (sentiment: string) => {
    switch (sentiment.toLowerCase()) {
      case "positive":
        return "bg-green-900/20 border-green-500/30";
      case "negative":
        return "bg-red-900/20 border-red-500/30";
      case "neutral":
        return "bg-gray-900/20 border-gray-500/30";
      default:
        return "bg-gray-900/20 border-gray-500/30";
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex flex-col">
        <div className="flex-1 p-6">
          <div className="flex flex-col items-center justify-center min-h-[400px]">
            <div className="text-gray-600 text-lg">Loading call details...</div>
                    <Image src={Loader} alt={"loading-icon"} width={480} height={480}/>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex flex-col">
        <div className="flex-1 p-6">
          <div className="max-w-2xl mx-auto">
            <div className="bg-red-50 border border-red-200 rounded-lg p-6">
              <div className="text-red-800 text-lg font-semibold mb-2">
                Error Loading Call Details
              </div>
              <div className="text-red-700 mb-4">{error}</div>
              <div className="flex gap-3">
                <button
                  onClick={fetchCallRecord}
                  className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors"
                >
                  Retry
                </button>
                <button
                  onClick={() => router.back()}
                  className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors"
                >
                  Go Back
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!callRecord) {
    return (
      <div className="flex-1 flex flex-col">
        <div className="flex-1 p-6">
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="text-gray-600 text-lg">No call record found.</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-[var(--color-bg-primary)]">
      <div className="flex-1 p-4">
        <div className="max-w-full">
          {/* Header */}
          <div className="mb-6 flex items-center gap-x-4">
            <h1 className="text-xl font-bold text-[var(--color-text-primary)]">
              <span className="bg-gradient-to-r from-[var(--color-prism-blue)] to-[var(--color-prism-orange)] bg-clip-text text-transparent">
                Call Details
              </span>
            </h1>
            <p className="text-sm text-[var(--color-text-primary)] mt-1">Contact ID: {contact_id}</p>
          </div>

          <div className="grid grid-cols-2 gap-6">
            {/* Left Column - Call Details */}
            <div
              className="space-y-6 max-h-[calc(100vh-160px)] overflow-y-scroll [&::-webkit-scrollbar]:w-2
  [&::-webkit-scrollbar-track]:rounded-full
  [&::-webkit-scrollbar-track]:bg-gray-100
  [&::-webkit-scrollbar-thumb]:rounded-full
  [&::-webkit-scrollbar-thumb]:bg-gray-300
  dark:[&::-webkit-scrollbar-track]:bg-neutral-700
  dark:[&::-webkit-scrollbar-thumb]:bg-neutral-500"
            >
              {/* Call Overview */}
              <div className="bg-black/60 rounded-lg shadow-sm p-6">
                <h2 className="text-xl font-semibold text-[var(--color-text-primary)] mb-2">
                  <span className="bg-gradient-to-r from-[var(--color-prism-blue)] to-[var(--color-prism-orange)] bg-clip-text text-transparent">
                    Overview
                  </span>
                </h2>
                <div className="grid grid-cols-1 gap-2">
                  <div>
                    <label className="block text-sm font-medium text-[var(--color-text-primary)]">
                      Agent
                    </label>
                    <p className="text-[var(--color-text-accent)]">
                      {callRecord.agent_username || "N/A"}
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--color-text-primary)]">
                      Queue
                    </label>
                    <p className="text-[var(--color-text-accent)]">
                      {callRecord.queue_name || "N/A"}
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--color-text-primary)]">
                      Timestamp
                    </label>
                    <p className="text-[var(--color-text-accent)]">
                      {formatTimestamp(callRecord.initiation_timestamp)}
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--color-text-primary)]">
                      Duration
                    </label>
                    <p className="text-[var(--color-text-accent)]">
                      {formatDuration(callRecord.call_duration)}
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--color-text-primary)]">
                      Disposition
                    </label>
                    <p className="text-[var(--color-text-accent)]">
                      {callRecord.disposition_title || "N/A"}
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--color-text-primary)]">
                      Customer CLI
                    </label>
                    <p className="text-[var(--color-text-accent)]">
                      {callRecord.customer_cli || "N/A"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Call Summary */}
              {callRecord.call_summary && (
                <div className="bg-black/60 rounded-lg shadow-sm p-6">
                  <h2 className="text-xl font-semibold text-[var(--color-text-primary)] mb-4">
                    <span className="bg-gradient-to-r from-[var(--color-prism-blue)] to-[var(--color-prism-orange)] bg-clip-text text-transparent">
                      Summary
                    </span>
                  </h2>
                  <p className="text-neutral-200 leading-relaxed text-sm">
                    {callRecord.call_summary}
                  </p>
                </div>
              )}

              {/* Technical Details */}
              <div className="bg-black/60 rounded-lg shadow-sm p-6">
                <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-3">
                  <span className="bg-gradient-to-r from-[var(--color-prism-blue)] to-[var(--color-prism-orange)] bg-clip-text text-transparent">
                    Technicals
                  </span>
                </h3>
                <div className="space-y-2 text-sm">
                  <div>
                    <label className="block font-medium text-white">
                      Time in Queue
                    </label>
                    <p className="text-neutral-200">
                      {formatDuration(callRecord.time_in_queue)}
                    </p>
                  </div>
                  <div>
                    <label className="block font-medium text-white">
                      Total Hold Time
                    </label>
                    <p className="text-neutral-200">
                      {formatDuration(callRecord.total_hold_time)}
                    </p>
                  </div>
                  <div>
                    <label className="block font-medium text-white">
                      Campaign
                    </label>
                    <p className="text-neutral-200">
                      {callRecord.campaign_name || "N/A"}
                    </p>
                  </div>
                  <div>
                    <label className="block font-medium text-white">
                      Processed At
                    </label>
                    <p className="text-neutral-200">
                      {formatTimestamp(callRecord.processed_at)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Sentiment Analysis */}
              {callRecord.sentiment_analysis &&
                callRecord.sentiment_analysis.length > 0 && (
                  <div className="bg-black/60 rounded-lg shadow-sm p-6">
                    <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">
                      <span className="bg-gradient-to-r from-[var(--color-prism-blue)] to-[var(--color-prism-orange)] bg-clip-text text-transparent">
                        Sentiment Analysis
                      </span>
                    </h3>

                    {(() => {
                      const sentimentData = parseSentimentData(
                        callRecord.sentiment_analysis
                      );
                      const stats = calculateSentimentStats(sentimentData);

                      if (!stats || sentimentData.length === 0) {
                        return (
                          <p className="text-neutral-200 text-sm">
                            No sentiment data available
                          </p>
                        );
                      }

                      return (
                        <div className="space-y-4">
                          {/* Stats Overview */}
                          <div className="grid grid-cols-3 gap-3">
                            <div
                              className={`p-3 rounded-lg border ${getSentimentBgColor(
                                "positive"
                              )}`}
                            >
                              <div className="text-center">
                                <div className="text-green-400 text-xl font-bold">
                                  {stats.positive}
                                </div>
                                <div className="text-green-300 text-xs">
                                  {stats.percentages.positive.toFixed(1)}%
                                </div>
                                <div className="text-neutral-300 text-xs">
                                  Positive
                                </div>
                              </div>
                            </div>

                            <div
                              className={`p-3 rounded-lg border ${getSentimentBgColor(
                                "negative"
                              )}`}
                            >
                              <div className="text-center">
                                <div className="text-red-400 text-xl font-bold">
                                  {stats.negative}
                                </div>
                                <div className="text-red-300 text-xs">
                                  {stats.percentages.negative.toFixed(1)}%
                                </div>
                                <div className="text-neutral-300 text-xs">
                                  Negative
                                </div>
                              </div>
                            </div>

                            <div
                              className={`p-3 rounded-lg border ${getSentimentBgColor(
                                "neutral"
                              )}`}
                            >
                              <div className="text-center">
                                <div className="text-gray-400 text-xl font-bold">
                                  {stats.neutral}
                                </div>
                                <div className="text-gray-300 text-xs">
                                  {stats.percentages.neutral.toFixed(1)}%
                                </div>
                                <div className="text-neutral-300 text-xs">
                                  Neutral
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Sentiments */}
                          <div>
                            <h4 className="text-white font-medium mb-2 text-sm">
                              By Speaker
                            </h4>
                            <div className="space-y-2">
                              {Object.entries(stats.speakers).map(
                                ([speaker, speakerStats]) => (
                                  <div
                                    key={speaker}
                                    className="bg-[var(--color-bg-primary)] rounded-lg p-3"
                                  >
                                    <div className="flex items-center justify-between mb-2">
                                      <span className="text-emerald-400 font-medium text-sm">
                                        Speaker {speaker}
                                      </span>
                                      <span className="text-neutral-400 text-xs">
                                        {speakerStats.total} segments
                                      </span>
                                    </div>
                                    <div className="flex gap-4 text-xs">
                                      <span className="text-green-400">
                                        ✓ {speakerStats.positive}(
                                        {(
                                          (speakerStats.positive /
                                            speakerStats.total) *
                                          100
                                        ).toFixed(0)}
                                        %)
                                      </span>
                                      <span className="text-red-400">
                                        ✗ {speakerStats.negative}(
                                        {(
                                          (speakerStats.negative /
                                            speakerStats.total) *
                                          100
                                        ).toFixed(0)}
                                        %)
                                      </span>
                                      <span className="text-gray-400">
                                        ◯ {speakerStats.neutral}(
                                        {(
                                          (speakerStats.neutral /
                                            speakerStats.total) *
                                          100
                                        ).toFixed(0)}
                                        %)
                                      </span>
                                    </div>
                                  </div>
                                )
                              )}
                            </div>
                          </div>

                          {/* Additional Stuff */}
                          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-neutral-700">
                            <div>
                              <label className="block text-white font-medium text-xs mb-1">
                                Total Segments
                              </label>
                              <p className="text-neutral-200 text-sm">
                                {stats.total}
                              </p>
                            </div>
                            <div>
                              <label className="block text-white font-medium text-xs mb-1">
                                Avg. Confidence
                              </label>
                              <p className="text-neutral-200 text-sm">
                                {(stats.averageConfidence * 100).toFixed(1)}%
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}
            </div>

            {/* Middle Column - Transcript */}
            <div
              className="bg-black/60 rounded-lg shadow-sm p-6 max-h-[calc(100vh-160px)] overflow-y-scroll [&::-webkit-scrollbar]:w-2
  [&::-webkit-scrollbar-track]:rounded-full
  [&::-webkit-scrollbar-track]:bg-gray-100
  [&::-webkit-scrollbar-thumb]:rounded-full
  [&::-webkit-scrollbar-thumb]:bg-gray-300
  dark:[&::-webkit-scrollbar-track]:bg-neutral-700
  dark:[&::-webkit-scrollbar-thumb]:bg-neutral-500"
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-[var(--color-text-primary)]">
                  <span className="bg-gradient-to-r from-[var(--color-prism-blue)] to-[var(--color-prism-orange)] bg-clip-text text-transparent">
                    Transcript
                  </span>
                </h2>
              </div>
              <Transcript
                data={transcriptData}
                showConfidence={false}
                showTimestamps={true}
                showWordDetails={false}
              />
            </div>

            {/* Right Column - Chat Interface */}
            {/* <div className="rounded-lg shadow-sm p-0 flex flex-col max-h-[calc(100vh-160px)]">
              <CallDetailChat
                callRecord={callRecord}
                transcriptData={transcriptData}
              />
            </div> */}
        {/* Modal */}
        <div className="fixed right-4 bottom-4">
          <button
            className="w-12 h-12 rounded-full bg-black flex items-center justify-center hover:scale-110 active:scale-90 cursor-pointer transition"
            onClick={() => setShowChat(!showChat)}
          >
            <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
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
          </button>
        </div>
        {showChat && (
          <div className="fixed bottom-18 right-4 w-[30vw] min-w-[360px] max-w-[640px] h-[90vh] bg-gradient-to-r from-[var(--color-prism-blue)] to-[var(--color-prism-orange)] p-[2px] rounded-lg">
            <div className="w-full h-full bg-[var(--color-bg-primary)] rounded-lg">
              <CallDetailChat
                callRecord={callRecord}
                transcriptData={transcriptData}
              />
            </div>
          </div>
        )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CallLogPage;
