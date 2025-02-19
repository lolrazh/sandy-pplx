import { NextResponse } from 'next/server';
import { tavily } from '@tavily/core';

const TAVILY_API_KEY = "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";

// Initialize Tavily client
const tvly = tavily({ apiKey: TAVILY_API_KEY });

export async function POST(req: Request) {
  try {
    const { query } = await req.json();

    const response = await tvly.search(query, {
      searchDepth: "advanced",
      maxResults: 5,
      includeAnswer: false,
      includeRawContent: false,
      includeImages: false,
    });

    return NextResponse.json(response);
  } catch (error) {
    console.error('Tavily search error:', error);
    return NextResponse.json(
      { error: 'Failed to perform search', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
} 