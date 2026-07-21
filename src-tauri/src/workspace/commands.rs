//! 工作区 Tauri commands（CRUD + 聊天）。

use sqlx::SqlitePool;
use tauri::Emitter;

use super::db;

// ============================================================================
// 请求/响应类型
// ============================================================================

#[derive(serde::Deserialize)]
pub struct CreateWorkspaceInput {
    pub name: String,
    pub description: Option<String>,
}

#[derive(serde::Serialize)]
pub struct WorkspaceInfo {
    pub workspace: db::Workspace,
    pub document_count: i64,
    pub draft_count: i64,
    pub conversation_count: i64,
}

// ============================================================================
// 工作区管理
// ============================================================================

#[tauri::command]
pub async fn workspace_create(
    pool: tauri::State<'_, SqlitePool>,
    input: CreateWorkspaceInput,
) -> Result<db::Workspace, String> {
    db::create_workspace(pool.inner(), &input.name, input.description.as_deref())
        .await
        .map_err(|e| format!("创建工作区失败: {}", e))
}

#[tauri::command]
pub async fn workspace_list(
    pool: tauri::State<'_, SqlitePool>,
) -> Result<Vec<WorkspaceInfo>, String> {
    let workspaces = db::list_workspaces(pool.inner())
        .await
        .map_err(|e| format!("读取工作区列表失败: {}", e))?;

    let mut infos = Vec::new();
    for ws in workspaces {
        let doc_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM workspace_documents WHERE workspace_id = ?",
        )
        .bind(&ws.id)
        .fetch_one(pool.inner())
        .await
        .unwrap_or(0);

        let draft_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM workspace_drafts WHERE workspace_id = ?",
        )
        .bind(&ws.id)
        .fetch_one(pool.inner())
        .await
        .unwrap_or(0);

        let conv_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM workspace_conversations WHERE workspace_id = ?",
        )
        .bind(&ws.id)
        .fetch_one(pool.inner())
        .await
        .unwrap_or(0);

        infos.push(WorkspaceInfo {
            workspace: ws,
            document_count: doc_count,
            draft_count: draft_count,
            conversation_count: conv_count,
        });
    }
    Ok(infos)
}

#[tauri::command]
pub async fn workspace_get(
    pool: tauri::State<'_, SqlitePool>,
    id: String,
) -> Result<db::Workspace, String> {
    db::get_workspace(pool.inner(), &id)
        .await
        .map_err(|e| format!("读取工作区失败: {}", e))?
        .ok_or_else(|| "工作区不存在".to_string())
}

#[tauri::command]
pub async fn workspace_rename(
    pool: tauri::State<'_, SqlitePool>,
    id: String,
    name: String,
) -> Result<(), String> {
    db::rename_workspace(pool.inner(), &id, &name)
        .await
        .map_err(|e| format!("重命名工作区失败: {}", e))
}

#[tauri::command]
pub async fn workspace_archive(
    pool: tauri::State<'_, SqlitePool>,
    id: String,
) -> Result<(), String> {
    db::archive_workspace(pool.inner(), &id)
        .await
        .map_err(|e| format!("归档工作区失败: {}", e))
}

#[tauri::command]
pub async fn workspace_delete(
    pool: tauri::State<'_, SqlitePool>,
    id: String,
) -> Result<(), String> {
    // 先获取所有材料的 extracted_text_path，删除磁盘文件
    let docs = db::list_workspace_documents(pool.inner(), &id)
        .await
        .map_err(|e| format!("读取材料列表失败: {}", e))?;
    for doc in &docs {
        if let Some(ref path) = doc.extracted_text_path {
            let _ = std::fs::remove_file(path);
        }
    }
    // 删除数据库记录（ON DELETE CASCADE 自动清理子表）
    db::delete_workspace(pool.inner(), &id)
        .await
        .map_err(|e| format!("删除工作区失败: {}", e))
}

// ============================================================================
// 工作区材料
// ============================================================================

