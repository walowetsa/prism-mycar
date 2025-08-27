import { TranscriptSegment } from "@/types/Transcription";

interface TranscriptProps {
  data: TranscriptSegment[];
  showConfidence?: boolean;
  showTimestamps?: boolean;
  showWordDetails?: boolean;
}

const Transcript: React.FC<TranscriptProps> = ({
  data,
  showTimestamps = true,
  showWordDetails = false,
}) => {
  const formatTime = (milliseconds: number): string => {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
  };

  const getConfidenceColor = (confidence: number): string => {
    if (confidence >= 0.9) return "text-emerald-400";
    if (confidence >= 0.7) return "text-yellow-400";
    return "text-red-400";
  };

  const getSpeakerStyling = (speakerRole: string) => {
    return speakerRole === "Agent"
      ? "bg-[var(--color-bg-secondary)] border-l-4 border-[var(--color-prism-blue)]"
      : "bg-[var(--color-bg-secondary)] border-r-4 border-[var(--color-prism-orange)]";
  };

  if (!data || data.length === 0) {
    return (
      <div className="text-neutral-400 text-center py-8">
        No transcript data available
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {data.map((segment, index) => (
        <div
          key={index}
          className={`p-3 rounded-lg ${getSpeakerStyling(segment.speakerRole)}`}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center space-x-2">
              <span className="font-semibold text-neutral-200">
                Speaker {segment.speaker}
              </span>
            </div>

            {showTimestamps && (
              <span className="text-xs text-neutral-400">
                {formatTime(segment.start)} - {formatTime(segment.end)}
              </span>
            )}
          </div>

          <div className="mb-2">
            <p className="text-neutral-200 leading-relaxed text-sm">
              {segment.text}
            </p>
          </div>

          {showWordDetails && (
            <div className="mt-3 pt-3 border-t border-neutral-700">
              <details className="cursor-pointer">
                <summary className="text-xs text-neutral-400 hover:text-neutral-300">
                  Show word-level details
                </summary>
                <div className="mt-2 grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                  {segment.words.map((word, wordIndex) => (
                    <div
                      key={wordIndex}
                      className="bg-neutral-900 p-2 rounded border border-neutral-700"
                    >
                      <div className="font-medium text-neutral-200">
                        {word.text}
                      </div>
                      <div className="text-neutral-400">
                        {formatTime(word.start)} - {formatTime(word.end)}
                      </div>
                      <div className={`${getConfidenceColor(word.confidence)}`}>
                        {(word.confidence * 100).toFixed(0)}%
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            </div>
          )}
        </div>
      ))}

      {data.length > 0 && (
        <div className="mt-6 p-3 bg-[var(--color-bg-primary)] rounded-lg border border-neutral-700">
          <div className="grid grid-cols-2 gap-4 text-xs">
            <div>
              <span className="text-neutral-400">Total Segments:</span>
              <span className="ml-2 font-medium text-neutral-200">
                {data.length}
              </span>
            </div>
            <div>
              <span className="text-neutral-400">Duration:</span>
              <span className="ml-2 font-medium text-neutral-200">
                {formatTime(Math.max(...data.map((d) => d.end)))}
              </span>
            </div>
            <div>
              <span className="text-neutral-400">Avg Confidence:</span>
              <span className="ml-2 font-medium text-emerald-400">
                {(
                  (data.reduce((acc, d) => acc + d.confidence, 0) /
                    data.length) *
                  100
                ).toFixed(1)}
                %
              </span>
            </div>
            <div>
              <span className="text-neutral-400">Speakers:</span>
              <span className="ml-2 font-medium text-neutral-200">
                {new Set(data.map((d) => d.speaker)).size}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Transcript;
