-- Down migration: drop all editorial memory tables
DROP INDEX IF EXISTS "idx_facts_embedding_hnsw";
DROP INDEX IF EXISTS "idx_piece_logs_tenant_topic_published";
DROP INDEX IF EXISTS "idx_piece_logs_piece_id";
DROP INDEX IF EXISTS "idx_facts_active";
DROP INDEX IF EXISTS "idx_facts_tenant_topic_valid_from";
DROP INDEX IF EXISTS "idx_contradictions_pending";
DROP TABLE IF EXISTS "editorial_contradictions";
DROP TABLE IF EXISTS "editorial_piece_logs";
DROP TABLE IF EXISTS "editorial_facts";
