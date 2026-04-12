export type {
  FactType,
  TensionType,
  ContradictionResolution,
  EditorialFact,
  EditorialContradiction,
  EditorialPieceLog,
  EditorialMemoryContext,
} from "./types.js";

export type { EditorialMemoryStore } from "./store.js";
export type { EmbeddingService } from "./embeddings.js";

export { OpenAIEmbeddingService } from "./openai-embeddings.js";
export { extractEditorialFacts } from "./fact-extractor.js";
export { assembleEditorialContext } from "./context-assembler.js";
export { InMemoryEditorialMemoryStore } from "./in-memory-store.js";
export {
  detectContradictions,
  containsAcknowledgmentLanguage,
} from "./contradiction-detector.js";
