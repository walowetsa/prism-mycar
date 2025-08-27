/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import CallRecord from "@/types/CallRecord";

// Cache for common analytics to reduce API calls
interface CacheEntry {
  data: any;
  timestamp: number;
  ttl: number;
}

class AnalyticsCache {
  private cache = new Map<string, CacheEntry>();
  private maxSize = 100;

  generateKey(records: CallRecord[], queryType: string): string {
    // hash key (kinda) based on record count, date range, and query type
    const recordIds = records
      .slice(0, 10)
      .map((r) => r.id)
      .join(",");

    const dateRange =
      records.length > 0
        ? `${records[0]?.initiation_timestamp || "null"}-${
            records[records.length - 1]?.initiation_timestamp || "null"
          }`
        : "empty";

    return `${queryType}-${records.length}-${recordIds}-${dateRange}`.substring(
      0,
      100
    );
  }

  get(key: string): any | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.timestamp + entry.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  set(key: string, data: any, ttlMinutes = 5): void {
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey!);
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl: ttlMinutes * 60 * 1000,
    });
  }

  clear(): void {
    this.cache.clear();
  }
}

export const analyticsCache = new AnalyticsCache();

export class CallAnalytics {
  static getDurationInSeconds(
    duration: { minutes: number; seconds: number } | null
  ): number {
    if (!duration) return 0;
    return duration.minutes * 60 + duration.seconds;
  }

  static calculatePerformanceMetrics(records: CallRecord[]) {
    const totalCalls = records.length;
    if (totalCalls === 0) return null;

    const getDurationInSeconds = (
      duration: { minutes: number; seconds: number } | null
    ): number => {
      if (!duration) return 0;
      return duration.minutes * 60 + duration.seconds;
    };

    const durations = records.map((r) => getDurationInSeconds(r.call_duration));
    const holdTimes = records.map((r) =>
      getDurationInSeconds(r.total_hold_time)
    );
    const queueTimes = records.map((r) =>
      getDurationInSeconds(r.time_in_queue)
    );

    return {
      totalCalls,
      avgDuration: durations.reduce((a, b) => a + b, 0) / totalCalls,
      medianDuration: CallAnalytics.median(durations),
      avgHoldTime: holdTimes.reduce((a, b) => a + b, 0) / totalCalls,
      avgQueueTime: queueTimes.reduce((a, b) => a + b, 0) / totalCalls,
      shortCalls: durations.filter((d) => d < 180).length, // < 3 minutes
      longCalls: durations.filter((d) => d > 900).length, // > 15 minutes
      percentile90Duration: CallAnalytics.percentile(durations, 90),
      percentile95Duration: CallAnalytics.percentile(durations, 95),
    };
  }

  static analyseAgentEfficiency(records: CallRecord[]) {
    const agentMap = new Map<
      string,
      {
        calls: CallRecord[];
        totalDuration: number;
        totalHoldTime: number;
        resolutions: number;
        avgSentiment: number;
      }
    >();

    records.forEach((record) => {
      const agent = record.agent_username || "Unknown";
      if (!agentMap.has(agent)) {
        agentMap.set(agent, {
          calls: [],
          totalDuration: 0,
          totalHoldTime: 0,
          resolutions: 0,
          avgSentiment: 0,
        });
      }

      const agentData = agentMap.get(agent)!;
      agentData.calls.push(record);
      agentData.totalDuration += CallAnalytics.getDurationInSeconds(
        record.call_duration
      );
      agentData.totalHoldTime += CallAnalytics.getDurationInSeconds(
        record.total_hold_time
      );

      if (
        record.disposition_title &&
        !["Abandoned", "No Answer", "Busy"].includes(record.disposition_title)
      ) {
        agentData.resolutions++;
      }
    });

    return Array.from(agentMap.entries())
      .map(([agent, data]) => {
        const avgCallDuration = data.totalDuration / data.calls.length;
        const resolutionRate = data.resolutions / data.calls.length;
        const avgHoldTime = data.totalHoldTime / data.calls.length;

        const efficiencyScore =
          resolutionRate * 100 - avgCallDuration / 60 - avgHoldTime / 30;

        return {
          agent,
          callCount: data.calls.length,
          avgCallDuration,
          resolutionRate,
          avgHoldTime,
          efficiencyScore: Math.max(0, Math.min(100, efficiencyScore)),
        };
      })
      .sort((a, b) => b.efficiencyScore - a.efficiencyScore);
  }

