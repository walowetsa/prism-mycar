"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import CallRecord from "@/types/CallRecord";
import CallLogFilters, { FilterPeriod } from "./CallLogFilters";
import Link from "next/link";
import Loader from "../../../public/prism-loader.gif";
import Image from "next/image";

interface CallLogTableProps {
  className?: string;
}

type SortField = "agent" | "timestamp" | "disposition" | null;
type SortDirection = "asc" | "desc";

interface SortState {
  field: SortField;
  direction: SortDirection;
}

interface PaginationData {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

const CallLogTable: React.FC<CallLogTableProps> = ({ className }) => {
  const [callRecords, setCallRecords] = useState<CallRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pagination, setPagination] = useState<PaginationData>({
    page: 1,
    limit: 100,
    total: 0,
    totalPages: 0,
    hasNext: false,
    hasPrev: false,
  });

  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  const [sortState, setSortState] = useState<SortState>({
    field: null,
    direction: "asc",
  });

  // Filter states
  const [filterPeriod, setFilterPeriod] = useState<FilterPeriod>("all");
  const [selectedAgent, setSelectedAgent] = useState<string>("");
  const [selectedDispositions, setSelectedDispositions] = useState<string[]>(
    []
  );
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");

  const [uniqueAgents, setUniqueAgents] = useState<string[]>([]);
  const [uniqueDispositions, setUniqueDispositions] = useState<string[]>([]);
  const [filtersLoading, setFiltersLoading] = useState(true);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const recordsPerPage = 100;

  const fetchCallRecords = useCallback(
    async (page: number = currentPage, resetPage: boolean = false) => {
      try {
        setLoading(true);
        setError(null);

        const actualPage = resetPage ? 1 : page;

        const params = new URLSearchParams({
          page: actualPage.toString(),
          limit: recordsPerPage.toString(),
          filterPeriod,
          ...(selectedAgent && { agent: selectedAgent }),
          ...(selectedDispositions.length > 0 && {
            dispositions: selectedDispositions.join(","),
          }),
          ...(startDate && { startDate }),
          ...(endDate && { endDate }),
          ...(sortState.field && {
            sortField: sortState.field,
            sortDirection: sortState.direction,
          }),
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
        setPagination(result.pagination);

        if (resetPage) {
          setCurrentPage(1);
        } else {
          setCurrentPage(actualPage);
        }
      } catch (err) {
        console.error("Error fetching call records:", err);
        setError(
          err instanceof Error ? err.message : "Failed to fetch call records"
        );
      } finally {
        setLoading(false);
      }
    },
    [
      currentPage,
      filterPeriod,
      selectedAgent,
      selectedDispositions,
      startDate,
      endDate,
      sortState,
    ]
  );

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

  useEffect(() => {
    fetchFilterOptions();
    fetchCallRecords(1, true);
  }, []);

  useEffect(() => {
    if (!filtersLoading) {
      fetchCallRecords(1, true);
    }
  }, [
    filterPeriod,
    selectedAgent,
    selectedDispositions,
    startDate,
    endDate,
    sortState,
    fetchCallRecords,
    filtersLoading,
  ]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setOpenDropdownId(null);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  useEffect(() => {
    if (filterPeriod === "dateRange" && !startDate && !endDate) {
      const today = new Date();
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      setStartDate(sevenDaysAgo.toISOString().split("T")[0]);
      setEndDate(today.toISOString().split("T")[0]);
    }
  }, [filterPeriod, startDate, endDate]);

  const formatTimestamp = (timestamp: string | null): string => {
    if (!timestamp) return "N/A";

    try {
      const date = new Date(timestamp);
      return date.toLocaleString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return "Invalid Date";
    }
  };

  const formatCallDuration = (
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

      if (typeof seconds !== "number" || seconds < 0) {
        return "N/A";
      }

      if (
        minutes !== undefined &&
        (typeof minutes !== "number" || minutes < 0)
      ) {
        return "N/A";
      }

      if (minutes === 0 || minutes === undefined) {
        return `${seconds}s`;
      }
      return `${minutes}m ${seconds}s`;
    } catch (error) {
      console.error("Error parsing call duration:", error);
      return "N/A";
    }
  };

  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= pagination.totalPages) {
      fetchCallRecords(page);
      setOpenDropdownId(null);
    }
  };

  const generatePageNumbers = () => {
    const pages = [];
    const maxVisiblePages = 5;

    if (pagination.totalPages <= maxVisiblePages) {
      for (let i = 1; i <= pagination.totalPages; i++) {
        pages.push(i);
      }
    } else {
      const start = Math.max(1, currentPage - 2);
      const end = Math.min(pagination.totalPages, start + maxVisiblePages - 1);

      for (let i = start; i <= end; i++) {
        pages.push(i);
      }
    }

    return pages;
  };

  const handleEllipsisClick = (recordId: string) => {
    setOpenDropdownId(openDropdownId === recordId ? null : recordId);
  };

  const handleMoreDetails = (record: CallRecord) => {
    console.log("More details for record:", record);
    setOpenDropdownId(null);
  };

