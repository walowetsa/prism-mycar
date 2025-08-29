/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import ProcessedCallRecord from '@/types/ProcessedCallRecord'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseKey)

// Helper function to apply filters to a query
function applyFilters(
  query: any,
  filterPeriod: string,
  selectedAgent: string | null,
  selectedDispositions: string[],
  startDate: string | null,
  endDate: string | null
) {
  // Apply time-based filters
  if (filterPeriod !== 'all') {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

    switch (filterPeriod) {
      case 'today':
        const todayStart = today.toISOString()
        const todayEnd = new Date(today.getTime() + 24 * 60 * 60 * 1000).toISOString()
        query = query.gte('initiation_timestamp', todayStart).lt('initiation_timestamp', todayEnd)
        break

      case 'yesterday':
        const yesterday = new Date(today)
        yesterday.setDate(yesterday.getDate() - 1)
        const yesterdayStart = yesterday.toISOString()
        const yesterdayEnd = today.toISOString()
        query = query.gte('initiation_timestamp', yesterdayStart).lt('initiation_timestamp', yesterdayEnd)
        break

      case 'last7days':
        const sevenDaysAgo = new Date(today)
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
        query = query.gte('initiation_timestamp', sevenDaysAgo.toISOString())
        break

      case 'lastMonth':
        const thirtyDaysAgo = new Date(today)
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
        query = query.gte('initiation_timestamp', thirtyDaysAgo.toISOString())
        break

      case 'dateRange':
        if (startDate) {
          const start = new Date(startDate)
          start.setHours(0, 0, 0, 0)
          query = query.gte('initiation_timestamp', start.toISOString())
        }
        if (endDate) {
          const end = new Date(endDate)
          end.setHours(23, 59, 59, 999)
          query = query.lte('initiation_timestamp', end.toISOString())
        }
        break
    }
  }

  // Apply agent filter
  if (selectedAgent) {
    query = query.eq('agent_username', selectedAgent)
  }

  // Apply disposition filters
  if (selectedDispositions.length > 0) {
    query = query.in('disposition_title', selectedDispositions)
  }

  return query
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    
    const page = parseInt(searchParams.get('page') || '1')
    const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 50000) // Cap at 500 per batch
    const offset = (page - 1) * limit

    const filterPeriod = searchParams.get('filterPeriod') || 'today'
    const selectedAgent = searchParams.get('agent')
    const selectedDispositions = searchParams.get('dispositions')?.split(',').filter(Boolean) || []
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const countOnly = searchParams.get('countOnly') === 'true'
    
    const sortField = searchParams.get('sortField') || 'initiation_timestamp'
    const sortDirection = searchParams.get('sortDirection') || 'desc'

    // If count-only, return early with just the count
    if (countOnly) {
      let countQuery = supabase
        .from('call_records')
        .select('contact_id', { count: 'exact', head: true })
      
      countQuery = applyFilters(
        countQuery,
        filterPeriod,
        selectedAgent,
        selectedDispositions,
        startDate,
        endDate
      )

      const { error, count } = await countQuery

      if (error) {
        console.error('Supabase count error:', error)
        return NextResponse.json(
          { error: 'Failed to fetch record count', details: error.message },
          { status: 500 }
        )
      }

      return NextResponse.json({
        data: [],
        pagination: {
          page: 1,
          limit: 0,
          total: count || 0,
          totalPages: 0,
          hasNext: false,
          hasPrev: false
        }
      })
    }

    // Build query for full data
    let query = supabase
      .from('call_records')
      .select(`
        contact_id, 
        recording_location, 
        transcript_text, 
        queue_name, 
        agent_username, 
        initiation_timestamp, 
        sentiment_analysis, 
        categories, 
        disposition_title, 
        call_summary, 
        call_duration, 
        primary_category
      `, { count: 'exact' })

    // Apply filters
    query = applyFilters(
      query,
      filterPeriod,
      selectedAgent,
      selectedDispositions,
      startDate,
      endDate
    )

    // Apply sorting
    const ascending = sortDirection === 'asc'
    switch (sortField) {
      case 'agent':
        query = query.order('agent_username', { ascending })
        break
      case 'timestamp':
        query = query.order('initiation_timestamp', { ascending })
        break
      case 'disposition':
        query = query.order('disposition_title', { ascending })
        break
      default:
        query = query.order('initiation_timestamp', { ascending: false })
    }

    // Apply pagination
    query = query.range(offset, offset + limit - 1)

    const { data, error, count } = await query

    if (error) {
      console.error('Supabase error:', error)
      
      // Handle specific timeout errors
      if (error.message?.includes('timeout') || error.message?.includes('canceling statement')) {
        return NextResponse.json(
          { 
            error: 'Query timeout - try reducing the date range or adding more filters',
            details: error.message,
            suggestion: 'Consider filtering by agent or disposition to reduce the dataset size'
          },
          { status: 408 } // Request Timeout
        )
      }
      
      return NextResponse.json(
        { error: 'Failed to fetch call records', details: error.message },
        { status: 500 }
      )
    }

    const callRecords: ProcessedCallRecord[] = data || []

    return NextResponse.json({
      data: callRecords,
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit),
        hasNext: offset + limit < (count || 0),
        hasPrev: page > 1
      }
    })

  } catch (error) {
    console.error('API error:', error)
    
    // Handle different types of errors
    if (error instanceof Error && error.message?.includes('timeout')) {
      return NextResponse.json(
        { 
          error: 'Request timeout - please try again with more specific filters',
          suggestion: 'Try filtering by date range, agent, or disposition to reduce query size'
        },
        { status: 408 }
      )
    }
    
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { type } = body 

    if (type === 'agents') {
      // Use DISTINCT for better performance
      const { data, error } = await supabase
        .from('call_records')
        .select('agent_username')
        .not('agent_username', 'is', null)
        .limit(1000) // Reasonable limit for distinct values

      if (error) {
        console.error('Error fetching agents:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      const uniqueValues = Array.from(new Set(
        data.map((record: { agent_username: string }) => record.agent_username)
      )).filter(Boolean).sort()

      return NextResponse.json({ data: uniqueValues })

    } else if (type === 'dispositions') {
      // Use DISTINCT for better performance
      const { data, error } = await supabase
        .from('call_records')
        .select('disposition_title')
        .not('disposition_title', 'is', null)
        .limit(1000) // Reasonable limit for distinct values

      if (error) {
        console.error('Error fetching dispositions:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      const uniqueValues = Array.from(new Set(
        data.map((record: { disposition_title: string }) => record.disposition_title)
      )).filter(Boolean).sort()

      return NextResponse.json({ data: uniqueValues })

    } else {
      return NextResponse.json({ error: 'Invalid type parameter' }, { status: 400 })
    }

  } catch (error) {
    console.error('POST API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}