interface CallRecord {
  id: string
  contact_id: string
  transcript_text: string
  recording_location: string
  agent_username: string | null
  queue_name: string | null
  initiation_timestamp: string
  speaker_data: {
    speaker: string,
    text: string,
    confidence: string,
    start: number,
    end: number,
    words: {
        text: string,
        start: number,
        end: number,
        confidence: number,
        speaker: string
    }[],
    speakerRole: 'Agent' | 'customer' | string
  }[] | null
  entities: {
    entity_type: string,
    text: string,
    start: number,
    end: number
  }[] | null
  categories: string[] | null
  disposition_title: string | null
  processed_at: string | null
  call_summary: string | null
  campaign_name: string | null
  campaign_id: number | null
  customer_cli: string | null
  total_hold_time: {
    minutes: number,
    seconds: number,
  } | null
  agent_hold_time: string | null
  time_in_queue: {
    minutes: number,
    seconds: number,
  } | null
  call_duration: {
    minutes: number,
    seconds: number,
  } | null
  primary_category: string | null
  sentiment_analysis:{
    sentiment: string,
    speaker: string,
    text: string,
    start: number,
    end: number,
    confidence: string
  }[] | null
} export default CallRecord;

