interface Word {
  text: string;
  start: number;
  end: number;
  confidence: number;
  speaker: string;
}

export interface TranscriptSegment {
  speaker: string;
  text: string;
  confidence: number;
  start: number;
  end: number;
  words: Word[];
  speakerRole: 'Agent' | 'Customer';
} 