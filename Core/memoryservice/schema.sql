-- <AI-CHAIN v1>
-- Map: CODEMAP.md
-- Owner: Core/memoryservice/AGENTS.md | ring 0
-- Chains: module-local; query impact before editing
-- Regions: module initialization / declarations
-- Impact: python -B scripts/code-atlas.py show Core/memoryservice/schema.sql
-- Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
-- </AI-CHAIN>

PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON;
 CREATE TABLE IF NOT EXISTS memories(id TEXT PRIMARY KEY,scope TEXT NOT NULL,kind TEXT NOT NULL,title TEXT NOT NULL,content TEXT NOT NULL,status TEXT NOT NULL,due INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL,updated INTEGER NOT NULL,revision INTEGER NOT NULL,source TEXT NOT NULL,dedupe TEXT UNIQUE);
 CREATE INDEX IF NOT EXISTS memory_recent ON memories(scope,updated DESC,id);
 CREATE INDEX IF NOT EXISTS memory_kind_recent ON memories(scope,kind,updated DESC,id);
 CREATE INDEX IF NOT EXISTS memory_title_recent ON memories(scope,kind,title,updated DESC);
 CREATE INDEX IF NOT EXISTS memory_status_recent ON memories(scope,kind,status,updated DESC,id);
 CREATE INDEX IF NOT EXISTS memory_plans ON memories(scope,kind,status,due,updated DESC);
 CREATE TABLE IF NOT EXISTS memory_terms(term TEXT NOT NULL,id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,updated INTEGER NOT NULL,scope TEXT NOT NULL,PRIMARY KEY(term,id));
 CREATE INDEX IF NOT EXISTS terms_recent ON memory_terms(scope,term,updated DESC,id);
 CREATE INDEX IF NOT EXISTS terms_by_memory ON memory_terms(id);
 CREATE TABLE IF NOT EXISTS keywords(term TEXT NOT NULL,scope TEXT NOT NULL,count INTEGER NOT NULL,last_seen INTEGER NOT NULL,PRIMARY KEY(scope,term));
 CREATE INDEX IF NOT EXISTS keyword_frequency ON keywords(scope,count DESC,last_seen DESC);
 CREATE INDEX IF NOT EXISTS keyword_recent ON keywords(scope,last_seen DESC,count DESC);
 CREATE TABLE IF NOT EXISTS memory_revisions(id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,revision INTEGER NOT NULL,content TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(id,revision));
 CREATE TABLE IF NOT EXISTS dreams(id TEXT PRIMARY KEY,scope TEXT NOT NULL,content TEXT NOT NULL,created INTEGER NOT NULL,watermark INTEGER NOT NULL,told INTEGER NOT NULL DEFAULT 0,claim TEXT NOT NULL DEFAULT '',lease INTEGER NOT NULL DEFAULT 0);
 CREATE INDEX IF NOT EXISTS dream_recent ON dreams(scope,created DESC);
 CREATE TABLE IF NOT EXISTS os_continuity(key TEXT PRIMARY KEY,digest TEXT NOT NULL,content TEXT NOT NULL,project TEXT NOT NULL,updated INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS os_continuity_receipts(key TEXT PRIMARY KEY,digest TEXT NOT NULL);
 INSERT OR IGNORE INTO os_continuity_receipts SELECT key,digest FROM os_continuity;
 CREATE TABLE IF NOT EXISTS os_continuity_state(id INTEGER PRIMARY KEY CHECK(id=1),epoch INTEGER NOT NULL,version INTEGER NOT NULL);
 INSERT OR IGNORE INTO os_continuity_state VALUES(1,0,0);
 CREATE TABLE IF NOT EXISTS transcript(session TEXT NOT NULL,pos INTEGER NOT NULL,at INTEGER NOT NULL,role TEXT NOT NULL,name TEXT NOT NULL DEFAULT '',content TEXT NOT NULL,truncated INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(session,pos));
 CREATE INDEX IF NOT EXISTS transcript_time ON transcript(at);
 CREATE TABLE IF NOT EXISTS transcript_sessions(session TEXT PRIMARY KEY,started INTEGER NOT NULL,updated INTEGER NOT NULL,covered INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS fast_memory(id INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,content TEXT NOT NULL,created INTEGER NOT NULL,session TEXT NOT NULL DEFAULT '',first_pos INTEGER NOT NULL DEFAULT 0,last_pos INTEGER NOT NULL DEFAULT 0,first_at INTEGER NOT NULL DEFAULT 0,last_at INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'active',source TEXT NOT NULL DEFAULT '');
 CREATE INDEX IF NOT EXISTS fast_memory_active ON fast_memory(status,kind,id);
 CREATE TABLE IF NOT EXISTS fast_memory_state(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL,migrated INTEGER NOT NULL);
 INSERT OR IGNORE INTO fast_memory_state VALUES(1,0,0);
 CREATE TABLE IF NOT EXISTS diaries(id INTEGER PRIMARY KEY AUTOINCREMENT,created INTEGER NOT NULL,title TEXT NOT NULL,content TEXT NOT NULL,first_at INTEGER NOT NULL DEFAULT 0,last_at INTEGER NOT NULL DEFAULT 0,sources TEXT NOT NULL DEFAULT '[]',shareable INTEGER NOT NULL DEFAULT 0,shared INTEGER NOT NULL DEFAULT 0,read INTEGER NOT NULL DEFAULT 0);
 CREATE INDEX IF NOT EXISTS diary_recent ON diaries(created DESC);
 CREATE TABLE IF NOT EXISTS pac_state(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL,migrated INTEGER NOT NULL);
 INSERT OR IGNORE INTO pac_state VALUES(1,0,0);
 CREATE TABLE IF NOT EXISTS pac_packets(id TEXT PRIMARY KEY,scope TEXT NOT NULL,kind TEXT NOT NULL,title TEXT NOT NULL,content TEXT NOT NULL,keywords TEXT NOT NULL,level INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL,first_at INTEGER NOT NULL,last_at INTEGER NOT NULL,source TEXT NOT NULL,session TEXT NOT NULL DEFAULT '',first_pos INTEGER NOT NULL DEFAULT 0,last_pos INTEGER NOT NULL DEFAULT -1,active INTEGER NOT NULL DEFAULT 1,request_key TEXT UNIQUE,digest TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS pac_roots ON pac_packets(scope,active,created,id);
 CREATE INDEX IF NOT EXISTS pac_source_range ON pac_packets(session,first_pos,last_pos);
 CREATE TABLE IF NOT EXISTS pac_children(parent TEXT NOT NULL REFERENCES pac_packets(id),child TEXT NOT NULL UNIQUE REFERENCES pac_packets(id),ordinal INTEGER NOT NULL,PRIMARY KEY(parent,child));
 CREATE TABLE IF NOT EXISTS pac_terms(term TEXT NOT NULL,id TEXT NOT NULL REFERENCES pac_packets(id) ON DELETE CASCADE,PRIMARY KEY(term,id));
 CREATE INDEX IF NOT EXISTS pac_terms_packet ON pac_terms(id);
 CREATE TABLE IF NOT EXISTS transcript_scopes(session TEXT PRIMARY KEY,scope TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS transcript_payloads(session TEXT NOT NULL,pos INTEGER NOT NULL,payload TEXT NOT NULL,digest TEXT NOT NULL,PRIMARY KEY(session,pos),FOREIGN KEY(session,pos) REFERENCES transcript(session,pos));
 PRAGMA user_version=2;
