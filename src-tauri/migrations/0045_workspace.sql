-- AI 事务工作区：独立于在办案件，为临时函件、专项材料或同一相关事项建立可持续工作区。

-- 1. workspaces 表
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',  -- active / archived
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 2. workspace_documents 表（原始材料，只读）
CREATE TABLE workspace_documents (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_path TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER,
  extraction_status TEXT NOT NULL DEFAULT 'pending',  -- pending/processing/done/failed
  extracted_text_path TEXT,
  extracted_text_hash TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_workspace_documents_workspace ON workspace_documents(workspace_id);

-- 3. workspace_drafts 表（可编辑文稿）
CREATE TABLE workspace_drafts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content_md TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'user',  -- user/ai/chat_to_draft
  status TEXT NOT NULL DEFAULT 'draft', -- draft/final
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_workspace_drafts_workspace ON workspace_drafts(workspace_id);

-- 4. workspace_conversations 表（独立对话页面）
CREATE TABLE workspace_conversations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '新对话',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_workspace_convos_workspace ON workspace_conversations(workspace_id);

-- 5. workspace_messages 表（对话消息）
CREATE TABLE workspace_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES workspace_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,  -- user / assistant
  content TEXT NOT NULL,
  model TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  latency_ms INTEGER,
  based_on TEXT,  -- JSON: 引用的材料 ID 列表
  artifact_draft_id TEXT,  -- 关联的文稿 ID（AI 回答转文稿时填）
  error_short TEXT,
  citations_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_workspace_messages_conv ON workspace_messages(conversation_id);