#[tauri::command]
pub async fn workspace_add_documents(
    pool: tauri::State<'_, SqlitePool>,
    workspace_id: String,
    paths: Vec<String>,
) -> Result<Vec<db::WorkspaceDocument>, String> {
    let mut docs = Vec::new();
    for path in &paths {
        let p = std::path::Path::new(path);
        if !p.exists() {
            continue;
        }
        let metadata = std::fs::metadata(p).ok();
        let size = metadata.as_ref().map(|m| m.len() as i64);
        let ext = p
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        let mime = match ext.as_str() {
            "pdf" => "application/pdf",
            "doc" | "docx" => "application/msword",
            "txt" | "md" => "text/plain",
            "html" | "htm" => "text/html",
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            _ => "application/octet-stream",
        }
        .to_string();
        let id = uuid::Uuid::new_v4().to_string();
        docs.push((id, path.clone(), Some(mime), size));
    }
    db::add_workspace_documents(pool.inner(), &workspace_id, &docs)
        .await
        .map_err(|e| format!("添加材料失败: {}", e))
}

#[tauri::command]
pub async fn workspace_list_documents(
    pool: tauri::State<'_, SqlitePool>,
    workspace_id: String,
) -> Result<Vec<db::WorkspaceDocument>, String> {
    db::list_workspace_documents(pool.inner(), &workspace_id)
        .await
        .map_err(|e| format!("读取材料列表失败: {}", e))
}

#[tauri::command]
pub async fn workspace_remove_document(
    pool: tauri::State<'_, SqlitePool>,
    id: String,
) -> Result<(), String> {
    // 先获取文档记录，删除磁盘文件
    if let Ok(Some(doc)) = db::get_workspace_document(pool.inner(), &id).await {
        if let Some(ref path) = doc.extracted_text_path {
            let _ = std::fs::remove_file(path);
        }
    }
    db::remove_workspace_document(pool.inner(), &id)
        .await
        .map_err(|e| format!("删除材料失败: {}", e))
}

#[tauri::command]
pub async fn workspace_extract_document(
    pool: tauri::State<'_, SqlitePool>,
    id: String,
) -> Result<String, String> {
    let doc = db::get_workspace_document(pool.inner(), &id)
        .await
        .map_err(|e| format!("读取材料信息失败: {}", e))?
        .ok_or_else(|| "材料不存在".to_string())?;

    // 已抽取完成且文本文件存在：直接返回内容，避免重复抽取
    if doc.extraction_status == "done" {
        if let Some(ref p) = doc.extracted_text_path {
            let path = std::path::Path::new(p);
            if path.exists() {
                return std::fs::read_to_string(path)
                    .map_err(|e| format!("读取抽取文本失败: {}", e));
            }
        }
    }

    // 正在抽取中（例如上传时自动抽取尚未结束）：等待其完成，避免并发重复抽取。
    // OCR（云端 MinerU/Paddle 或本机 vision）可能耗时数分钟（多页扫描件），
    // 这里等待上限放宽到 10 分钟，覆盖常规 OCR；超时则返回"仍在抽取中"，
    // 不再兜底重抽——避免对同一份扫描件并发跑两次 OCR 浪费云端积分。
    if doc.extraction_status == "processing" {
        let mut done_but_missing = false;
        for _ in 0..1200 {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            match db::get_workspace_document(pool.inner(), &id).await {
                Ok(Some(cur)) if cur.extraction_status == "done" => {
                    if let Some(ref p) = cur.extracted_text_path {
                        let path = std::path::Path::new(p);
                        if path.exists() {
                            return std::fs::read_to_string(path)
                                .map_err(|e| format!("读取抽取文本失败: {}", e));
                        }
                    }
                    // done 但文本文件缺失：罕见的腐败态，跳出后重抽
                    done_but_missing = true;
                    break;
                }
                Ok(Some(cur)) if cur.extraction_status == "failed" => {
                    return Err(format!(
                        "抽取失败: {}",
                        cur.last_error.unwrap_or_else(|| "未知错误".to_string())
                    ));
                }
                Ok(Some(cur)) if cur.extraction_status == "processing" => continue,
                _ => break,
            }
        }
        if !done_but_missing {
            // 仍在处理中（OCR 较慢或前一次抽取卡住）：不重复抽取，提示稍后重试
            return Err(
                "该材料仍在抽取中（OCR 可能较慢），请稍后重试。若长时间无变化，可删除后重新上传。"
                    .to_string(),
            );
        }
        // done_but_missing：继续走下面的重抽流程
    }

    // 标记为处理中
    db::update_document_extraction(pool.inner(), &id, "processing", None, None, None)
        .await
        .map_err(|e| format!("更新状态失败: {}", e))?;

    // 创建目标目录
    let workspace_id = &doc.workspace_id;
    let extracts_dir = crate::db::app_data_dir()
        .map_err(|e| format!("获取数据目录失败: {}", e))?
        .join("extracts")
        .join("workspace")
        .join(workspace_id);
    std::fs::create_dir_all(&extracts_dir)
        .map_err(|e| format!("创建目录失败: {}", e))?;

    let text_path = extracts_dir.join(format!("{}.md", doc.id));

    // 复用诉讼主抽取管线（extractor::extract_text_with_ocr_fallback），覆盖
    // txt/md/html/docx/doc/rtf/odt/ppt/xls/pdf 等；扫描件/图片/office 自动接力 OCR 兜底，
    // 与诉讼模块能力对齐。
    let result = extract_text_from_file(&doc.source_path, &text_path.to_string_lossy()).await;

    match result {
        Ok(hash) => {
            db::update_document_extraction(
                pool.inner(),
                &id,
                "done",
                Some(&text_path.to_string_lossy()),
                Some(&hash),
                None,
            )
            .await
            .map_err(|e| format!("更新状态失败: {}", e))?;
            // 返回抽取出的真实文本，供前端直接展示
            std::fs::read_to_string(&text_path)
                .map_err(|e| format!("读取抽取文本失败: {}", e))
        }
        Err(e) => {
            db::update_document_extraction(
                pool.inner(),
                &id,
                "failed",
                None,
                None,
                Some(&e),
            )
            .await
            .ok();
            Err(format!("抽取失败: {}", e))
        }
    }
}

