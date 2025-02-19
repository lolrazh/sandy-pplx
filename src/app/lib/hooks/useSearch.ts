import { useState } from 'react';

export interface SearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
  published_date?: string;
}

// Helper function to create a streaming generator
async function* createResultStream(results: SearchResult[]) {
  const sortedResults = results
    .sort((a: SearchResult, b: SearchResult) => b.score - a.score);
  
  // Stream each result with a small delay to show progression
  for (const result of sortedResults) {
    yield result;
    await new Promise(resolve => setTimeout(resolve, 150)); // 150ms delay between results
  }
}

export function useSearch() {
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);

  const performSearch = async (query: string) => {
    setIsSearching(true);
    setSearchError(null);
    setSearchResults([]);

    try {
      const response = await fetch('/api/tavily/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.details || 'Search request failed');
      }

      const data = await response.json();
      setSearchResults(data.results || []);
      return createResultStream(data.results || []);
    } catch (error) {
      console.error('Search error:', error);
      setSearchError(error instanceof Error ? error.message : 'Failed to perform search');
      setSearchResults([]);
      return createResultStream([]); // Return empty stream
    } finally {
      setIsSearching(false);
    }
  };

  return {
    isSearching,
    searchResults,
    searchError,
    performSearch,
  };
} 