// TODO: Replace OPENAI
import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: NextRequest) {
  try {
    const { query, callData } = await request.json();

    if (!query || !callData) {
      return NextResponse.json(
        { error: 'Query and call data are required' },
        { status: 400 }
      );
    }

    const { callRecord, transcript, callInfo } = callData;

    const systemPrompt = `You are an AI assistant specialized in analysing individual call center interactions and providing detailed insights.

Call Context:
- Call ID: ${callRecord.id}
- Agent: ${callRecord.agent_username || 'Unknown'}
- Queue: ${callRecord.queue_name || 'Unknown'}
- Duration: ${callRecord.call_duration || 'Unknown'}
- Has Transcript: ${callInfo.hasTranscript}
- Has Sentiment Analysis: ${callInfo.hasSentiment}
- Has Entities: ${callInfo.hasEntities}
- Has Summary: ${callInfo.hasSummary}
- Transcript Segments: ${callInfo.transcriptLength}
- Number of Speakers: ${callInfo.speakerCount}

Analysis Guidelines:
- Provide detailed, specific insights about this individual call
- Focus on call quality, customer experience, and agent performance
- Use transcript data when available for detailed conversation analysis
- Leverage sentiment analysis and entities for deeper insights
- Identify specific moments of excellence or areas for improvement
- Provide actionable feedback for this specific interaction
- Structure your response clearly and professionally
- Reference specific details from the call when possible
- Consider the context of call duration, hold times, and resolution

Available Data Fields:
- Call metadata (timestamps, duration, hold times, queue times)
- Agent and queue information
- Disposition and campaign details
- Full transcript with speaker identification and timestamps
- Sentiment analysis throughout the conversation
- Extracted entities and key topics
- Call summary if available
- Customer CLI information`;

    // JSON Prep
    const callDataString = JSON.stringify({
      ...callRecord,
      transcript_segments: transcript
    }, null, 2);

    const userPrompt = `Please analyse this specific call center interaction and respond to: "${query}"

Call Record Data:
${callDataString}

Provide a comprehensive analysis focusing on this individual call with specific insights and actionable recommendations.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: 4000,
      temperature: 0.3,
    });

    const response = completion.choices[0]?.message?.content || 'No response generated';

    return NextResponse.json({ response });

    // TODO: fix data type issues (15/07)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error('Error calling OpenAI for call detail analysis:', error);

    // Error handling stuff
    if (error?.status === 429) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. The system will automatically retry with exponential backoff.' },
        { status: 429 }
      );
    }

    if (error?.status === 401) {
      return NextResponse.json(
        { error: 'OpenAI API authentication failed. Please check your API key configuration.' },
        { status: 401 }
      );
    }

    if (error?.status === 413) {
      return NextResponse.json(
        { error: 'Request too large. The call data might be too extensive for analysis.' },
        { status: 413 }
      );
    }

    return NextResponse.json(
      { error: `Call analysis failed: ${error.message}` },
      { status: 500 }
    );
  }
}