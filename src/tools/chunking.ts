// pattern: Functional Core — semantic chunking with heading context

import { estimateTokens } from '../agent/context.ts';

// ── Chunking Types and Constants ────────────────────────────────────────

export type Chunk = {
  readonly index: number;
  readonly content: string;
  readonly heading: string;
  readonly tokenEstimate: number;
};

const LARGE_FILE_THRESHOLD = 4096;  // tokens
const TARGET_CHUNK_SIZE = 2048;     // tokens

export { LARGE_FILE_THRESHOLD, TARGET_CHUNK_SIZE };

// ── Semantic Chunking ──────────────────────────────────────────────────

export function chunkText(text: string): Array<Chunk> {
  // Handle empty/whitespace input
  if (!text.trim()) {
    return [];
  }

  const totalTokens = estimateTokens(text);

  // If file is small, return as single chunk
  if (totalTokens <= LARGE_FILE_THRESHOLD) {
    return [{
      index: 0,
      content: text,
      heading: '',
      tokenEstimate: totalTokens,
    }];
  }

  // Phase 1: Split on markdown headers (h1-h6)
  const lines = text.split('\n');
  const sections: Array<{ heading: string; content: string }> = [];
  let currentHeading = '';
  let currentLines: Array<string> = [];

  for (const line of lines) {
    const headerMatch = line.match(/^(#{1,6}) /);
    if (headerMatch) {
      // Save previous section if it has content
      const content = currentLines.join('\n');
      if (content.trim()) {
        sections.push({
          heading: currentHeading,
          content: currentHeading ? currentHeading + '\n' + content : content,
        });
      }
      currentHeading = line;
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  // Save final section
  const content = currentLines.join('\n');
  if (content.trim()) {
    sections.push({
      heading: currentHeading,
      content: currentHeading ? currentHeading + '\n' + content : content,
    });
  }

  // Phase 2-4: For each section, split recursively on paragraphs, then sentences
  const chunks: Array<Chunk> = [];

  for (const section of sections) {
    splitSection(section.content, section.heading, chunks);
  }

  // Filter empty chunks and renumber
  const finalChunks = chunks.filter((c) => c.content.trim());
  return finalChunks.map((c, idx) => ({ ...c, index: idx }));
}

function splitSection(content: string, heading: string, chunks: Array<Chunk>): void {
  const contentTokens = estimateTokens(content);

  // Base case: content fits in target
  if (contentTokens <= TARGET_CHUNK_SIZE) {
    if (content.trim()) {
      chunks.push({
        index: chunks.length,
        content,
        heading,
        tokenEstimate: contentTokens,
      });
    }
    return;
  }

  // Try splitting on paragraphs (double newlines)
  const paragraphs = content.split(/\n\n+/).filter((p) => p.trim());

  if (paragraphs.length > 1) {
    let accumulator = '';
    let accumulatorTokens = 0;

    for (const para of paragraphs) {
      const paraTokens = estimateTokens(para);

      if (accumulatorTokens + paraTokens > TARGET_CHUNK_SIZE && accumulator.trim()) {
        // Flush accumulator
        chunks.push({
          index: chunks.length,
          content: accumulator.trim(),
          heading,
          tokenEstimate: accumulatorTokens,
        });
        accumulator = para;
        accumulatorTokens = paraTokens;
      } else if (paraTokens > TARGET_CHUNK_SIZE) {
        // Paragraph exceeds target, split recursively on sentences
        if (accumulator.trim()) {
          chunks.push({
            index: chunks.length,
            content: accumulator.trim(),
            heading,
            tokenEstimate: accumulatorTokens,
          });
          accumulator = '';
          accumulatorTokens = 0;
        }
        splitOnSentences(para, heading, chunks);
      } else {
        // Paragraph fits, accumulate
        accumulator += (accumulator ? '\n\n' : '') + para;
        accumulatorTokens = estimateTokens(accumulator);
      }
    }

    if (accumulator.trim()) {
      chunks.push({
        index: chunks.length,
        content: accumulator.trim(),
        heading,
        tokenEstimate: accumulatorTokens,
      });
    }
  } else {
    // No paragraph breaks, split on sentences
    splitOnSentences(content, heading, chunks);
  }
}

function splitOnSentences(content: string, heading: string, chunks: Array<Chunk>): void {
  const contentTokens = estimateTokens(content);

  if (contentTokens <= TARGET_CHUNK_SIZE) {
    if (content.trim()) {
      chunks.push({
        index: chunks.length,
        content,
        heading,
        tokenEstimate: contentTokens,
      });
    }
    return;
  }

  // Split on sentence boundaries
  const sentences = splitBySentences(content);

  if (sentences.length > 1) {
    let accumulator = '';
    let accumulatorTokens = 0;

    for (const sent of sentences) {
      const sentTokens = estimateTokens(sent);

      if (accumulatorTokens + sentTokens > TARGET_CHUNK_SIZE && accumulator.trim()) {
        // Flush accumulator
        chunks.push({
          index: chunks.length,
          content: accumulator.trim(),
          heading,
          tokenEstimate: accumulatorTokens,
        });
        accumulator = sent;
        accumulatorTokens = sentTokens;
      } else if (sentTokens > TARGET_CHUNK_SIZE * 1.5) {
        // Sentence exceeds hard limit, hard-cut it
        if (accumulator.trim()) {
          chunks.push({
            index: chunks.length,
            content: accumulator.trim(),
            heading,
            tokenEstimate: accumulatorTokens,
          });
        }

        // Hard-cut the overly long sentence into manageable pieces
        hardCutContent(sent, heading, chunks);
        accumulator = '';
        accumulatorTokens = 0;
      } else {
        // Sentence fits, accumulate
        accumulator += (accumulator ? ' ' : '') + sent;
        accumulatorTokens = estimateTokens(accumulator);
      }
    }

    if (accumulator.trim()) {
      chunks.push({
        index: chunks.length,
        content: accumulator.trim(),
        heading,
        tokenEstimate: accumulatorTokens,
      });
    }
  } else {
    // No sentence breaks possible, hard-cut
    hardCutContent(content, heading, chunks);
  }
}

function hardCutContent(content: string, heading: string, chunks: Array<Chunk>): void {
  // Hard-cut strategy: split by character count targeting ~2048 tokens worth of characters
  const targetChars = TARGET_CHUNK_SIZE * 4; // 4 chars per token estimate
  let start = 0;

  while (start < content.length) {
    const end = Math.min(start + targetChars, content.length);
    const piece = content.slice(start, end);

    if (piece.trim()) {
      chunks.push({
        index: chunks.length,
        content: piece.trim(),
        heading,
        tokenEstimate: estimateTokens(piece),
      });
    }

    start = end;
  }
}

function splitBySentences(text: string): Array<string> {
  // Split on sentence boundaries: ". " followed by uppercase or ".\n"
  // Fallback: split on single period if no sentence breaks found
  const sentenceRegex = /(?<=[.!?])\s+(?=[A-Z])|(?<=[.!?])\n/;
  const sentences = text.split(sentenceRegex);

  // If no sentences split, just return the whole text as one unit
  if (sentences.length === 1) {
    return [text];
  }

  // Rejoin with appropriate delimiters and filter empties.
  // Note: whitespace delimiters (newlines) are lost during split, rejoined with spaces
  // for semantic chunking. Exact reconstruction is not a requirement.
  return sentences.filter((s) => s.trim()).map((s) => s.trim());
}
