# Issue 002: hybridSearch loads all embeddings into memory

**Severity:** Medium — performance ceiling  
**Component:** `src/search/hybrid.ts`

## Problem

`hybridSearch()` calls `getAllEmbeddings()` which loads every stored embedding into JavaScript memory, then computes cosine similarity against each one. This is O(n) per query in both memory and CPU.

Manageable for hundreds of documents but will degrade as the knowledge base grows.

## Expected Behaviour

Vector similarity should be computed at the database layer for sub-linear scaling.

## Proposed Fix

- Integrate `sqlite-vec` extension for in-database vector search
- Fall back to current JS implementation if extension is unavailable
- Consider HNSW indexing for large document counts
