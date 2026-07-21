//! 工作区 CRUD 操作。

use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};

// ============================================================================
// 数据结构
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct WorkspaceDocument {
    pub id: String,
    pub workspace_id: String,
    pub source_path: String,
    pub filename: String,
    pub mime_type: Option<String>,
    pub size_bytes: Option<i64>,
    pub extraction_status: String,
    pub extracted_text_path: Option<String>,
    pub extracted_text_hash: Option<String>,
    pub last_error: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct WorkspaceDraft {
    pub id: String,
    pub workspace_id: String,
    pub title: String,
    pub content_md: String,
    pub source: String,
    pub status: String,
    pub version: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct WorkspaceConversation {
    pub id: String,
    pub workspace_id: String,
    pub title: String,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct WorkspaceMessage {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    pub model: Option<String>,
    pub prompt_tokens: Option<i64>,
    pub completion_tokens: Option<i64>,
    pub latency_ms: Option<i64>,
    pub based_on: Option<String>,
    pub artifact_draft_id: Option<String>,
    pub error_short: Option<String>,
    pub citations_json: Option<String>,
    pub created_at: String,
}

// ============================================================================
// Workspace CRUD
// ============================================================================

pub async fn create_workspace(
    pool: &SqlitePool,
    name: &str,
    description: Option<&str>,
) -> Result<Workspace, sqlx::Error> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    sqlx::query(
        "INSERT INTO workspaces (id, name, description, status, created_at, updated_at) \
         VALUES (?, ?, ?, 'active', ?, ?)",
    )
    .bind(&id)
    .bind(name)
    .bind(description)
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await?;
    Ok(Workspace {
        id,
        name: name.to_string(),
        description: description.map(|s| s.to_string()),
        status: "active".to_string(),
        created_at: now.clone(),
        updated_at: now,
    })
}

pub async fn list_workspaces(pool: &SqlitePool) -> Result<Vec<Workspace>, sqlx::Error> {
    sqlx::query_as::<_, Workspace>(
        "SELECT * FROM workspaces WHERE status = 'active' ORDER BY updated_at DESC",
    )
    .fetch_all(pool)
    .await
}

pub async fn get_workspace(pool: &SqlitePool, id: &str) -> Result<Option<Workspace>, sqlx::Error> {
    sqlx::query_as::<_, Workspace>("SELECT * FROM workspaces WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn rename_workspace(
    pool: &SqlitePool,
    id: &str,
    name: &str,
) -> Result<(), sqlx::Error> {
    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    sqlx::query("UPDATE workspaces SET name = ?, updated_at = ? WHERE id = ?")
        .bind(name)
        .bind(&now)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn archive_workspace(pool: &SqlitePool, id: &str) -> Result<(), sqlx::Error> {
    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    sqlx::query("UPDATE workspaces SET status = 'archived', updated_at = ? WHERE id = ?")
        .bind(&now)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn delete_workspace(pool: &SqlitePool, id: &str) -> Result<(), sqlx::Error> {
    // ON DELETE CASCADE 会自动清理子表
    sqlx::query("DELETE FROM workspaces WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

// ============================================================================
// WorkspaceDocument CRUD
// ============================================================================

pub async fn add_workspace_documents(
    pool: &SqlitePool,
    workspace_id: &str,
    docs: &[(String, String, Option<String>, Option<i64>)], // (id, source_path, mime_type, size_bytes)
) -> Result<Vec<WorkspaceDocument>, sqlx::Error> {
    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    let mut results = Vec::new();
    for (id, source_path, mime_type, size_bytes) in docs {
        let filename = std::path::Path::new(source_path)
            .file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_else(|| "未知文件".to_string());
        sqlx::query(
            "INSERT INTO workspace_documents \
             (id, workspace_id, source_path, filename, mime_type, size_bytes, extraction_status, created_at) \
             VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)",
        )
        .bind(id)
        .bind(workspace_id)
        .bind(source_path)
        .bind(&filename)
        .bind(mime_type)
        .bind(size_bytes)
        .bind(&now)
        .execute(pool)
        .await?;
        results.push(WorkspaceDocument {
            id: id.clone(),
            workspace_id: workspace_id.to_string(),
            source_path: source_path.clone(),
            filename,
            mime_type: mime_type.clone(),
            size_bytes: *size_bytes,
            extraction_status: "pending".to_string(),
            extracted_text_path: None,
            extracted_text_hash: None,
            last_error: None,
            created_at: now.clone(),
        });
    }
    Ok(results)
}

pub async fn list_workspace_documents(
    pool: &SqlitePool,
    workspace_id: &str,
) -> Result<Vec<WorkspaceDocument>, sqlx::Error> {
    sqlx::query_as::<_, WorkspaceDocument>(
        "SELECT * FROM workspace_documents WHERE workspace_id = ? ORDER BY created_at ASC",
    )
    .bind(workspace_id)
    .fetch_all(pool)
    .await
}

pub async fn get_workspace_document(
    pool: &SqlitePool,
    id: &str,
) -> Result<Option<WorkspaceDocument>, sqlx::Error> {
    sqlx::query_as::<_, WorkspaceDocument>("SELECT * FROM workspace_documents WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn remove_workspace_document(
    pool: &SqlitePool,
    id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM workspace_documents WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn update_document_extraction(
    pool: &SqlitePool,
    id: &str,
    status: &str,
    text_path: Option<&str>,
    text_hash: Option<&str>,
    error: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE workspace_documents \
         SET extraction_status = ?, extracted_text_path = ?, extracted_text_hash = ?, last_error = ? \
         WHERE id = ?",
    )
    .bind(status)
    .bind(text_path)
    .bind(text_hash)
    .bind(error)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

// ============================================================================
// WorkspaceDraft CRUD
// ============================================================================

pub async fn create_draft(
    pool: &SqlitePool,
    workspace_id: &str,
    title: &str,
) -> Result<WorkspaceDraft, sqlx::Error> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    sqlx::query(
        "INSERT INTO workspace_drafts \
         (id, workspace_id, title, content_md, source, status, version, created_at, updated_at) \
         VALUES (?, ?, ?, '', 'user', 'draft', 1, ?, ?)",
    )
    .bind(&id)
    .bind(workspace_id)
    .bind(title)
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await?;
    Ok(WorkspaceDraft {
        id,
        workspace_id: workspace_id.to_string(),
        title: title.to_string(),
        content_md: String::new(),
        source: "user".to_string(),
        status: "draft".to_string(),
        version: 1,
        created_at: now.clone(),
        updated_at: now,
    })
}

pub async fn list_drafts(
    pool: &SqlitePool,
    workspace_id: &str,
) -> Result<Vec<WorkspaceDraft>, sqlx::Error> {
    sqlx::query_as::<_, WorkspaceDraft>(
        "SELECT * FROM workspace_drafts WHERE workspace_id = ? ORDER BY updated_at DESC",
    )
    .bind(workspace_id)
    .fetch_all(pool)
    .await
}

pub async fn get_draft(pool: &SqlitePool, id: &str) -> Result<Option<WorkspaceDraft>, sqlx::Error> {
    sqlx::query_as::<_, WorkspaceDraft>("SELECT * FROM workspace_drafts WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn update_draft_content(
    pool: &SqlitePool,
    id: &str,
    content_md: &str,
) -> Result<(), sqlx::Error> {
    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    sqlx::query("UPDATE workspace_drafts SET content_md = ?, updated_at = ? WHERE id = ?")
        .bind(content_md)
        .bind(&now)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn delete_draft(pool: &SqlitePool, id: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM workspace_drafts WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn mark_draft_final(pool: &SqlitePool, id: &str) -> Result<(), sqlx::Error> {
    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    sqlx::query("UPDATE workspace_drafts SET status = 'final', updated_at = ? WHERE id = ?")
        .bind(&now)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

// ============================================================================
// WorkspaceConversation CRUD
// ============================================================================

pub async fn create_conversation(
    pool: &SqlitePool,
    workspace_id: &str,
    title: Option<&str>,
) -> Result<WorkspaceConversation, sqlx::Error> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    let title = title.unwrap_or("新对话");
    sqlx::query(
        "INSERT INTO workspace_conversations \
         (id, workspace_id, title, sort_order, created_at, updated_at) \
         VALUES (?, ?, ?, 0, ?, ?)",
    )
    .bind(&id)
    .bind(workspace_id)
    .bind(title)
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await?;
    Ok(WorkspaceConversation {
        id,
        workspace_id: workspace_id.to_string(),
        title: title.to_string(),
        sort_order: 0,
        created_at: now.clone(),
        updated_at: now,
    })
}

pub async fn list_conversations(
    pool: &SqlitePool,
    workspace_id: &str,
) -> Result<Vec<WorkspaceConversation>, sqlx::Error> {
    sqlx::query_as::<_, WorkspaceConversation>(
        "SELECT * FROM workspace_conversations WHERE workspace_id = ? ORDER BY sort_order ASC, created_at ASC",
    )
    .bind(workspace_id)
    .fetch_all(pool)
    .await
}

pub async fn get_workspace_conversation(
    pool: &SqlitePool,
    id: &str,
) -> Result<Option<WorkspaceConversation>, sqlx::Error> {
    sqlx::query_as::<_, WorkspaceConversation>("SELECT * FROM workspace_conversations WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn rename_conversation(
    pool: &SqlitePool,
    id: &str,
    title: &str,
) -> Result<(), sqlx::Error> {
    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    sqlx::query("UPDATE workspace_conversations SET title = ?, updated_at = ? WHERE id = ?")
        .bind(title)
        .bind(&now)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn delete_conversation(pool: &SqlitePool, id: &str) -> Result<(), sqlx::Error> {
    // ON DELETE CASCADE 会自动清理 workspace_messages
    sqlx::query("DELETE FROM workspace_conversations WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

// ============================================================================
// WorkspaceMessage CRUD
// ============================================================================

pub async fn list_messages(
    pool: &SqlitePool,
    conversation_id: &str,
) -> Result<Vec<WorkspaceMessage>, sqlx::Error> {
    sqlx::query_as::<_, WorkspaceMessage>(
        "SELECT * FROM workspace_messages WHERE conversation_id = ? ORDER BY created_at ASC",
    )
    .bind(conversation_id)
    .fetch_all(pool)
    .await
}

pub async fn list_messages_limited(
    pool: &SqlitePool,
    conversation_id: &str,
    limit: i64,
) -> Result<Vec<WorkspaceMessage>, sqlx::Error> {
    sqlx::query_as::<_, WorkspaceMessage>(
        "SELECT * FROM ( \
           SELECT * FROM workspace_messages \
           WHERE conversation_id = ? \
           ORDER BY created_at DESC \
           LIMIT ? \
         ) ORDER BY created_at ASC",
    )
    .bind(conversation_id)
    .bind(limit)
    .fetch_all(pool)
    .await
}

pub async fn insert_message(
    pool: &SqlitePool,
    msg: &NewWorkspaceMessage<'_>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO workspace_messages \
         (id, conversation_id, role, content, model, prompt_tokens, completion_tokens, \
          latency_ms, based_on, artifact_draft_id, error_short, citations_json, created_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(msg.id)
    .bind(msg.conversation_id)
    .bind(msg.role)
    .bind(msg.content)
    .bind(msg.model)
    .bind(msg.prompt_tokens)
    .bind(msg.completion_tokens)
    .bind(msg.latency_ms)
    .bind(msg.based_on)
    .bind(msg.artifact_draft_id)
    .bind(msg.error_short)
    .bind(msg.citations_json)
    .bind(msg.created_at)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn clear_messages(pool: &SqlitePool, conversation_id: &str) -> Result<u64, sqlx::Error> {
    let res = sqlx::query("DELETE FROM workspace_messages WHERE conversation_id = ?")
        .bind(conversation_id)
        .execute(pool)
        .await?;
    Ok(res.rows_affected())
}

/// 新建消息的入参。
pub struct NewWorkspaceMessage<'a> {
    pub id: &'a str,
    pub conversation_id: &'a str,
    pub role: &'a str,
    pub content: &'a str,
    pub model: Option<&'a str>,
    pub prompt_tokens: Option<i64>,
    pub completion_tokens: Option<i64>,
    pub latency_ms: Option<i64>,
    pub based_on: Option<&'a str>,
    pub artifact_draft_id: Option<&'a str>,
    pub error_short: Option<&'a str>,
    pub citations_json: Option<&'a str>,
    pub created_at: &'a str,
}

// ============================================================================
// 辅助函数
// ============================================================================

/// 获取工作区所有已抽取完成的材料路径（用于引用验证）。
pub async fn get_extracted_doc_paths(
    pool: &SqlitePool,
    workspace_id: &str,
) -> Result<Vec<(String, String)>, sqlx::Error> {
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT filename, extracted_text_path FROM workspace_documents \
         WHERE workspace_id = ? AND extraction_status = 'done' AND extracted_text_path IS NOT NULL",
    )
    .bind(workspace_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}
