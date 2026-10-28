/**
 * Workers AI models used by EdgeWatch. Pinned here rather than inline so the
 * summarization model can be swapped without touching prompt logic.
 *
 * Verify a model id still exists before changing it -- `wrangler ai models`
 * lists what the account can actually run. `env.AI.run()` throws on an unknown
 * id, which the summarizer catches and degrades from, so a typo here shows up
 * as "every incident note is a fallback" rather than as a loud failure.
 *
 * The 8B FP8 variant is deliberate: incident notes are three sentences, and a
 * larger model (e.g. @cf/meta/llama-3.3-70b-instruct-fp8-fast) costs enough
 * more Neurons per call to threaten the 10k/day free allowance on a flapping
 * monitor without writing a meaningfully better note.
 */
export const SUMMARY_MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8";

/** 768-dimension embeddings -- must match the Vectorize index dimensions. */
export const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";
export const EMBEDDING_DIMENSIONS = 768;
