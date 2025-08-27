"use client";

import { useMemo, useState, useRef, useEffect } from "react";

export type FilterPeriod =
  | "all"
  | "today"
  | "yesterday"
  | "last7days"
  | "lastMonth"
  | "dateRange";

interface CallLogFiltersProps {
  selectedFilter: FilterPeriod;
  onFilterChange: (filter: FilterPeriod) => void;
  selectedAgent: string;
  onAgentChange: (agent: string) => void;
  agents: string[];
  selectedDispositions: string[];
  onDispositionsChange: (dispositions: string[]) => void;
  dispositions: string[];
  startDate: string;
  endDate: string;
  onStartDateChange: (date: string) => void;
  onEndDateChange: (date: string) => void;
  onRefresh: () => Promise<void>;
  disabled?: boolean;
  className?: string;
}

const CallLogFilters: React.FC<CallLogFiltersProps> = ({
  selectedFilter,
  onFilterChange,
  selectedAgent,
  onAgentChange,
  agents = [],
  selectedDispositions = [],
  onDispositionsChange,
  dispositions = [],
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  onRefresh,
  disabled = false,
  className,
}) => {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDispositionDropdownOpen, setIsDispositionDropdownOpen] =
    useState(false);
  const [isAgentDropdownOpen, setIsAgentDropdownOpen] = useState(false);
  const dispositionDropdownRef = useRef<HTMLDivElement>(null);
  const agentDropdownRef = useRef<HTMLDivElement>(null);

  const filterOptions = useMemo(
    () => [
      { value: "all" as FilterPeriod, label: "All" },
      { value: "today" as FilterPeriod, label: "Today" },
      { value: "yesterday" as FilterPeriod, label: "Yesterday" },
      { value: "last7days" as FilterPeriod, label: "Last 7D" },
      { value: "lastMonth" as FilterPeriod, label: "Last Month" },
      { value: "dateRange" as FilterPeriod, label: "Custom" },
    ],
    []
  );

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dispositionDropdownRef.current &&
        !dispositionDropdownRef.current.contains(event.target as Node)
      ) {
        setIsDispositionDropdownOpen(false);
      }

      if (
        agentDropdownRef.current &&
        !agentDropdownRef.current.contains(event.target as Node)
      ) {
        setIsAgentDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const formatDateForInput = (date: Date): string => {
    return date.toISOString().split("T")[0];
  };

  const getTodayDate = (): string => {
    return formatDateForInput(new Date());
  };

  const getDefaultStartDate = (): string => {
    const date = new Date();
    date.setDate(date.getDate() - 7);
    return formatDateForInput(date);
  };

  const handleRefresh = async () => {
    if (isRefreshing || disabled) return;

    try {
      setIsRefreshing(true);
      await onRefresh();
    } catch (error) {
      console.error("Error refreshing data:", error);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleResetAllFilters = () => {
    onFilterChange("today");
    onAgentChange("");
    onDispositionsChange([]);
    onStartDateChange("");
    onEndDateChange("");
  };

  const handleDispositionToggle = (disposition: string) => {
    const isSelected = selectedDispositions.includes(disposition);
    if (isSelected) {
      onDispositionsChange(
        selectedDispositions.filter((d) => d !== disposition)
      );
    } else {
      onDispositionsChange([...selectedDispositions, disposition]);
    }
  };

  const getDispositionDisplayText = () => {
    if (selectedDispositions.length === 0) {
      return "All Dispositions";
    } else if (selectedDispositions.length === 1) {
      return selectedDispositions[0];
    } else {
      return `${selectedDispositions.length} selected`;
    }
  };

  const getAgentDisplayText = () => {
    if (!selectedAgent) return "All Agents";

    switch (selectedAgent) {
      case "T10085496@tsagroup.com.au":
        return "mdunstan@tsagroup.com.au";
      case "T10085497@tsagroup.com.au":
        return "mwilson.tsagroup.com.au";
      case "T10085494@tsagroup.com.au":
        return "vride.tsagroup.com.au";
      case "T10085498@tsagroup.com.au":
        return "bskipper.tsagroup.com.au";
      case "T10085495@tsagroup.com.au":
        return "ksingh@tsagroup.com.au";
      case "T10085499@tsagroup.com.au":
        return "elima@tsagroup.com.au";
      case "T10085523@tsagroup.com.au":
        return "srana@tsagroup.com.au";
      case "T10085526@tsagroup.com.au":
        return "ezgrajewski@tsagroup.com.au";
      case "T10085531@tsagroup.com.au":
        return "hcrooks.tsagroup.com.au";
      default:
        return selectedAgent;
    }
  };

  return (
    <div className={`${className}`}>
      <div className="flex items-center gap-3 flex-wrap">
        {/* Refresh button */}
        <button
          onClick={handleRefresh}
          disabled={disabled || isRefreshing}
          className={`bg-[var(--color-bg-secondary)] w-8 h-8 rounded-full flex items-center justify-center cursor-pointer group text-[var(--color-text-primary)] shrink-0`}
          title="Refresh call records"
        >
          <svg
            className={`w-4 h-4 group-hover:rotate-90 transition-all ${
              isRefreshing ? "animate-spin" : ""
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <defs>
              <linearGradient
                id="refreshGradient"
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
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              stroke="url(#refreshGradient)"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        </button>

        {/* Agent Filter */}
        <div className="relative" ref={agentDropdownRef}>
          <button
            type="button"
            onClick={() => setIsAgentDropdownOpen(!isAgentDropdownOpen)}
            className="px-3 py-1.5 text-sm border border-gray-300/20 rounded-full bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-[var(--color-text-primary)] focus:border-[var(--color-text-primary)] transition-colors duration-200 min-w-[160px] flex justify-between items-center"
          >
            <span className="truncate">{getAgentDisplayText()}</span>
            <svg
              className={`w-4 h-4 transition-transform ml-2 shrink-0 ${
                isAgentDropdownOpen ? "rotate-180" : ""
              }`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>

          {isAgentDropdownOpen && (
            <div
              className="absolute z-[100] mt-1 w-full bg-[var(--color-bg-secondary)] border border-gray-300/20 rounded-md shadow-lg max-h-60 overflow-auto min-w-[320px]  [&::-webkit-scrollbar]:w-2
  [&::-webkit-scrollbar-track]:rounded-full
  [&::-webkit-scrollbar-track]:bg-gray-100
  [&::-webkit-scrollbar-thumb]:rounded-full
  [&::-webkit-scrollbar-thumb]:bg-gray-300
  dark:[&::-webkit-scrollbar-track]:bg-neutral-700
  dark:[&::-webkit-scrollbar-thumb]:bg-neutral-500"
            >
              <div className="py-1 ">
                <button
                  key="all-agents"
                  onClick={() => {
                    onAgentChange("");
                    setIsAgentDropdownOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2 hover:bg-black/60 cursor-pointer text-sm text-[var(--color-text-primary)] ${
                    selectedAgent === "" ? "bg-black/40" : ""
                  }`}
                >
                  All Agents
                </button>
                {agents.map((agent) => (
                  <button
                    key={agent}
                    onClick={() => {
                      onAgentChange(agent);
                      setIsAgentDropdownOpen(false);
                    }}
                    className={`w-full text-left px-3 py-1 hover:bg-black/60 cursor-pointer text-sm text-[var(--color-text-primary)] ${
                      selectedAgent === agent ? "bg-black/40" : ""
                    }`}
                  >
                    {agent === "T10085496@tsagroup.com.au"
                      ? "mdunstan@tsagroup.com.au"
                      : agent === "T10085497@tsagroup.com.au"
                      ? "mwilson.tsagroup.com.au"
                      : agent === "T10085494@tsagroup.com.au"
                      ? "vride.tsagroup.com.au"
                      : agent === "T10085498@tsagroup.com.au"
                      ? "bskipper.tsagroup.com.au"
                      : agent === "T10085495@tsagroup.com.au"
                      ? "ksingh@tsagroup.com.au"
                      : agent === "T10085499@tsagroup.com.au"
                      ? "elima@tsagroup.com.au"
                      : agent === "T10085523@tsagroup.com.au"
                      ? "srana@tsagroup.com.au"
                      : agent === "T10085526@tsagroup.com.au"
                      ? "ezgrajewski@tsagroup.com.au"
                      : agent === "T10085531@tsagroup.com.au"
                      ? "hcrooks.tsagroup.com.au"
                      : agent}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Disposition Filter */}
        <div className="relative" ref={dispositionDropdownRef}>
          <button
            type="button"
            onClick={() =>
              setIsDispositionDropdownOpen(!isDispositionDropdownOpen)
            }
            className="px-3 py-1.5 text-sm border border-gray-300/20 rounded-full bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-[var(--color-text-primary)] focus:border-[var(--color-text-primary)] transition-colors duration-200 min-w-[160px] flex justify-between items-center"
          >
            <span className="truncate">{getDispositionDisplayText()}</span>
            <svg
              className={`w-4 h-4 transition-transform ml-2 shrink-0 ${
                isDispositionDropdownOpen ? "rotate-180" : ""
              }`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>

          {isDispositionDropdownOpen && (
            <div className="absolute z-[100] mt-1 w-full bg-[var(--color-bg-secondary)] border border-gray-300/20 rounded-md shadow-lg max-h-60 min-w-[320px] overflow-auto  [&::-webkit-scrollbar]:w-2
  [&::-webkit-scrollbar-track]:rounded-full
  [&::-webkit-scrollbar-track]:bg-gray-100
  [&::-webkit-scrollbar-thumb]:rounded-full
  [&::-webkit-scrollbar-thumb]:bg-gray-300
  dark:[&::-webkit-scrollbar-track]:bg-neutral-700
  dark:[&::-webkit-scrollbar-thumb]:bg-neutral-500">
              <div className="py-1">
                {dispositions.map((disposition) => (
                  <label
                    key={disposition}
                    className="flex items-center px-3 py-1 hover:bg-black/60 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedDispositions.includes(disposition)}
                      onChange={() => handleDispositionToggle(disposition)}
                      className="mr-2 h-4 w-4 text-[var(--color-text-primary)] focus:ring-[var(--color-text-primary)] border-gray-300/20 rounded"
                    />
                    <span className="text-sm text-[var(--color-text-primary)]">
                      {disposition}
                    </span>
                  </label>
                ))}
              </div>
              {selectedDispositions.length > 0 && (
                <div className="border-t border-gray-200 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => onDispositionsChange([])}
                    className="text-sm text-[var(--color-text-primary)] hover:text-[var(--color-text-primary)] font-medium"
                  >
                    Clear all
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Date Filters */}
        <div className="flex items-center bg-[var(--color-bg-secondary)] rounded-full p-1 border border-gray-300/20">
          {filterOptions.map((option, index) => (
            <button
              key={option.value}
              onClick={() => onFilterChange(option.value)}
              className={`px-3 py-1 text-xs font-medium transition-colors duration-200 ${
                selectedFilter === option.value
                  ? "bg-black/60 text-[var(--color-text-primary)] shadow-sm"
                  : "text-[var(--color-text-primary)] hover:bg-gray-50/20"
              } ${
                index === 0
                  ? "rounded-l-full"
                  : index === filterOptions.length - 1
                  ? "rounded-r-full"
                  : "rounded"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {selectedFilter === "dateRange" && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={startDate || getDefaultStartDate()}
              onChange={(e) => onStartDateChange(e.target.value)}
              className="px-2 py-1 text-xs border border-gray-300/20 rounded-md bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-text-primary)] focus:border-[var(--color-text-primary)]"
            />
            <span className="text-xs font-bold text-[var(--color-text-accent)]">
              to
            </span>
            <input
              type="date"
              value={endDate || getTodayDate()}
              onChange={(e) => onEndDateChange(e.target.value)}
              className="px-2 py-1 text-xs border border-gray-300/20 rounded-md bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
            />
          </div>
        )}

        {/* Reset Filters Button */}
        <button
          onClick={handleResetAllFilters}
          disabled={disabled}
          className="px-3 py-1.5 text-sm font-medium rounded-md bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] flex items-center gap-2 cursor-pointer border border-gray-300/20 hover:bg-gray-50/20 shrink-0"
          title="Reset all filters"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
          Reset
        </button>
      </div>
    </div>
  );
};

export default CallLogFilters;
