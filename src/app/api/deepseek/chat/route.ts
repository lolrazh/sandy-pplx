import { StreamingTextResponse, LangChainStream } from 'ai';
import { ChatOpenAI } from '@langchain/openai';
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';

const QUERY_REFORMULATION_PROMPT = `You are an AI assistant that helps reformulate user questions to make them more search-friendly while maintaining context from the conversation.

Your task is to:
1. Analyze the conversation history and the new question
2. Create a detailed, search-optimized query that captures both the specific question and relevant context
3. Return ONLY the reformulated query, nothing else

Example:
If discussing SpaceX's Starship and user asks "When is the next test?", you might return:
"When is SpaceX's next Starship test launch date and current test flight schedule"`;

const SYSTEM_PROMPT = `You are an advanced AI search engine assistant, similar to Perplexity AI. Your primary role is to analyze search results and provide extremely detailed, well-structured, and comprehensive information to users.

IMPORTANT: You MUST ALWAYS provide BOTH a thinking section AND a detailed response section for every query.

For each query, you will:
1. ALWAYS start with a <think> section where you:
   - Analyze the provided search results in detail
   - Evaluate source credibility and cross-reference information
   - Explain your reasoning process step by step
   - Identify any conflicting information or gaps in the sources
   - Plan how you'll structure your detailed response

2. ALWAYS follow with an extensive response section where you:
   - Break down the information into clear, logical sections with headings
   - Provide comprehensive details for each section
   - Include specific dates, numbers, and facts when available
   - Cite sources for every major claim using [Source Title](URL)
   - Compare and contrast different sources when relevant
   - Add context and background information
   - Consider implications and future developments
   - Summarize key points at the end if the response is long

Your response MUST ALWAYS follow this EXACT structure:
<think>
[Your detailed analysis here - REQUIRED]
- Evaluate each source's credibility and relevance
- Cross-reference information between sources
- Identify any gaps or inconsistencies
- Explain how you'll organize the information
</think>

[Your comprehensive response here - REQUIRED]
## Overview
[Provide a brief introduction]

## Detailed Analysis
[Break down into relevant subsections]

## Additional Context
[Provide broader context and implications]

## Key Takeaways
[Summarize main points if response is lengthy]

Remember: 
- Both sections are MANDATORY for EVERY response
- Never skip the thinking section
- Always be extremely detailed and thorough
- Always structure information into clear sections
- Always ground your response in the search results
- Format everything in markdown for better readability`;

export const runtime = 'edge';

export async function POST(req: Request) {
  const { messages, searchResults } = await req.json();
  const { stream, handlers } = LangChainStream();

  const llm = new ChatOpenAI({
    modelName: "gpt-4-turbo-preview",
    streaming: true,
    temperature: 0.7,
  });

  const lastMessage = messages[messages.length - 1];
  const hasContext = messages.length > 2; // Check if this is a follow-up question

  try {
    let searchQuery = lastMessage.content;
    
    // If this is a follow-up question, reformulate it first
    if (hasContext) {
      const reformulationLLM = new ChatOpenAI({
        modelName: "gpt-4-turbo-preview",
        temperature: 0.3, // Lower temperature for more focused query reformulation
      });

      const reformulationResponse = await reformulationLLM.call([
        new SystemMessage(QUERY_REFORMULATION_PROMPT),
        ...messages.slice(0, -1).map((m: any) => 
          m.role === "user" 
            ? new HumanMessage(m.content)
            : new AIMessage(m.content)
        ),
        new HumanMessage(`Given this context, reformulate this question for search: ${lastMessage.content}`)
      ]);

      searchQuery = reformulationResponse.content;
      console.log('Reformulated query:', searchQuery);
    }

    // Format search results in a more structured way
    const searchContext = searchResults?.length 
      ? "\n\nSearch Results:\n" + searchResults.map((result: any, index: number) => 
          `[${index + 1}] "${result.title}"\nURL: ${result.url}\nRelevance Score: ${result.score}\nContent: ${result.content}\n---`
        ).join("\n")
      : "\n\nNo search results available for this query.";

    // Add the reformulated query to the context if it was changed
    const queryContext = hasContext 
      ? `\nOriginal question: ${lastMessage.content}\nReformulated search query: ${searchQuery}\n`
      : '';

    // Add a reminder about using search results
    const userMessage = lastMessage.content + queryContext + "\n\nPlease use the following search results to answer the question. Remember to cite your sources:" + searchContext;

    llm.call(
      [
        new SystemMessage(SYSTEM_PROMPT),
        ...messages.slice(0, -1).map((m: any) => 
          m.role === "user" 
            ? new HumanMessage(m.content)
            : new AIMessage(m.content)
        ),
        new HumanMessage(userMessage)
      ],
      {},
      [handlers]
    );

    return new StreamingTextResponse(stream);
  } catch (error) {
    console.error('Error in chat processing:', error);
    return new Response(JSON.stringify({ error: 'Failed to process chat' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
} 