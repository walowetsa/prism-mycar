import { useState } from "react";

interface RefreshButtonProps {
  onRefresh: () => Promise<void>;
  disabled?: boolean;
  className?: string;
}

const RefreshButton: React.FC<RefreshButtonProps> = ({
  onRefresh,
  disabled = false,
}) => {
  const [isRefreshing, setIsRefreshing] = useState(false);

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

  return (
    <button
      onClick={handleRefresh}
      disabled={disabled || isRefreshing}
      className={`bg-black w-6 h-6 rounded-full flex items-center justify-center cursor-pointer group text-emerald-600`}
      title="Refresh call records"
    >
      <svg
        className={`w-4 h-4 group-hover:rotate-90 transition-all`}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
        />
      </svg>
    </button>
  );
};

export default RefreshButton;
