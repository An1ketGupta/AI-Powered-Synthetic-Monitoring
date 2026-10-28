/**
 * Workers AI models used by EdgeWatch. Pinned here rather than inline so
 * the summarization model can be swapped without touching prompt logic.
 */
export const SUMMARY_MODEL = "@cf/meta/llama-3.1-8b-instruct";

/** 768-dimension embeddings -- must match the Vectorize index dimensions. */
export const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";
export const EMBEDDING_DIMENSIONS = 768;
