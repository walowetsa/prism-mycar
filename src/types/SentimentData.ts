export interface SentimentData {
  sentiment: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | string;
  speaker: string;
  text: string;
  start: number;
  end: number;
  confidence: number;
}