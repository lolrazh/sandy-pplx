'use client';

import { SearchResult } from '../lib/hooks/useSearch';

interface SearchResultsProps {
  results: SearchResult[];
  isSearching: boolean;
  error?: string | null;
}

export default function SearchResults({ results, isSearching, error }: SearchResultsProps) {
  if (error) {
    return (
      <div className="mb-4 text-red-400 font-mono text-sm border-l-2 border-red-500 pl-4">
        Error performing search: {error}
      </div>
    );
  }

  if (isSearching) {
    return (
      <div className="mb-4 space-y-4">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-gray-700 rounded w-3/4"></div>
          <div className="h-4 bg-gray-700 rounded w-1/2"></div>
          <div className="h-4 bg-gray-700 rounded w-2/3"></div>
        </div>
      </div>
    );
  }

  if (!results.length) {
    return (
      <div className="mb-4 border-l-2 border-blue-500 pl-4">
        <div className="text-sm text-gray-500 font-mono">
          Searching the web...
        </div>
      </div>
    );
  }

  return (
    <div className="mb-4 border-l-2 border-blue-500 pl-4">
      <div className="space-y-3">
        {results.map((result, index) => (
          <div key={index} className="text-sm">
            <div className="flex items-center gap-2">
              <a
                href={result.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300 transition-colors font-mono flex-1"
              >
                {result.title || result.url}
              </a>
              {result.published_date && (
                <span className="text-gray-500 text-xs font-mono">
                  {new Date(result.published_date).toLocaleDateString()}
                </span>
              )}
            </div>
            <p className="text-gray-500 text-xs mt-1 font-mono leading-relaxed">
              {result.content.slice(0, 200)}
              {result.content.length > 200 && '...'}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
} 