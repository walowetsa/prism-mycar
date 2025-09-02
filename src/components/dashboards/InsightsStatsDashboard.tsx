import { useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
} from "recharts";
import CallRecord from "@/types/CallRecord";
import Image from "next/image";
import Loader from '../../../public/prism-loader.gif'

interface InsightsStatsDashboardProps {
  filteredRecords: CallRecord[];
  totalRecords: number;
  loading: boolean;
}

const InsightsStatsDashboard: React.FC<InsightsStatsDashboardProps> = ({
  filteredRecords,
  loading,
}) => {
  const successfulOutcomes = [
    "Sale - MTF Booking",
    "Sale - Pre Purchase Inspection",
    "Sale - Price Beat Booking",
    "Sale - Strip & Fit Booking",
    "Sale - Tyre Booking",
  ];

  // calc stats
  const statistics = useMemo(() => {
    const totalCalls = filteredRecords.length;
    const successfulCalls: number = filteredRecords.filter(
      (record) =>
        record.disposition_title &&
        successfulOutcomes.includes(record.disposition_title)
    ).length;

    const successRate =
      totalCalls > 0 ? (successfulCalls / totalCalls) * 100 : 0;

    const validDurations = filteredRecords
      .map((record) => {
        if (!record.call_duration) return null;
        try {
          let parsedDuration: { minutes?: number; seconds: number };
          if (typeof record.call_duration === "string") {
            parsedDuration = JSON.parse(record.call_duration);
          } else {
            parsedDuration = record.call_duration;
          }

          const { seconds, minutes = 0 } = parsedDuration;

          if (typeof seconds !== "number" || seconds < 0) {
            return null;
          }

          if (
            minutes !== undefined &&
            (typeof minutes !== "number" || minutes < 0)
          ) {
            return null;
          }

          return minutes * 60 + seconds;
        } catch {
          return null;
        }
      })
      .filter((duration) => duration !== null) as number[];

    const averageDurationSeconds =
      validDurations.length > 0
        ? validDurations.reduce((sum, duration) => sum + duration, 0) /
          validDurations.length
        : 0;

    const callsByAgent = filteredRecords.reduce((acc, record) => {
      const agent = record.agent_username || "Unknown";
      acc[agent] = (acc[agent] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const dispositionCounts = filteredRecords.reduce((acc, record) => {
      const disposition = record.disposition_title || "Unknown";
      acc[disposition] = (acc[disposition] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const topDispositions = Object.entries(dispositionCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5);

    const mtfNoSaleDispositions = [
      "No Sale - MTF - Out of Zone",
      "No Sale - MTF - Same Day Request", 
      "No Sale - MTF - Saturday Request",
      "No Sale - MTF - Van Availability"
    ];

    const ppiNoSaleDispositions = [
      "No Sale - PPI - Out of Zone",
      "No Sale - PPI - Same Day Request", 
      "No Sale - PPI - Saturday Request",
      "No Sale - PPI - Van Availability"
    ];

    const mtfNoSaleCounts = mtfNoSaleDispositions.map(disposition => [
      disposition,
      dispositionCounts[disposition] || 0
    ] as [string, number]).filter(([, count]) => count > 0);

     const ppiNoSaleCounts = ppiNoSaleDispositions.map(disposition => [
      disposition,
      dispositionCounts[disposition] || 0
    ] as [string, number]).filter(([, count]) => count > 0);

const otherNoSaleDispositions = Object.entries(dispositionCounts)
      .filter(([disposition, count]) => {
        return disposition.toLowerCase().includes('no sale') && 
               !disposition.toLowerCase().includes('mtf') && 
               !disposition.toLowerCase().includes('ppi') &&
               count > 0;
      })
      .map(([disposition, count], index, array) => {
        // Calculate gradient color based on position
        const ratio = array.length > 1 ? index / (array.length - 1) : 0;
        const interpolateColor = (start: string, end: string, factor: number) => {
          const startRgb = hexToRgb(start);
          const endRgb = hexToRgb(end);
          if (!startRgb || !endRgb) return start;
          
          const r = Math.round(startRgb.r + factor * (endRgb.r - startRgb.r));
          const g = Math.round(startRgb.g + factor * (endRgb.g - startRgb.g));
          const b = Math.round(startRgb.b + factor * (endRgb.b - startRgb.b));
          
          return `rgb(${r}, ${g}, ${b})`;
        };
        
        const hexToRgb = (hex: string) => {
          const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
          return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
          } : null;
        };
        
        // Using the prism blue to orange gradient colors
        const color = interpolateColor('#2059fd', '#ee5825', ratio);
        
        return {
          name: disposition,
          count: count,
          color: color
        };
      });

    const dailyCallVolume = filteredRecords.reduce((acc, record) => {
      if (!record.initiation_timestamp) return acc;

      const date = new Date(record.initiation_timestamp).toLocaleDateString(
        "en-US",
        {
          month: "short",
          day: "numeric",
        }
      );

      acc[date] = (acc[date] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const dailyVolumeData = Object.entries(dailyCallVolume)
      .map(([date, calls]) => ({ date, calls }))
      .sort(
        (a, b) =>
          new Date(a.date + ", 2024").getTime() -
          new Date(b.date + ", 2024").getTime()
      );

    const sentimentCounts = { POSITIVE: 0, NEUTRAL: 0, NEGATIVE: 0 };

    filteredRecords.forEach((record) => {
      if (!record.sentiment_analysis) return;

      try {
        let sentimentArray;
        if (typeof record.sentiment_analysis === "string") {
          sentimentArray = JSON.parse(record.sentiment_analysis);
        } else {
          sentimentArray = record.sentiment_analysis;
        }

        if (Array.isArray(sentimentArray)) {
          sentimentArray.forEach((item) => {
            if (
              item.sentiment &&
              sentimentCounts.hasOwnProperty(item.sentiment)
            ) {
              sentimentCounts[item.sentiment as keyof typeof sentimentCounts]++;
            }
          });
        }
        //     // TODO: fix data type issues (15/07)

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (error) {
        // Skip records with  sentiment_analysis format
      }
    });

    const sentimentData = [
      { name: "Positive", count: sentimentCounts.POSITIVE, color: "#065f46" },
      { name: "Neutral", count: sentimentCounts.NEUTRAL, color: "#67676a" },
      { name: "Negative", count: sentimentCounts.NEGATIVE, color: "#dc2626" },
    ];

    return {
      totalCalls,
      successfulCalls,
      successRate,
      averageDurationSeconds,
      callsByAgent,
      topDispositions,
      mtfNoSaleCounts,
      ppiNoSaleCounts,
      otherNoSaleDispositions,
      dailyVolumeData,
      sentimentData,
    };
  }, [filteredRecords, successfulOutcomes]);

  const formatDuration = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    if (minutes === 0) {
      return `${remainingSeconds}s`;
    }
    return `${minutes}m ${remainingSeconds}s`;
  };

  const formatPercentage = (value: number): string => {
    return `${value.toFixed(1)}%`;
  };

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <div className="text-gray-600">Loading insights...</div>
                <Image src={Loader} alt={"loading-icon"} width={480} height={480}/>
      </div>
    );
  }

  return (
    <div
      className="flex-1 p-4 space-y-6 max-h-[calc(100vh-160px)] overflow-y-scroll  [&::-webkit-scrollbar]:w-2
  [&::-webkit-scrollbar-track]:rounded-full
  [&::-webkit-scrollbar-track]:bg-gray-100
  [&::-webkit-scrollbar-thumb]:rounded-full
  [&::-webkit-scrollbar-thumb]:bg-gray-300
  dark:[&::-webkit-scrollbar-track]:bg-neutral-700
  dark:[&::-webkit-scrollbar-thumb]:bg-neutral-500"
    >
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-black/60 p-6 rounded-lg shadow-sm">
          <div className="text-2xl font-bold text-[var(--color-text-primary)]">
            {statistics.totalCalls}
          </div>
          <div>
            <span className="text-sm font-semibold tracking-wide bg-gradient-to-r from-[var(--color-prism-blue)] to-[var(--color-prism-orange)] bg-clip-text text-transparent">
              Total Calls
            </span>
          </div>
        </div>

        <div className="bg-black/60 p-6 rounded-lg shadow-sm">
          <div className="text-2xl font-bold text-[var(--color-text-primary)]">
            {statistics.successfulCalls}
          </div>
          <div className="text-sm text-neutral-200">
            <span className="text-sm font-semibold tracking-wide bg-gradient-to-r from-[var(--color-prism-blue)] to-[var(--color-prism-orange)] bg-clip-text text-transparent">
              Sales
            </span>
          </div>
        </div>

        <div className="bg-black/60 p-6 rounded-lg shadow-sm">
          <div className="text-2xl font-bold text-[var(--color-text-primary)]">
            {formatPercentage(statistics.successRate)}
          </div>
          <div className="text-sm text-neutral-200">
            <span className="text-sm font-semibold tracking-wide bg-gradient-to-r from-[var(--color-prism-blue)] to-[var(--color-prism-orange)] bg-clip-text text-transparent">
              Sales Rate
            </span>
          </div>
        </div>

        <div className="bg-black/60 p-6 rounded-lg shadow-sm">
          <div className="text-2xl font-bold text-[var(--color-text-primary)]">
            {formatDuration(statistics.averageDurationSeconds)}
          </div>
          <div className="text-sm text-neutral-200">
            <span className="text-sm font-semibold tracking-wide bg-gradient-to-r from-[var(--color-prism-blue)] to-[var(--color-prism-orange)] bg-clip-text text-transparent">
              Avg. Handle Time
            </span>
          </div>
        </div>
      </div>

      {/* charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-black/60 p-6 rounded-lg shadow-sm">
          <h3 className="text-lg font-semibold mb-4">
            <span className="tracking-wide bg-gradient-to-r from-[var(--color-prism-blue)] to-[var(--color-prism-orange)] bg-clip-text text-transparent">
              Calls by Agent
            </span>
          </h3>
          <div className="space-y-3">
            {Object.entries(statistics.callsByAgent)
              .sort(([, a], [, b]) => b - a)
              .slice(0, 5)
              .map(([agent, count]) => (
                <div key={agent} className="flex items-center justify-between">
                  <span className="text-sm text-neutral-200 truncate flex-1 mr-2">
                    {agent}
                  </span>
                  <div className="flex items-center gap-2">
                    <div
                      className="bg-gradient-to-r from-[var(--color-prism-blue)] to-[var(--color-prism-orange)] h-2 rounded"
                      style={{
                        width: `${Math.max(
                          (count /
                            Math.max(
                              ...Object.values(statistics.callsByAgent)
                            )) *
                            100,
                          5
                        )}px`,
                        minWidth: "20px",
                      }}
                    ></div>
                    <span className="text-sm font-medium text-neutral-200 w-8 text-right">
                      {count}
                    </span>
                  </div>
                </div>
              ))}
          </div>
        </div>

        <div className="bg-black/60 p-6 rounded-lg shadow-sm">
          <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">
            <span className="tracking-wide bg-gradient-to-r from-[var(--color-prism-blue)] to-[var(--color-prism-orange)] bg-clip-text text-transparent">
              Top Dispositions
            </span>
          </h3>
          <div className="space-y-3">
            {statistics.topDispositions.map(([disposition, count]) => (
              <div
                key={disposition}
                className="flex items-center justify-between"
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span
                    className="text-sm text-neutral-200 truncate"
                    title={disposition}
                  >
                    {disposition}
                  </span>
                  {successfulOutcomes.includes(disposition) && (
                    <span className="text-[var(--color-text-primary)] text-sm">
                      ✓
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-2">
                  <div
                    className="bg-gradient-to-r from-[var(--color-prism-blue)] to-[var(--color-prism-orange)] h-2 rounded"
                    style={{
                      width: `${Math.max(
                        (count / statistics.topDispositions[0][1]) * 100,
                        5
                      )}px`,
                      minWidth: "20px",
                    }}
                  ></div>
                  <span className="text-sm font-medium text-neutral-200 w-8 text-right">
                    {count}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {statistics.dailyVolumeData.length > 0 && (
        <div className="bg-black/60 p-6 rounded-lg shadow-sm">
          <h3 className="text-lg font-semibold text-neutral-200 mb-4">
            <span className="tracking-wide bg-gradient-to-r from-[var(--color-prism-blue)] to-[var(--color-prism-orange)] bg-clip-text text-transparent">
              Daily Call Volume
            </span>
          </h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={statistics.dailyVolumeData}>
                <defs>
                  {/* Line gradient */}
                  <linearGradient
                    id="lineGradient"
                    x1="0%"
                    y1="0%"
                    x2="100%"
                    y2="0%"
                  >
                    <stop offset="0%" stopColor="var(--color-prism-blue)" />
                    <stop offset="100%" stopColor="var(--color-prism-orange)" />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="date" stroke="#d1d5db" fontSize={12} />
                <YAxis stroke="#d1d5db" fontSize={12} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#000",
                    border: "1px solid #d1d5db",
                    borderRadius: "8px",
                    color: "#d1d5db",
                  }}
                  labelStyle={{ color: "#d1d5db" }}
                />
                <Line
                  type="monotone"
                  dataKey="calls"
                  stroke="url(#lineGradient)"
                  strokeWidth={2}
                  dot={{ fill: "#d1d5db", strokeWidth: 0, r: 0 }}
                  activeDot={{ r: 0, fill: "#d1d5db" }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {statistics.mtfNoSaleCounts.length > 0 && (
        <div className="bg-black/60 p-6 rounded-lg shadow-sm">
          <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">
            <span className="tracking-wide bg-gradient-to-r from-[var(--color-prism-blue)] to-[var(--color-prism-orange)] bg-clip-text text-transparent">
              No Sale - MTF
            </span>
          </h3>
          <div className="space-y-3">
            {statistics.mtfNoSaleCounts.map(([disposition, count]) => (
              <div
                key={disposition}
                className="flex items-center justify-between"
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span
                    className="text-sm text-neutral-200 truncate"
                    title={disposition}
                  >
                    {disposition}
                  </span>
                </div>
                <div className="flex items-center gap-2 ml-2">
                  <div
                    className="bg-gradient-to-r from-[var(--color-prism-blue)] to-[var(--color-prism-orange)] h-2 rounded"
                    style={{
                      width: `${Math.max(
                        (count / Math.max(...statistics.mtfNoSaleCounts.map(([, c]) => c))) * 100,
                        5
                      )}px`,
                      minWidth: "20px",
                    }}
                  ></div>
                  <span className="text-sm font-medium text-neutral-200 w-8 text-right">
                    {count}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {statistics.ppiNoSaleCounts.length > 0 && (
        <div className="bg-black/60 p-6 rounded-lg shadow-sm">
          <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">
            <span className="tracking-wide bg-gradient-to-r from-[var(--color-prism-blue)] to-[var(--color-prism-orange)] bg-clip-text text-transparent">
              No Sale - PII
            </span>
          </h3>
          <div className="space-y-3">
            {statistics.ppiNoSaleCounts.map(([disposition, count]) => (
              <div
                key={disposition}
                className="flex items-center justify-between"
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span
                    className="text-sm text-neutral-200 truncate"
                    title={disposition}
                  >
                    {disposition}
                  </span>
                </div>
                <div className="flex items-center gap-2 ml-2">
                  <div
                    className="bg-gradient-to-r from-[var(--color-prism-blue)] to-[var(--color-prism-orange)] h-2 rounded"
                    style={{
                      width: `${Math.max(
                        (count / Math.max(...statistics.ppiNoSaleCounts.map(([, c]) => c))) * 100,
                        5
                      )}px`,
                      minWidth: "20px",
                    }}
                  ></div>
                  <span className="text-sm font-medium text-neutral-200 w-8 text-right">
                    {count}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
</div>{statistics.otherNoSaleDispositions.length > 0 && (
        <div className="bg-black/60 p-6 rounded-lg shadow-sm">
          <h3 className="text-lg font-semibold text-neutral-200 mb-4">
            <span className="tracking-wide bg-gradient-to-r from-[var(--color-prism-blue)] to-[var(--color-prism-orange)] bg-clip-text text-transparent">
              Other No Sale Dispositions
            </span>
          </h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={statistics.otherNoSaleDispositions}
                margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis 
                  dataKey="name" 
                  stroke="#d1d5db" 
                  fontSize={8}
                  angle={45}
                  textAnchor="start"
                  height={100}
                />
                <YAxis stroke="#d1d5db" fontSize={12} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#000",
                    border: "1px solid #d1d5db",
                    borderRadius: "8px",
                    color: "#d1d5db",
                  }}
                  labelStyle={{ color: "#d1d5db" }}
                  formatter={(value: number) => [value, "Call Count"]}
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {statistics.otherNoSaleDispositions.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}


      {statistics.sentimentData.some((item) => item.count > 0) && (
        <div className="bg-black/60 p-6 rounded-lg shadow-sm">
          <h3 className="text-lg font-semibold text-neutral-200 mb-4">
            <span className="tracking-wide bg-gradient-to-r from-[var(--color-prism-blue)] to-[var(--color-prism-orange)] bg-clip-text text-transparent">
              Call Analysis Sentiment
            </span>
          </h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={statistics.sentimentData}
                margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="name" stroke="#d1d5db" fontSize={12} />
                <YAxis stroke="#d1d5db" fontSize={12} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#000",
                    border: "1px solid #d1d5db",
                    borderRadius: "8px",
                    color: "#d1d5db",
                  }}
                  labelStyle={{ color: "#d1d5db" }}
                  formatter={(value: number) => [value, "Sentiment Instances"]}
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {statistics.sentimentData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-4 flex justify-center gap-6">
            {statistics.sentimentData.map((item) => (
              <div key={item.name} className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded"
                  style={{ backgroundColor: item.color }}
                ></div>
                <span className="text-sm text-neutral-200">
                  {item.name}:{" "}
                  {(
                    (Math.floor(item.count) /
                      (statistics.sentimentData[0].count +
                        statistics.sentimentData[1].count +
                        statistics.sentimentData[2].count)) *
                    100
                  ).toFixed(2)}
                  %
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default InsightsStatsDashboard;