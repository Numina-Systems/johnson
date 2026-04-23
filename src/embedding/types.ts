// pattern: Functional Core

export type EmbeddingProvider = {
  embed(text: string): Promise<Array<number>>;
  embedBatch(texts: ReadonlyArray<string>): Promise<Array<Array<number>>>;
  dimensions: number;
};
