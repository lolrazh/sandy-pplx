'use client';

import { useChat } from 'ai/react';
import { Message } from 'ai';
import { useEffect, useRef, useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import type { ComponentPropsWithoutRef, DetailedHTMLProps, HTMLAttributes } from 'react';
import { useSearch, SearchResult } from '../lib/hooks/useSearch';
import SearchResults from './SearchResults';
import LoadingSpinner from './LoadingSpinner';

interface StreamingState {
  thinking: string;
  content: string;
  isThinking: boolean;
  sources: SearchResult[];
}

function parseMessage(content: string) {
  const thinkRegex = /<think>([^]*?)<\/think>/;
  const thinkMatch = content.match(thinkRegex);
  
  if (thinkMatch) {
    return {
      thinking: thinkMatch[1].trim(),
      content: content.replace(thinkRegex, '').trim()
    };
  }
  return { content: content.trim() };
}

// Define proper types for our components
type CodeProps = ComponentPropsWithoutRef<'code'> & { inline?: boolean };
type PreProps = ComponentPropsWithoutRef<'pre'>;
type ParagraphProps = ComponentPropsWithoutRef<'p'>;
type ListProps = ComponentPropsWithoutRef<'ul'>;
type ListItemProps = ComponentPropsWithoutRef<'li'>;

function formatThinkingTime(seconds: number): string {
  if (seconds < 60) {
    return `${seconds} seconds`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds > 0 
    ? `${minutes} minute${minutes > 1 ? 's' : ''} ${remainingSeconds} seconds`
    : `${minutes} minute${minutes > 1 ? 's' : ''}`;
}

export default function Chat() {
  const [streamingState, setStreamingState] = useState<StreamingState>({
    thinking: '',
    content: '',
    isThinking: true,
    sources: []
  });
  
  const { isSearching, searchResults, searchError, performSearch } = useSearch();
  const [isOpen, setIsOpen] = useState(true);
  const [isSourcesOpen, setIsSourcesOpen] = useState(true);
  const thinkingStartTime = useRef<number | null>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  
  const { messages, input, handleInputChange, handleSubmit: originalHandleSubmit, isLoading } = useChat({
    api: '/api/deepseek/chat',
    body: {
      searchResults: streamingState.sources
    }
  });

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!input.trim()) return;

    // Store the current input before it gets cleared
    const currentInput = input;

    // Clear input immediately
    handleInputChange({ target: { value: '' } } as React.ChangeEvent<HTMLInputElement>);

    // Keep previous message's sources but clear current streaming state
    setStreamingState(prev => ({
      ...prev,
      thinking: '',
      content: '',
      isThinking: true,
      // Don't clear sources here to preserve previous message's sources
    }));

    try {
      // If this is a follow-up question (has context), get reformulated query first
      let searchQuery = currentInput;
      if (messages.length > 1) {
        const reformulationResponse = await fetch('/api/deepseek/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messages: [
              { role: "system", content: "You are a query reformulation assistant. Your only job is to take a follow-up question and the conversation context, then output a single search-optimized query. Output ONLY the reformulated query, no other text or formatting." },
              ...messages.slice(0, -1).map((m: any) => 
                m.role === "user" 
                  ? { role: "user", content: m.content }
                  : { role: "assistant", content: m.content }
              ),
              { role: "user", content: `Given this context, reformulate this question into a single, clear search query: ${currentInput}` }
            ],
            searchResults: []
          }),
        });

        if (reformulationResponse.ok) {
          const reader = reformulationResponse.body?.getReader();
          let reformulatedQuery = '';
          
          if (reader) {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              
              const text = new TextDecoder().decode(value);
              reformulatedQuery += text;
            }
          }

          if (reformulatedQuery.trim()) {
            // Clean up any XML-like tags and extra formatting
            searchQuery = reformulatedQuery
              .replace(/<[^>]*>/g, '') // Remove XML tags
              .replace(/^["\s]+|["\s]+$/g, '') // Remove quotes and extra whitespace
              .replace(/\n/g, ' ') // Replace newlines with spaces
              .trim();
            console.log('Using reformulated query:', searchQuery);
          }
        }
      }

      // Start streaming search results using the potentially reformulated query
      const searchStream = performSearch(searchQuery);
      
      // Update sources as they come in, preserving previous sources until new ones arrive
      let newSources: SearchResult[] = [];
      for await (const result of await searchStream) {
        newSources.push(result);
        setStreamingState(prev => ({
          ...prev,
          sources: newSources // Update with accumulated new sources
        }));
      }

      // Now send to AI with complete search results and original query
      await originalHandleSubmit(e);
    } catch (error) {
      console.error('Search error:', error);
      // On error, preserve the previous sources
      setStreamingState(prev => ({
        ...prev,
        thinking: '',
        content: 'Sorry, there was an error processing your request.',
        isThinking: false
      }));
    }
  };

  // Handle streaming content
  useEffect(() => {
    if (!messages.length) return;
    
    const lastMessage = messages[messages.length - 1];
    if (lastMessage.role !== 'assistant') return;

    const content = lastMessage.content;
    const thinkRegex = /<think>([^]*?)<\/think>/;
    const thinkMatch = content.match(thinkRegex);
    
    if (content.includes('<think>') && !thinkingStartTime.current) {
      thinkingStartTime.current = Date.now();
    }
    
    if (thinkMatch) {
      setStreamingState(prev => ({
        ...prev,
        thinking: thinkMatch[1].trim(),
        content: content.replace(thinkRegex, '').trim(),
        isThinking: false
      }));
      thinkingStartTime.current = null;
    } else if (content.includes('<think>')) {
      setStreamingState(prev => ({
        ...prev,
        thinking: content.replace('<think>', '').trim(),
        content: '',
        isThinking: true
      }));
    } else if (streamingState.isThinking) {
      setStreamingState(prev => ({
        ...prev,
        thinking: content.trim()
      }));
    } else {
      setStreamingState(prev => ({
        ...prev,
        content: content.trim()
      }));
    }
  }, [messages]);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Optimize scroll behavior
  const scrollToBottom = useCallback(() => {
    if (!messagesEndRef.current) return;
    messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Scroll on content updates
  useEffect(() => {
    if (streamingState.content || streamingState.thinking) {
      scrollToBottom();
    }
  }, [streamingState.content, streamingState.thinking, scrollToBottom]);

  return (
    <div className="flex flex-col h-screen bg-black">
      {/* Title */}
      <div className="fixed top-6 left-7 text-4xl font-regular text-gray-200 font-mono z-20">
        SandyPPLX
      </div>

      {/* Chat messages */}
      <div 
        ref={chatContainerRef}
        className="flex-1 overflow-y-auto p-4 pb-32 pt-24"
      >
        <div className="max-w-[55%] mx-auto space-y-6">
          {messages.map((message, i) => {
            const isLastMessage = i === messages.length - 1;
            const parsedContent = message.role === 'assistant' 
              ? parseMessage(message.content)
              : { content: message.content };

            if (message.role === 'assistant' && isLastMessage && (streamingState.thinking || streamingState.content)) {
              return (
                <div key={i} className="flex flex-col space-y-4">
                  {/* Always show Sources dropdown when available */}
                  {streamingState.sources.length > 0 && (
                    <details 
                      className="mb-4" 
                      open={isSourcesOpen}
                      onToggle={(e) => setIsSourcesOpen((e.target as HTMLDetailsElement).open)}
                    >
                      <summary className="cursor-pointer text-sm text-white p-2 hover:bg-neutral-800 rounded-none transition-colors flex items-center gap-2 select-none font-mono border-2 border-blue-500">
                        <svg 
                          className={`w-3 h-3 transform transition-transform ${isSourcesOpen ? 'rotate-0' : '-rotate-90'}`}
                          fill="none" 
                          stroke="currentColor" 
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                        <span>Sources</span>
                      </summary>
                      <div className="mt-2">
                        <SearchResults 
                          results={streamingState.sources} 
                          isSearching={isSearching}
                          error={searchError} 
                        />
                      </div>
                    </details>
                  )}

                  {/* Show thinking state */}
                  {streamingState.thinking && (
                    <details 
                      className="mb-4" 
                      open={isOpen}
                      onToggle={(e) => setIsOpen((e.target as HTMLDetailsElement).open)}
                    >
                      <summary className="cursor-pointer text-sm text-white p-2 hover:bg-neutral-800 rounded-none transition-colors flex items-center gap-2 select-none font-mono border-2 border-white">
                        <svg 
                          className={`w-3 h-3 transform transition-transform ${isOpen ? 'rotate-0' : '-rotate-90'}`}
                          fill="none" 
                          stroke="currentColor" 
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                        <span>
                          {streamingState.content ? 'Thoughts' : 'Thinking'}
                        </span>
                      </summary>
                      <div className="mt-2 text-sm text-gray-400 pl-4 border-l-2 border-white">
                        <div className="prose prose-invert prose-thinking max-w-none font-mono">
                          <ReactMarkdown
                            components={{
                              p: ({ children }) => (
                                <p className="whitespace-pre-wrap my-2">{children}</p>
                              ),
                              ul: ({ children }) => (
                                <ul className="list-disc pl-4 space-y-1">{children}</ul>
                              ),
                              li: ({ children }) => (
                                <li className="my-0">{children}</li>
                              )
                            }}
                          >
                            {streamingState.thinking}
                          </ReactMarkdown>
                        </div>
                      </div>
                    </details>
                  )}

                  {/* Show final response */}
                  {streamingState.content && (
                    <div className="prose prose-invert prose-response max-w-none font-mono text-gray-300">
                      <ReactMarkdown
                        components={{
                          p: ({ children }: ParagraphProps) => (
                            <p className="whitespace-pre-wrap my-4">{children}</p>
                          ),
                          h2: ({ children }: ParagraphProps) => (
                            <h2 className="text-xl font-bold mt-8 mb-4">{children}</h2>
                          ),
                          h3: ({ children }: ParagraphProps) => (
                            <h3 className="text-lg font-bold mt-6 mb-3">{children}</h3>
                          ),
                          pre: ({ children }: PreProps) => (
                            <div className="overflow-auto my-4 p-2 bg-gray-800 rounded">
                              <pre className="text-gray-100">{children}</pre>
                            </div>
                          ),
                          code: ({ inline, className, children }: CodeProps) => {
                            const match = /language-(\w+)/.exec(className || '');
                            return inline ? (
                              <code className="bg-gray-800 text-gray-100 rounded px-1">{children}</code>
                            ) : (
                              <pre className="overflow-auto my-4 p-2 bg-gray-800 rounded">
                                <code className={className}>{children}</code>
                              </pre>
                            );
                          },
                          a: ({ href, children }: ComponentPropsWithoutRef<'a'>) => (
                            <a
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-400 hover:text-blue-300 transition-colors"
                            >
                              {children}
                            </a>
                          ),
                          ul: ({ children }: ListProps) => (
                            <ul className="list-disc pl-4 my-4 space-y-2">{children}</ul>
                          ),
                          ol: ({ children }: ListProps) => (
                            <ol className="list-decimal pl-4 my-4 space-y-2">{children}</ol>
                          ),
                          li: ({ children }: ListItemProps) => (
                            <li className="my-1">{children}</li>
                          )
                        }}
                      >
                        {streamingState.content}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>
              );
            }

            if (message.role === 'user') {
              return (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[80%] px-4 py-2 bg-white text-black font-mono font-bold">
                    {message.content}
                  </div>
                </div>
              );
            }

            return (
              <div key={i} className="flex flex-col">
                {parsedContent.thinking && (
                  <details 
                    className="mb-4" 
                    open={isOpen}
                    onToggle={(e) => setIsOpen((e.target as HTMLDetailsElement).open)}
                  >
                    <summary className="cursor-pointer text-sm text-white p-2 hover:bg-neutral-800 rounded-none transition-colors flex items-center gap-2 select-none font-mono border-2 border-white">
                      <svg 
                        className={`w-3 h-3 transform transition-transform ${isOpen ? 'rotate-0' : '-rotate-90'}`}
                        fill="none" 
                        stroke="currentColor" 
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                      <span>Thoughts</span>
                    </summary>
                    <div className="mt-2 text-sm text-gray-400 pl-4 border-l-2 border-white">
                      <div className="prose prose-invert prose-thinking max-w-none font-mono">
                        <ReactMarkdown className="whitespace-pre-wrap">
                          {parsedContent.thinking}
                        </ReactMarkdown>
                      </div>
                    </div>
                  </details>
                )}
                <div className="prose prose-invert prose-response max-w-none font-mono text-gray-300">
                  <ReactMarkdown
                    components={{
                      p: ({ children }: ParagraphProps) => (
                        <p className="whitespace-pre-wrap my-4">{children}</p>
                      ),
                      h2: ({ children }: ParagraphProps) => (
                        <h2 className="text-xl font-bold mt-8 mb-4">{children}</h2>
                      ),
                      h3: ({ children }: ParagraphProps) => (
                        <h3 className="text-lg font-bold mt-6 mb-3">{children}</h3>
                      ),
                      pre: ({ children }: PreProps) => (
                        <div className="overflow-auto my-4 p-2 bg-gray-800 rounded">
                          <pre className="text-gray-100">{children}</pre>
                        </div>
                      ),
                      code: ({ inline, className, children }: CodeProps) => {
                        const match = /language-(\w+)/.exec(className || '');
                        return inline ? (
                          <code className="bg-gray-800 text-gray-100 rounded px-1">{children}</code>
                        ) : (
                          <pre className="overflow-auto my-4 p-2 bg-gray-800 rounded">
                            <code className={className}>{children}</code>
                          </pre>
                        );
                      },
                      a: ({ href, children }: ComponentPropsWithoutRef<'a'>) => (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-400 hover:text-blue-300 transition-colors"
                        >
                          {children}
                        </a>
                      ),
                      ul: ({ children }: ListProps) => (
                        <ul className="list-disc pl-4 my-4 space-y-2">{children}</ul>
                      ),
                      ol: ({ children }: ListProps) => (
                        <ol className="list-decimal pl-4 my-4 space-y-2">{children}</ol>
                      ),
                      li: ({ children }: ListItemProps) => (
                        <li className="my-1">{children}</li>
                      )
                    }}
                  >
                    {parsedContent.content}
                  </ReactMarkdown>
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} className="h-px" />
        </div>
      </div>

      {/* Floating Input form with solid background - adjusted width */}
      <div className={`transition-all duration-500 ease-in-out ${
        messages.length === 0 
          ? 'fixed top-1/2 left-1/2 -translate-y-1/2 -translate-x-1/2 w-[45%]' 
          : 'fixed bottom-0 left-[15%] right-[15%] px-4 py-6 bg-black'
      }`}>
        <div className={messages.length > 0 ? 'w-full' : 'w-full'}>
          {messages.length === 0 && (
            <h1 className="text-4xl text-gray-300 font-light text-center mb-8 font-mono">
              Hi, I'm your Local AI Assistant.
            </h1>
          )}
          <form onSubmit={handleSubmit} className="relative">
            <input
              value={input}
              onChange={handleInputChange}
              placeholder="Ask a question..."
              className="w-full rounded-none bg-black border-2 border-white p-4 text-white placeholder-gray-400 focus:outline-none focus:border-white font-mono"
            />
            <button
              type="submit"
              disabled={isSearching || isLoading || !input.trim()}
              className="group absolute right-3 top-1/2 -translate-y-1/2 px-4 py-2 rounded-none bg-black border-2 border-white text-white font-mono hover:bg-white hover:text-black disabled:cursor-not-allowed flex items-center justify-center w-[50px] h-[36px] transition-colors"
            >
              {(isSearching || isLoading) ? <LoadingSpinner /> : (
                <svg 
                  width="16" 
                  height="16" 
                  viewBox="0 0 24 24" 
                  fill="none" 
                  stroke="currentColor" 
                  className="text-white group-hover:text-black -rotate-90 transform"
                >
                  <path 
                    strokeLinecap="round" 
                    strokeLinejoin="round" 
                    strokeWidth={2} 
                    d="M14 5l7 7-7 7M21 12H3"
                  />
                </svg>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
} 