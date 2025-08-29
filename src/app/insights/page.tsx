"use client";

import { useState, useEffect, useCallback } from "react";
import CallRecord from "@/types/CallRecord";
import CallLogFilters, {
  FilterPeriod,
} from "../../components/ui/CallLogFilters";
import InsightsStatsDashboard from "../../components/dashboards/InsightsStatsDashboard";
import CallRecordsChat from "../../components/ai/CallRecordsChat";

interface LoadingState {
  isLoading: boolean;
  currentBatch: number;
  totalBatches: number;
  recordsLoaded: number;
  totalRecords: number;
}

const BATCH_SIZE = 2000; // Smaller batch size to avoid timeouts
const MAX_RECORDS_FOR_INSIGHTS = 20000; // Cap for insights analysis

const InsightsPage = () => {
  const [callRecords, setCallRecords] = useState<CallRecord[]>([]);
  const [allRecordsCount, setAllRecordsCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showChat, setShowChat] = useState(false);
  
  // Enhanced loading state for incremental loading
  const [loadingState, setLoadingState] = useState<LoadingState>({
    isLoading: false,
    currentBatch: 0,
    totalBatches: 0,
    recordsLoaded: 0,
    totalRecords: 0,
  });

  // Filter states
  const [filterPeriod, setFilterPeriod] = useState<FilterPeriod>("all");
  const [selectedAgent, setSelectedAgent] = useState<string>("");
  const [selectedDispositions, setSelectedDispositions] = useState<string[]>([]);
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");

  // Filter options loaded separately
  const [uniqueAgents, setUniqueAgents] = useState<string[]>([]);
  const [uniqueDispositions, setUniqueDispositions] = useState<string[]>([]);
  const [filtersLoading, setFiltersLoading] = useState(true);

  // Fetch records incrementally in batches
  const fetchCallRecordsIncrementally = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setCallRecords([]); // Clear existing records
      
      // First, get the total count with a lightweight query
      const countParams = new URLSearchParams({
        page: "1",
        limit: "1", // Just get count
        filterPeriod,
        countOnly: "true",
        ...(selectedAgent && { agent: selectedAgent }),
        ...(selectedDispositions.length > 0 && {
          dispositions: selectedDispositions.join(","),
        }),
        ...(startDate && { startDate }),
        ...(endDate && { endDate }),
      });

      const countResponse = await fetch(`/api/supabase/call-logs?${countParams}`);
      
      if (!countResponse.ok) {
        throw new Error(`HTTP error! status: ${countResponse.status}`);
      }

      const countResult = await countResponse.json();
      const totalRecords = countResult.pagination?.total || 0;
      
      setAllRecordsCount(totalRecords);
      
      if (totalRecords === 0) {
        setLoading(false);
        return;
      }

      // Calculate how many records to actually fetch (cap at MAX_RECORDS_FOR_INSIGHTS)
      const recordsToFetch = Math.min(totalRecords, MAX_RECORDS_FOR_INSIGHTS);
      const totalBatches = Math.ceil(recordsToFetch / BATCH_SIZE);
      
      setLoadingState({
        isLoading: true,
        currentBatch: 0,
        totalBatches,
        recordsLoaded: 0,
        totalRecords: recordsToFetch,
      });

      const allRecords: CallRecord[] = [];
      
      // Fetch records in batches
      for (let batch = 1; batch <= totalBatches; batch++) {
        setLoadingState(prev => ({
          ...prev,
          currentBatch: batch,
        }));

        const params = new URLSearchParams({
          page: batch.toString(),
          limit: BATCH_SIZE.toString(),
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

        const batchRecords = result.data || [];
        allRecords.push(...batchRecords);
        
        // Update records incrementally for better UX
        setCallRecords([...allRecords]);
        setLoadingState(prev => ({
          ...prev,
          recordsLoaded: allRecords.length,
        }));

        // Small delay to prevent overwhelming the database
        if (batch < totalBatches) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Break if we've hit our cap or no more records
        if (allRecords.length >= MAX_RECORDS_FOR_INSIGHTS || batchRecords.length < BATCH_SIZE) {
          break;
        }
      }

      setLoadingState(prev => ({ ...prev, isLoading: false }));
      
    } catch (err) {
      console.error("Error fetching call records:", err);
      setError(
        err instanceof Error ? err.message : "Failed to fetch call records"
      );
      setLoadingState(prev => ({ ...prev, isLoading: false }));
    } finally {
      setLoading(false);
    }
  }, [filterPeriod, selectedAgent, selectedDispositions, startDate, endDate]);

  // Fetch filter options efficiently
  const fetchFilterOptions = useCallback(async () => {
    try {
      setFiltersLoading(true);

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
      fetchCallRecordsIncrementally();
    }
  }, [
    filterPeriod,
    selectedAgent,
    selectedDispositions,
    startDate,
    endDate,
    fetchCallRecordsIncrementally,
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
    await fetchCallRecordsIncrementally();
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
    <div className="flex-1 flex flex-col p-4">
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
        
        {/* Loading Progress Indicator */}
        {/* {loadingState.isLoading && (
          <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-blue-900">
                Loading insights data...
              </span>
              <span className="text-sm text-blue-700">
                {loadingState.recordsLoaded} / {loadingState.totalRecords} records
              </span>
            </div>
            <div className="w-full bg-blue-200 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all duration-300 ease-out"
                style={{
                  width: `${(loadingState.recordsLoaded / loadingState.totalRecords) * 100}%`
                }}
              />
            </div>
            <div className="text-xs text-blue-600 mt-1">
              Batch {loadingState.currentBatch} of {loadingState.totalBatches}
              {loadingState.totalRecords < allRecordsCount && (
                <span className="ml-2 text-blue-500">
                  (Capped at {MAX_RECORDS_FOR_INSIGHTS.toLocaleString()} records for performance)
                </span>
              )}
            </div>
          </div>
        )} */}
      </div>

      <div className="flex gap-x-4">
        <div className="flex-1">
          <InsightsStatsDashboard
            filteredRecords={callRecords}
            totalRecords={allRecordsCount}
            loading={loading || loadingState.isLoading}
          />
        </div>
        
        {/* Chat Modal */}
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
              <CallRecordsChat
                filteredRecords={callRecords}
                totalRecords={allRecordsCount}
                loading={loading || loadingState.isLoading}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default InsightsPage;