  const handleDownloadAudio = (record: CallRecord) => {
    console.log("Download audio for record:", record);
    setOpenDropdownId(null);
  };

  const handleSort = (field: SortField) => {
    if (!field) return;

    setSortState((prev) => {
      if (prev.field === field) {
        return {
          field,
          direction: prev.direction === "asc" ? "desc" : "asc",
        };
      } else {
        return {
          field,
          direction: "asc",
        };
      }
    });
  };

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
    await fetchCallRecords(currentPage);
  };

  const getSortIcon = (field: SortField) => {
    if (sortState.field !== field) {
      return <span className="ml-1 text-gray-400">↕</span>;
    }

    return (
      <span className="ml-1 text-gray-700">
        {sortState.direction === "asc" ? "↑" : "↓"}
      </span>
    );
  };

  const successfulOutcomes = [
    "Sale - MTF Booking",
    "Sale - Pre Purchase Inspection",
    "Sale - Price Beat Booking",
    "Sale - Strip & Fit Booking",
    "Sale - Tyre Booking",
  ];

  const isSuccessfulOutcome = (dispositionTitle: string | null): boolean => {
    if (!dispositionTitle) return false;
    return successfulOutcomes.includes(dispositionTitle);
  };

  const getSortableHeaderClass = (field: SortField) => {
    const baseClass =
      "px-4 py-1 text-left text-xs font-medium text-emerald-800 uppercase tracking-wider cursor-pointer hover:bg-gray-100/20 transition-colors select-none";
    const activeClass = sortState.field === field ? "bg-black/60" : "";
    return `${baseClass} ${activeClass}`;
  };

  if (loading && callRecords.length === 0) {
    return (
      <div className={`flex flex-col items-center justify-center p-8 ${className}`}>
        <div className="text-gray-600">Loading call records...</div>
        <Image src={Loader} alt={"loading-icon"} width={480} height={480}/>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`p-4 ${className}`}>
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
    <div
      className={`w-full flex-1 ${className} flex flex-col max-h-[calc(100vh-120px)]`}
    >
      <div className="mb-4 flex justify-between items-center gap-x-4">
        <div className="flex items-center gap-3 flex-1">
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

      {/* body */}
      <div className="flex-1 flex flex-col bg-[var(--color-bg-secondary)] shadow-sm rounded-lg border border-[var(--color-bg-secondary)] overflow-hidden">
        <div
          className="overflow-auto flex-1 flex flex-col [&::-webkit-scrollbar]:w-2
  [&::-webkit-scrollbar-track]:rounded-full
  [&::-webkit-scrollbar-track]:bg-gray-100
  [&::-webkit-scrollbar-thumb]:rounded-full
  [&::-webkit-scrollbar-thumb]:bg-gray-300
  dark:[&::-webkit-scrollbar-track]:bg-neutral-700
  dark:[&::-webkit-scrollbar-thumb]:bg-neutral-500"
        >
          <table className="w-full table-fixed">
            <thead className="bg-[var(--color-bg-secondary)] border-b border-[var(--color-bg-secondary)] sticky top-0 z-10">
              <tr>
                <th
                  className={`${getSortableHeaderClass("agent")} w-64`}
                  onClick={() => handleSort("agent")}
                >
                  <div className="flex items-center text-[var(--color-text-primary)]">
                    Agent
                    <span className="text-lg">{getSortIcon("agent")}</span>
                  </div>
                </th>
                <th
                  className={`${getSortableHeaderClass("timestamp")} w-64`}
                  onClick={() => handleSort("timestamp")}
                >
                  <div className="flex items-center text-[var(--color-text-primary)]">
                    Timestamp
                    <span className="text-lg">{getSortIcon("timestamp")}</span>
                  </div>
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-text-primary)] uppercase tracking-wider w-24">
                  Duration
                </th>
                <th
                  className={`${getSortableHeaderClass("disposition")} w-80`}
                  onClick={() => handleSort("disposition")}
                >
                  <div className="flex items-center text-[var(--color-text-primary)]">
                    Disposition
                    <span className="text-lg">
                      {getSortIcon("disposition")}
                    </span>
                  </div>
                </th>
                <th className="px-4 py-1 text-center text-xs font-medium text-[var(--color-text-primary)] uppercase tracking-wider w-16">
                  Sale
                </th>
                {/* Add Sentiment Score */}
                <th className="px-4 py-1 text-left text-xs font-medium text-[var(--color-text-primary)] uppercase tracking-wider">
                  Summary
                </th>
                <th className="px-4 py-1 text-left text-xs font-medium text-[var(--color-text-primary)] uppercase tracking-wider w-20"></th>
              </tr>
            </thead>
            <tbody className="bg-black divide-y divide-[var(--color-bg-secondary)]">
              {loading && callRecords.length > 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-2 text-center text-gray-400"
                  >
                    <div className="animate-pulse">Updating...</div>
                  </td>
                </tr>
              )}
              {callRecords.map((record) => (
                <tr
                  key={record.contact_id}
                  className="hover:bg-neutral-600/20 transition-colors bg-[var(--color-bg-secondary)]/60 "
                >
                  <td className="px-4 py-1 text-sm text-[var(--color-text-primary)] w-64 truncate">
                    {record.agent_username === "T10085496@tsagroup.com.au"
                      ? "mdunstan@tsagroup.com.au"
                      : record.agent_username === "T10085497@tsagroup.com.au"
                      ? "mwilson.tsagroup.com.au"
                      : record.agent_username === "T10085494@tsagroup.com.au"
                      ? "vride.tsagroup.com.au"
                      : record.agent_username === "T10085498@tsagroup.com.au"
                      ? "bskipper.tsagroup.com.au"
                      : record.agent_username === "T10085495@tsagroup.com.au"
                      ? "ksingh@tsagroup.com.au"
                      : record.agent_username === "T10085499@tsagroup.com.au"
                      ? "elima@tsagroup.com.au"
                      : record.agent_username === "T10085523@tsagroup.com.au"
                      ? "srana@tsagroup.com.au"
                      : record.agent_username === "T10085526@tsagroup.com.au"
                      ? "ezgrajewski@tsagroup.com.au"
                      : record.agent_username === "T10085531@tsagroup.com.au"
                      ? "hcrooks.tsagroup.com.au"
                      : record.agent_username}
                  </td>
                  <td className="px-4 py-1 text-sm text-[var(--color-text-primary)] w-64">
                    {formatTimestamp(record.initiation_timestamp)}
                  </td>
                  <td className="px-4 py-1 text-sm text-[var(--color-text-primary)] w-24">
                    {formatCallDuration(record.call_duration)}
                  </td>
                  <td className="px-4 py-1 text-sm text-[var(--color-text-primary)] w-80 truncate">
                    {record.disposition_title || "N/A"}
                  </td>
                  <td className="px-4 py-1 text-sm text-[var(--color-text-primary)] w-16 text-center">
                    {isSuccessfulOutcome(record.disposition_title) && (
                      <span
                        className="text-green-400 text-lg"
                        title="Successful outcome"
                      >
                        ✓
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-1 text-sm text-[var(--color-text-primary)]">
                    <div
                      className="truncate"
                      title={record.call_summary || "N/A"}
                    >
                      {record.call_summary || "N/A"}
                      {
                        // add sentiment score (pos/(pos+neg))
                      }
                    </div>
                  </td>
                  <td className="px-4 py-1 text-sm text-[var(--color-text-accent)] w-20 relative">
                    <div
                      ref={
                        openDropdownId === record.contact_id
                          ? dropdownRef
                          : null
                      }
                    >
                      <button
                        onClick={() => handleEllipsisClick(record.contact_id)}
                        className="text-[var(--color-text-accent)] hover:text-gray-300 focus:outline-none focus:text-gray-300 p-1 rounded transition-colors"
                        aria-label="More actions"
                      >
                        ⋯
                      </button>

                      {openDropdownId === record.contact_id && (
                        <div className="absolute right-16 top-4 mt-1 w-40 bg-white rounded-md shadow-lg border border-gray-200 z-50">
                          <div className="py-1">
                            <Link href={`./${record.contact_id}`}>
                              <button
                                onClick={() => handleMoreDetails(record)}
                                className="block w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 text-left transition-colors"
                              >
                                More Details
                              </button>
                            </Link>
                            <button
                              onClick={() => handleDownloadAudio(record)}
                              className="block w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 text-left transition-colors"
                            >
                              Download Audio
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* pagination */}
      {pagination.totalPages > 1 && (
        <div className="mt-6 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <button
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={!pagination.hasPrev || loading}
              className={`px-3 py-2 text-sm font-medium rounded-md bg-gradient-to-r from-[var(--color-prism-blue)] to-[var(--color-prism-orange)] hover:scale-105 transition cursor-pointer ${
                !pagination.hasPrev || loading
                  ? "bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] cursor-not-allowed"
                  : "bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] hover:bg-gray-50/40"
              }`}
            >
              Previous
            </button>

            <div className="flex items-center space-x-1">
              {generatePageNumbers().map((page) => (
                <button
                  key={page}
                  onClick={() => handlePageChange(page)}
                  disabled={loading}
                  className={`px-3 py-2 text-sm font-medium rounded-md ${
                    currentPage === page
                      ? "bg-black/60 text-white"
                      : loading
                      ? "bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] cursor-not-allowed"
                      : "bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] hover:bg-gray-50/40"
                  }`}
                >
                  {page}
                </button>
              ))}
            </div>

            <button
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={!pagination.hasNext || loading}
              className={`px-3 py-2 text-sm font-medium rounded-md bg-gradient-to-r from-[var(--color-prism-orange)] to-[var(--color-prism-blue)] hover:scale-105 transition cursor-pointer ${
                !pagination.hasNext || loading
                  ? "bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] cursor-not-allowed"
                  : "bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] hover:bg-gray-50/40"
              }`}
            >
              Next
            </button>
          </div>

          <div className="text-sm text-gray-600">
            Page {currentPage} of {pagination.totalPages} • Total:{" "}
            {pagination.total} records
          </div>
        </div>
      )}
    </div>
  );
};

export default CallLogTable;
