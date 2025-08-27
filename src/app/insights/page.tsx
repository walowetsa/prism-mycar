"use client";

import { useState, useEffect, useCallback } from "react";
import CallRecord from "@/types/CallRecord";
import CallLogFilters, {
  FilterPeriod,
} from "../../components/ui/CallLogFilters";
import InsightsStatsDashboard from "../../components/dashboards/InsightsStatsDashboard";
import CallRecordsChat from "../../components/ai/CallRecordsChat";

const InsightsPage = () => {
  const [callRecords, setCallRecords] = useState<CallRecord[]>([]);
  const [allRecordsCount, setAllRecordsCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showChat, setShowChat] = useState(false);

  // Filter states
  const [filterPeriod, setFilterPeriod] = useState<FilterPeriod>("all");
  const [selectedAgent, setSelectedAgent] = useState<string>("");
  const [selectedDispositions, setSelectedDispositions] = useState<string[]>(
    []
  );
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");

  // Filter options loaded separately
  const [uniqueAgents, setUniqueAgents] = useState<string[]>([]);
  const [uniqueDispositions, setUniqueDispositions] = useState<string[]>([]);
  const [filtersLoading, setFiltersLoading] = useState(true);

  // Fetch filtered records for insights - we'll get more records for better insights
  const fetchCallRecords = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // For insights, we want to fetch more records to get better statistics
      // We'll use a higher limit but still benefit from server-side filtering
      const params = new URLSearchParams({
        page: "1",
        limit: "99999", // Get more records for insights analysis
        filterPeriod,
        ...(selectedAgent && { agent: selectedAgent }),
        ...(selectedDispositions.length > 0 && {
          dispositions: selectedDispositions.join(","),
        }),
        ...(startDate && { startDate }),
        ...(endDate && { endDate }),
        sortField: "initiation_timestamp",
        sortDirection: "desc",
      });

      const response = await fetch(`/api/supabase/call-logs?${params}`);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();

      if (result.error) {
        throw new Error(result.error);
      }

      setCallRecords(result.data || []);
      setAllRecordsCount(result.pagination.total || 0);
    } catch (err) {
      console.error("Error fetching call records:", err);
      setError(
        err instanceof Error ? err.message : "Failed to fetch call records"
      );
    } finally {
      setLoading(false);
    }
  }, [filterPeriod, selectedAgent, selectedDispositions, startDate, endDate]);

  // Fetch filter options efficiently
  const fetchFilterOptions = useCallback(async () => {
    try {
      setFiltersLoading(true);

      // Fetch agents and dispositions in parallel
      const [agentsResponse, dispositionsResponse] = await Promise.all([
        fetch("/api/supabase/call-logs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "agents" }),
        }),
        fetch("/api/supabase/call-logs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "dispositions" }),
        }),
      ]);

      if (agentsResponse.ok) {
        const agentsResult = await agentsResponse.json();
        setUniqueAgents(agentsResult.data || []);
      }

      if (dispositionsResponse.ok) {
        const dispositionsResult = await dispositionsResponse.json();
        setUniqueDispositions(dispositionsResult.data || []);
      }
    } catch (error) {
      console.error("Error fetching filter options:", error);
    } finally {
      setFiltersLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchFilterOptions();
  }, [fetchFilterOptions]);

  // Fetch records when filters change
  useEffect(() => {
    if (!filtersLoading) {
      fetchCallRecords();
    }
  }, [
    filterPeriod,
    selectedAgent,
    selectedDispositions,
    startDate,
    endDate,
    fetchCallRecords,
    filtersLoading,
  ]);

  // Initialize default dates when dateRange is selected
  useEffect(() => {
    if (filterPeriod === "dateRange" && !startDate && !endDate) {
      const today = new Date();
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      setStartDate(sevenDaysAgo.toISOString().split("T")[0]);
      setEndDate(today.toISOString().split("T")[0]);
    }
  }, [filterPeriod, startDate, endDate]);

  const handleFilterChange = (filter: FilterPeriod) => {
    setFilterPeriod(filter);

    if (filter !== "dateRange") {
      setStartDate("");
      setEndDate("");
    }
  };

  const handleAgentChange = (agent: string) => {
    setSelectedAgent(agent);
  };

  const handleDispositionsChange = (dispositions: string[]) => {
    setSelectedDispositions(dispositions);
  };

  const handleStartDateChange = (date: string) => {
    setStartDate(date);
  };

  const handleEndDateChange = (date: string) => {
    setEndDate(date);
  };

  const handleRefresh = async () => {
    await fetchFilterOptions();
    await fetchCallRecords();
  };

  if (error) {
    return (
      <div className="flex-1 p-4">
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <div className="text-red-800">
            <strong>Error:</strong> {error}
          </div>
          <button
            onClick={handleRefresh}
            className="mt-2 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col p-4 ">
      <div className="mb-4 flex flex-col gap-4">
        <div className="flex">
          <CallLogFilters
            selectedFilter={filterPeriod}
            onFilterChange={handleFilterChange}
            selectedAgent={selectedAgent}
            onAgentChange={handleAgentChange}
            agents={uniqueAgents}
            selectedDispositions={selectedDispositions}
            onDispositionsChange={handleDispositionsChange}
            dispositions={uniqueDispositions}
            startDate={startDate}
            endDate={endDate}
            onStartDateChange={handleStartDateChange}
            onEndDateChange={handleEndDateChange}
            onRefresh={handleRefresh}
            disabled={loading || filtersLoading}
          />
        </div>
      </div>

      <div className="flex gap-x-4">
        <div className="flex-1">
          <InsightsStatsDashboard
            filteredRecords={callRecords}
            totalRecords={allRecordsCount}
            loading={loading}
          />
        </div>
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
            <div className="w-full h-full bg-black rounded-lg">
              <CallRecordsChat
                filteredRecords={callRecords}
                totalRecords={allRecordsCount}
                loading={loading}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default InsightsPage;