/// 从文件中提取文本并写入目标路径，返回文本的 hash。
///
/// 复用诉讼主抽取管线 `extractor::extract_text_with_ocr_fallback`：
/// 便宜直抽覆盖 txt/md/html/docx/doc/rtf/odt/ppt/xls/pdf；扫描件/图片/office
/// 自动接力 OCR 兜底（云端 MinerU/PaddleOCR 或本机 MiniCPM-V vision），与诉讼模块对齐。
///
/// 返回约定：
/// - `Ok(hash)` 抽取成功（文本已写入 target_path）
/// - `Err(...)` 真实解析失败，或 OCR 也未能识别出文本（含用户未配置任何 OCR 后端的引导提示）
async fn extract_text_from_file(source_path: &str, target_path: &str) -> Result<String, String> {
    let p = std::path::Path::new(source_path);
    if !p.exists() {
        return Err("源文件不存在".to_string());
    }

    let lower = p.to_string_lossy().to_lowercase();
    let is_html = lower.ends_with(".html") || lower.ends_with(".htm");
    let filename = p.file_name().and_then(|f| f.to_str()).unwrap_or("");

    // 复用诉讼主抽取管线:便宜直抽;扫描件/图片/office 自动接力 OCR 兜底,
    // 与诉讼模块能力对齐(不再对扫描件"暂未接入 OCR"就放弃)。
    let text_opt = crate::ingest::extractor::extract_text_with_ocr_fallback(p, filename).await;

    match text_opt {
        Ok(mut text) => {
            if is_html {
                text = strip_html_tags(&text);
            }
            // 写入目标文件
            std::fs::write(target_path, &text).map_err(|e| format!("写入抽取文本失败: {}", e))?;
            // 计算 hash
            let hash = fnv_hash(&text);
            Ok(hash)
        }
        Err(e) => Err(e),
    }
}