  static analyseTrends(
    records: CallRecord[],
    groupBy: "hour" | "day" | "week" = "day"
  ) {
    const trends = new Map<
      string,
      {
        count: number;
        totalDuration: number;
        avgSentiment: number;
        resolutions: number;
      }
    >();

    records.forEach((record) => {
      if (!record.initiation_timestamp) return;

      const date = new Date(record.initiation_timestamp);
      let key: string;

      switch (groupBy) {
        case "hour":
          key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}`;
          break;
        case "week":
          const weekStart = new Date(date);
          weekStart.setDate(date.getDate() - date.getDay());
          key = weekStart.toISOString().split("T")[0];
          break;
        default:
          key = date.toISOString().split("T")[0];
      }

      if (!trends.has(key)) {
        trends.set(key, {
          count: 0,
          totalDuration: 0,
          avgSentiment: 0,
          resolutions: 0,
        });
      }

      const trend = trends.get(key)!;
      trend.count++;
      trend.totalDuration += CallAnalytics.getDurationInSeconds(
        record.call_duration
      );

      if (
        record.disposition_title &&
        !["Abandoned", "No Answer", "Busy"].includes(record.disposition_title)
      ) {
        trend.resolutions++;
      }
    });

    return Array.from(trends.entries())
      .map(([period, data]) => ({
        period,
        callVolume: data.count,
        avgDuration: data.totalDuration / data.count,
        resolutionRate: data.resolutions / data.count,
        efficiency:
          (data.resolutions / data.count) *
          (300 / (data.totalDuration / data.count)),
      }))
      .sort((a, b) => a.period.localeCompare(b.period));
  }

  static findAnomalies(records: CallRecord[]) {
    const anomalies: Array<{
      type: string;
      description: string;
      severity: "low" | "medium" | "high";
      count: number;
    }> = [];

    const metrics = this.calculatePerformanceMetrics(records);
    if (!metrics) return anomalies;

    const longCalls = records.filter(
      (r) =>
        CallAnalytics.getDurationInSeconds(r.call_duration) >
        metrics.percentile95Duration
    );
    if (longCalls.length > records.length * 0.02) {
      anomalies.push({
        type: "duration",
        description: `${
          longCalls.length
        } calls exceed 95th percentile duration (${Math.round(
          metrics.percentile95Duration / 60
        )} min)`,
        severity: longCalls.length > records.length * 0.05 ? "high" : "medium",
        count: longCalls.length,
      });
    }

    const highHoldCalls = records.filter(
      (r) =>
        CallAnalytics.getDurationInSeconds(r.total_hold_time) >
        metrics.avgHoldTime * 3
    );
    if (highHoldCalls.length > 0) {
      anomalies.push({
        type: "hold_time",
        description: `${
          highHoldCalls.length
        } calls with excessive hold time (>${Math.round(
          (metrics.avgHoldTime * 3) / 60
        )} min)`,
        severity:
          highHoldCalls.length > records.length * 0.1 ? "high" : "medium",
        count: highHoldCalls.length,
      });
    }

    const agentCounts = new Map<string, number>();
    records.forEach((r) => {
      const agent = r.agent_username || "Unknown";
      agentCounts.set(agent, (agentCounts.get(agent) || 0) + 1);
    });

    const avgCallsPerAgent = records.length / agentCounts.size;
    const overloadedAgents = Array.from(agentCounts.entries()).filter(
      ([, count]) => count > avgCallsPerAgent * 2
    );

    if (overloadedAgents.length > 0) {
      anomalies.push({
        type: "workload",
        description: `${overloadedAgents.length} agents handling 2x average call volume`,
        severity: "medium",
        count: overloadedAgents.length,
      });
    }

    return anomalies;
  }

  static median(numbers: number[]): number {
    const sorted = [...numbers].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[middle];
  }

  static percentile(numbers: number[], p: number): number {
    const sorted = [...numbers].sort((a, b) => a - b);
    const index = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;

    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  }
}

// query helper optimisation
export const QueryOptimizer = {
  needsRealTimeProcessing(query: string): boolean {
    const realTimeKeywords = [
      "now",
      "current",
      "today",
      "latest",
      "real-time",
      "live",
    ];
    return realTimeKeywords.some((keyword) =>
      query.toLowerCase().includes(keyword)
    );
  },

  estimateComplexity(
    query: string,
    recordCount: number
  ): "simple" | "medium" | "complex" {
    const complexKeywords = [
      "analyse",
      "compare",
      "trend",
      "pattern",
      "correlation",
      "deep dive",
    ];
    const complexCount = complexKeywords.filter((keyword) =>
      query.toLowerCase().includes(keyword)
    ).length;

    if (complexCount >= 2 || recordCount > 1000) return "complex";
    if (complexCount >= 1 || recordCount > 100) return "medium";
    return "simple";
  },

  suggestFollowUp(queryType: string, results: any): string[] {
    const suggestions: Record<string, string[]> = {
      disposition: [
        "Which agents have the best resolution rates?",
        "How do disposition rates vary by time of day?",
        "What's the correlation between call duration and disposition?",
      ],
      agent_performance: [
        "Show me sentiment trends for top performers",
        "What training topics should we focus on?",
        "How does performance vary by queue?",
      ],
      sentiment: [
        "Which call topics generate negative sentiment?",
        "How does sentiment correlate with call duration?",
        "What's our sentiment trend over the last month?",
      ],
      timing: [
        "Which queues have the longest wait times?",
        "How can we optimize our staffing schedule?",
        "What's causing our longest calls?",
      ],
    };

    return (
      suggestions[queryType] || [
        "Show me an executive summary",
        "What are our biggest improvement opportunities?",
        "How does this compare to last month?",
      ]
    );
  },
};

export default CallAnalytics;