/// 简单的 HTML 标签剥离。
fn strip_html_tags(html: &str) -> String {
    let mut result = String::with_capacity(html.len());
    let mut in_tag = false;
    for ch in html.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => result.push(ch),
            _ => {}
        }
    }
    result
}

/// FNV-1a 64-bit hash。
fn fnv_hash(text: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    text.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

// ============================================================================
// 工作区文稿
// ============================================================================

#[tauri::command]
pub async fn workspace_create_draft(
    pool: tauri::State<'_, SqlitePool>,
    workspace_id: String,
    title: String,
) -> Result<db::WorkspaceDraft, String> {
    db::create_draft(pool.inner(), &workspace_id, &title)
        .await
        .map_err(|e| format!("创建文稿失败: {}", e))
}

#[tauri::command]
pub async fn workspace_list_drafts(
    pool: tauri::State<'_, SqlitePool>,
    workspace_id: String,
) -> Result<Vec<db::WorkspaceDraft>, String> {
    db::list_drafts(pool.inner(), &workspace_id)
        .await
        .map_err(|e| format!("读取文稿列表失败: {}", e))
}

#[tauri::command]
pub async fn workspace_get_draft(
    pool: tauri::State<'_, SqlitePool>,
    id: String,
) -> Result<db::WorkspaceDraft, String> {
    db::get_draft(pool.inner(), &id)
        .await
        .map_err(|e| format!("读取文稿失败: {}", e))?
        .ok_or_else(|| "文稿不存在".to_string())
}

#[tauri::command]
pub async fn workspace_update_draft(
    pool: tauri::State<'_, SqlitePool>,
    id: String,
    content_md: String,
) -> Result<(), String> {
    db::update_draft_content(pool.inner(), &id, &content_md)
        .await
        .map_err(|e| format!("更新文稿失败: {}", e))
}

#[tauri::command]
pub async fn workspace_delete_draft(
    pool: tauri::State<'_, SqlitePool>,
    id: String,
) -> Result<(), String> {
    db::delete_draft(pool.inner(), &id)
        .await
        .map_err(|e| format!("删除文稿失败: {}", e))
}

#[tauri::command]
pub async fn workspace_mark_draft_final(
    pool: tauri::State<'_, SqlitePool>,
    id: String,
) -> Result<(), String> {
    db::mark_draft_final(pool.inner(), &id)
        .await
        .map_err(|e| format!("标记定稿失败: {}", e))
}

#[tauri::command]
pub async fn workspace_export_draft_docx(
    draft_md: String,
    title: String,
    save_path: String,
) -> Result<String, String> {
    let bytes = crate::docx_filing::build_filing_docx_bytes(&title, &draft_md)
        .map_err(|e| format!("生成 Word 失败: {}", e))?;
    std::fs::write(&save_path, &bytes).map_err(|e| format!("写入文件失败: {}", e))?;
    Ok(save_path)
}

// ============================================================================
// 工作区对话
// ============================================================================

#[tauri::command]
pub async fn workspace_create_conversation(
    pool: tauri::State<'_, SqlitePool>,
    workspace_id: String,
    title: Option<String>,
) -> Result<db::WorkspaceConversation, String> {
    db::create_conversation(pool.inner(), &workspace_id, title.as_deref())
        .await
        .map_err(|e| format!("创建对话失败: {}", e))
}

#[tauri::command]
pub async fn workspace_list_conversations(
    pool: tauri::State<'_, SqlitePool>,
    workspace_id: String,
) -> Result<Vec<db::WorkspaceConversation>, String> {
    db::list_conversations(pool.inner(), &workspace_id)
        .await
        .map_err(|e| format!("读取对话列表失败: {}", e))
}

#[tauri::command]
pub async fn workspace_rename_conversation(
    pool: tauri::State<'_, SqlitePool>,
    id: String,
    title: String,
) -> Result<(), String> {
    db::rename_conversation(pool.inner(), &id, &title)
        .await
        .map_err(|e| format!("重命名对话失败: {}", e))
}

#[tauri::command]
pub async fn workspace_delete_conversation(
    pool: tauri::State<'_, SqlitePool>,
    id: String,
) -> Result<(), String> {
    db::delete_conversation(pool.inner(), &id)
        .await
        .map_err(|e| format!("删除对话失败: {}", e))
}

#[tauri::command]
pub async fn workspace_list_messages(
    pool: tauri::State<'_, SqlitePool>,
    conversation_id: String,
) -> Result<Vec<db::WorkspaceMessage>, String> {
    db::list_messages(pool.inner(), &conversation_id)
        .await
        .map_err(|e| format!("读取消息列表失败: {}", e))
}

#[tauri::command]
pub async fn workspace_clear_messages(
    pool: tauri::State<'_, SqlitePool>,
    conversation_id: String,
) -> Result<u64, String> {
    db::clear_messages(pool.inner(), &conversation_id)
        .await
        .map_err(|e| format!("清空消息失败: {}", e))
}

// ============================================================================
// 工作区聊天
// ============================================================================

#[derive(serde::Deserialize)]
pub struct WorkspaceChatInput {
    pub conversation_id: String,
    pub content: String,
    pub attached_doc_ids: Option<Vec<String>>,
    pub draft_id: Option<String>,
    pub task_type: Option<String>,
}

#[derive(serde::Serialize)]
pub struct WorkspaceChatResult {
    pub message_id: String,
    pub content: String,
    pub citations_json: Option<String>,
}

/// 工作区聊天实现（简化版）。
///
/// 复用 agent_loop、citations、quality_gate 等现有模块。
#[tauri::command]
pub async fn workspace_chat(
    app: tauri::AppHandle,
    pool: tauri::State<'_, SqlitePool>,
    registry: tauri::State<'_, crate::chat::ChatCancelRegistry>,
    input: WorkspaceChatInput,
) -> Result<WorkspaceChatResult, String> {
    use crate::chat::agent_loop;
    use crate::chat::citations;
    use crate::chat::context::TaskType;
    use crate::chat::model_router;
    use crate::chat::quality_gate;
    use crate::chat::stream::ChatStreamEvent;
    use crate::chat::tools::ToolContext;
    use crate::llm::LlmConfig;
    use crate::settings::Settings;
    use tokio::sync::mpsc;

    let started_at = std::time::Instant::now();
    let task = TaskType::from_str_loose(input.task_type.as_deref());
    let channel = format!("chat-stream-{}", input.conversation_id);

    // ── Step 1: 读取 Settings → 构建 LlmConfig ──────────────────────
    let settings: Settings = crate::settings::read_settings().unwrap_or_default();
    if settings.effective_llm_provider() == "cloud" {
        let backend = settings.effective_cloud_llm_backend();
        let (key_value, name): (Option<String>, &str) = if backend == "minimax" {
            (settings.minimax_api_key.clone(), "MiniMax")
        } else if settings.cloud_llm_is_compat() {
            let label = crate::llm::providers::compat_preset(backend)
                .map(|p| p.label)
                .unwrap_or("云端 LLM");
            (settings.effective_compat_llm_api_key(), label)
        } else {
            (settings.cloud_llm_api_key.clone(), "DeepSeek")
        };
        let key_missing = key_value.as_deref().map(str::trim).unwrap_or("").is_empty();
        if key_missing {
            return Err(format!("尚未配置 {} API Key,请在设置页填入", name));
        }
    }
    let mut llm_config = LlmConfig::from_settings(&settings);

    // ── Step 2: 获取工作区信息 ──────────────────────────────────────
    let conversation = db::get_workspace_conversation(pool.inner(), &input.conversation_id)
        .await
        .map_err(|e| format!("读取对话失败: {}", e))?
        .ok_or_else(|| "对话不存在".to_string())?;

    let workspace = db::get_workspace(pool.inner(), &conversation.workspace_id)
        .await
        .map_err(|e| format!("读取工作区失败: {}", e))?
        .ok_or_else(|| "工作区不存在".to_string())?;

    let workspace_id = workspace.id.clone();

    // ── Step 3: 加载对话历史 → 截断 ────────────────────────────────
    let history_rows = db::list_messages_limited(pool.inner(), &input.conversation_id, 12)
        .await
        .map_err(|e| format!("读取聊天历史失败: {}", e))?;
    let mut history: Vec<(String, String)> = Vec::new();
    let mut total_chars = 0;
    for m in history_rows.iter().rev() {
        let pair = (m.role.clone(), m.content.clone());
        total_chars += pair.1.len();
        if total_chars > 4000 {
            break;
        }
        history.push(pair);
    }
    history.reverse();

    // ── Step 4: 插入用户消息 ────────────────────────────────────────
    let user_msg_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    db::insert_message(
        pool.inner(),
        &db::NewWorkspaceMessage {
            id: &user_msg_id,
            conversation_id: &input.conversation_id,
            role: "user",
            content: &input.content,
            model: None,
            prompt_tokens: None,
            completion_tokens: None,
            latency_ms: None,
            based_on: None,
            artifact_draft_id: None,
            error_short: None,
            citations_json: None,
            created_at: &now,
        },
    )
    .await
    .map_err(|e| format!("入库 user 消息失败: {}", e))?;

    // ── Step 5: 设置取消通道 ────────────────────────────────────────
    let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel::<()>();
    registry.register(input.conversation_id.clone(), cancel_tx);

    // ── Step 6: 设置流式通道 ────────────────────────────────────────
    let (tx, mut rx) = mpsc::unbounded_channel::<ChatStreamEvent>();
    let app_for_emit = app.clone();
    let channel_for_emit = channel.clone();
    let forward = tokio::spawn(async move {
        let mut streamed = String::new();
        while let Some(ev) = rx.recv().await {
            match &ev {
                ChatStreamEvent::Delta { text } => {
                    streamed.push_str(text);
                    let _ = app_for_emit.emit(&channel_for_emit, ev);
                }
                // 中间事件立即转发给前端
                ChatStreamEvent::Reasoning { .. }
                | ChatStreamEvent::ToolCall { .. }
                | ChatStreamEvent::AskUser { .. } => {
                    let _ = app_for_emit.emit(&channel_for_emit, ev);
                }
                // 终态事件不在此处 emit — 等 DB 写入后再发，避免
                // 前端 loadMessages 时 assistant 消息尚未入库的竞态。
                ChatStreamEvent::Done { .. } | ChatStreamEvent::Error { .. } => {}
            }
        }
        streamed
    });

    // ── Step 7: 构建用户提示词 ──────────────────────────────────────
    let user_message_final = input.content.clone();

    // ── Step 8: 路由模型 ────────────────────────────────────────────
    let choice = model_router::route_model(task, &input.content, &settings);
    if settings.effective_llm_provider() == "cloud" {
        llm_config.model = choice.model.clone();
    }

    // ── Step 9: 构建工作区系统提示词 ────────────────────────────────
    let materials = db::list_workspace_documents(pool.inner(), &workspace_id)
        .await
        .unwrap_or_default();
    let drafts = db::list_drafts(pool.inner(), &workspace_id)
        .await
        .unwrap_or_default();

    let system_prompt = super::constitution::build_workspace_system_prompt(
        &workspace,
        &materials,
        &drafts,
        task,
        &[],
        &[],
    );

    // ── Step 10-11: 构建 citation_check 路径 ───────────────────────
    let case_doc_paths = db::get_extracted_doc_paths(pool.inner(), &workspace_id)
        .await
        .unwrap_or_default();

    // ── Step 12: 调用 agent_loop ────────────────────────────────────
    let registry_tools = super::tools::workspace_tool_registry(
        pool.inner().clone(),
        workspace_id.clone(),
    );

    let tool_ctx = ToolContext {
        pool: pool.inner(),
        settings: &settings,
        case_id: None,
        workspace_id: Some(workspace_id),
        local_kb: None,
        app: Some(app.clone()),
        message_id: Some(&input.conversation_id),
        visualization_consent: false,
    };

    let agent_req = agent_loop::AgentLoopRequest {
        task_type: task,
        system_prompt,
        history,
        user_message: user_message_final,
        temperature: choice.temperature,
        max_tokens: choice.max_tokens,
        tool_choice: "auto".to_string(),
        case_doc_paths_for_citation_check: case_doc_paths.clone(),
    };

    let output = agent_loop::run_chat_with_tools(
        &llm_config,
        agent_req,
        &registry_tools,
        tool_ctx,
        tx,
        cancel_rx,
    )
    .await;

    // ── Step 13: 后处理 ─────────────────────────────────────────────
    let elapsed_ms = started_at.elapsed().as_millis() as i64;

    // 等 forward 刷完中间事件并拿到已流式输出的文本
    let streamed_content = forward.await.unwrap_or_default();

    match output {
        Ok(out) => {
            let parsed = citations::parse_with_doc_paths(
                &out.final_content,
                &case_doc_paths,
            );

            let gate_input = quality_gate::QualityGateInput {
                task,
                content: &out.content_cleaned,
                citations: &parsed.citations,
                tool_calls: &out.tool_trace,
                ask_user_present: out.ask_user.is_some(),
                artifact_doc_id: None,
            };
            let _gate_report = quality_gate::evaluate_task_quality(gate_input);

            let assistant_msg_id = uuid::Uuid::new_v4().to_string();
            let citations_json = if parsed.citations.is_empty() {
                None
            } else {
                serde_json::to_string(&parsed.citations).ok()
            };
            let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
            db::insert_message(
                pool.inner(),
                &db::NewWorkspaceMessage {
                    id: &assistant_msg_id,
                    conversation_id: &input.conversation_id,
                    role: "assistant",
                    content: &out.content_cleaned,
                    model: Some(&out.usage.model),
                    prompt_tokens: out.usage.prompt_tokens.map(|v| v as i64),
                    completion_tokens: out.usage.completion_tokens.map(|v| v as i64),
                    latency_ms: Some(elapsed_ms),
                    based_on: None,
                    artifact_draft_id: None,
                    error_short: None,
                    citations_json: citations_json.as_deref(),
                    created_at: &now,
                },
            )
            .await
            .map_err(|e| format!("入库 assistant 消息失败: {}", e))?;

            // DB 写入完成后才发 Done，避免前端 loadMessages 时消息尚未入库
            let _ = app.emit(
                &channel,
                ChatStreamEvent::Done {
                    prompt_tokens: out.usage.prompt_tokens,
                    completion_tokens: out.usage.completion_tokens,
                    model: out.usage.model.clone(),
                },
            );

            Ok(WorkspaceChatResult {
                message_id: assistant_msg_id,
                content: out.content_cleaned,
                citations_json,
            })
        }
        Err(e) => {
            let err_msg = format!("AI 回答失败: {}", e);
            let error_content = if streamed_content.is_empty() {
                err_msg.clone()
            } else {
                format!("{}\n\n---\n(以上为部分输出，因错误中断)", streamed_content)
            };
            let assistant_msg_id = uuid::Uuid::new_v4().to_string();
            let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
            db::insert_message(
                pool.inner(),
                &db::NewWorkspaceMessage {
                    id: &assistant_msg_id,
                    conversation_id: &input.conversation_id,
                    role: "assistant",
                    content: &error_content,
                    model: None,
                    prompt_tokens: None,
                    completion_tokens: None,
                    latency_ms: Some(elapsed_ms),
                    based_on: None,
                    artifact_draft_id: None,
                    error_short: Some(&err_msg),
                    citations_json: None,
                    created_at: &now,
                },
            )
            .await
            .ok();

            // DB 写入后发 Error，保证 loadMessages 能拿到错误消息
            let _ = app.emit(
                &channel,
                ChatStreamEvent::Error {
                    message: err_msg.clone(),
                },
            );

            Err(err_msg)
        }
    }
}

/// 取消工作区聊天。
#[tauri::command]
pub async fn cancel_workspace_chat(
    registry: tauri::State<'_, crate::chat::ChatCancelRegistry>,
    message_id: String,
) -> Result<bool, String> {
    Ok(crate::chat::commands::cancel_chat_impl(&registry, &message_id))
}
