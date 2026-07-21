//! 工作区工具集。
//!
//! 复用 11 个现有工具 + 新建 3 个工作区专属工具。

use async_trait::async_trait;
use serde_json::Value;
use sqlx::SqlitePool;

use crate::chat::tools::{Tool, ToolContext, ToolError, ToolResult};

// ============================================================================
// 工作区专属工具
// ============================================================================

/// 读取工作区材料的 OCR 文本。
pub struct WorkspaceReadDoc {
    pool: SqlitePool,
    workspace_id: String,
}

impl WorkspaceReadDoc {
    pub fn new(pool: SqlitePool, workspace_id: String) -> Self {
        Self { pool, workspace_id }
    }
}

#[async_trait]
impl Tool for WorkspaceReadDoc {
    fn name(&self) -> &str {
        "workspace_read_doc"
    }

    fn description(&self) -> &str {
        "读取工作区材料的抽取文本（OCR/直抽）。传入材料文件名或 ID，返回文本内容。\
         长文档用 offset/length 分段读取（默认 8000 字符，最大 30000）。"
    }

    fn parameters_schema(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "doc_id": {
                    "type": "string",
                    "description": "材料的 ID"
                },
                "filename": {
                    "type": "string",
                    "description": "材料的文件名（如 '催款函.docx'）"
                },
                "offset": {
                    "type": "integer",
                    "description": "从第几个字符开始读，默认 0"
                },
                "length": {
                    "type": "integer",
                    "description": "读多少字符，默认 8000，最大 30000"
                }
            }
        })
    }

    async fn execute(&self, args: &Value, _ctx: &ToolContext<'_>) -> Result<ToolResult, ToolError> {
        let offset = args.get("offset").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
        let length = args
            .get("length")
            .and_then(|v| v.as_u64())
            .map(|n| (n as usize).min(30000))
            .unwrap_or(8000);

        // 支持按 doc_id 或 filename 查找
        let doc: Option<super::db::WorkspaceDocument> = if let Some(doc_id) = args.get("doc_id").and_then(|v| v.as_str()) {
            sqlx::query_as(
                "SELECT * FROM workspace_documents WHERE id = ? AND workspace_id = ?",
            )
            .bind(doc_id)
            .bind(&self.workspace_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|e| ToolError::Runtime(format!("查询材料失败: {}", e)))?
        } else if let Some(filename) = args.get("filename").and_then(|v| v.as_str()) {
            sqlx::query_as(
                "SELECT * FROM workspace_documents WHERE filename LIKE ? AND workspace_id = ? LIMIT 1",
            )
            .bind(format!("%{}%", filename))
            .bind(&self.workspace_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|e| ToolError::Runtime(format!("查询材料失败: {}", e)))?
        } else {
            return Err(ToolError::Runtime("需要提供 doc_id 或 filename 参数".into()));
        };

        match doc {
            Some(d) => {
                // 按 extracted_text_path 是否存在判定可读性（与诉讼 read_case_doc 对齐）。
                // 未抽取 / 抽取失败 / 处理中：给出可操作的提示，而非吞掉。
                let txt_path = match d.extracted_text_path.as_deref() {
                    Some(p) if !p.is_empty() => p,
                    _ => {
                        let hint = match d.extraction_status.as_str() {
                            "failed" => format!(
                                "材料「{}」抽取失败（{}），无法读取。可在材料列表点击重试，或上传可复制文本的电子版文档。",
                                d.filename,
                                d.last_error.as_deref().unwrap_or("未知错误")
                            ),
                            "processing" => format!("材料「{}」正在抽取中，请稍后再读。", d.filename),
                            _ => format!(
                                "材料「{}」尚未完成抽取（状态: {}），请先在材料列表触发抽取。",
                                d.filename, d.extraction_status
                            ),
                        };
                        return Ok(ToolResult {
                            content: hint,
                            yuandian_credits_used: 0,
                            kb_hit: false,
                        });
                    }
                };
                let content_raw = std::fs::read_to_string(txt_path)
                    .map_err(|e| ToolError::Runtime(format!("读取抽取文本失败: {}", e)))?;
                let chars: Vec<char> = content_raw.chars().collect();
                let total = chars.len();
                let start = offset.min(total);
                let end = (start + length).min(total);
                let slice: String = chars[start..end].iter().collect();
                let has_more = end < total;
                let result = serde_json::json!({
                    "filename": d.filename,
                    "total_chars": total,
                    "has_more": has_more,
                    "content": slice,
                });
                Ok(ToolResult {
                    content: serde_json::to_string_pretty(&result).unwrap_or_else(|_| "{}".into()),
                    yuandian_credits_used: 0,
                    kb_hit: false,
                })
            }
            None => Ok(ToolResult {
                content: "未找到匹配的材料。请提供 doc_id 或 filename 参数。".to_string(),
                yuandian_credits_used: 0,
                kb_hit: false,
            }),
        }
    }
}

/// 将 AI 回答保存为工作区文稿。
pub struct WorkspaceSaveDraft {
    pool: SqlitePool,
    workspace_id: String,
}

impl WorkspaceSaveDraft {
    pub fn new(pool: SqlitePool, workspace_id: String) -> Self {
        Self { pool, workspace_id }
    }
}

#[async_trait]
impl Tool for WorkspaceSaveDraft {
    fn name(&self) -> &str {
        "workspace_save_draft"
    }

    fn description(&self) -> &str {
        "将内容保存为工作区文稿。传入标题和 Markdown 内容。"
    }

    fn parameters_schema(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "title": {
                    "type": "string",
                    "description": "文稿标题"
                },
                "content_md": {
                    "type": "string",
                    "description": "文稿的 Markdown 内容"
                }
            },
            "required": ["title", "content_md"]
        })
    }

    fn is_mutating(&self) -> bool {
        true
    }

    async fn execute(&self, args: &Value, _ctx: &ToolContext<'_>) -> Result<ToolResult, ToolError> {
        let title = args
            .get("title")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::Runtime("缺少 title 参数".into()))?;
        let content = args
            .get("content_md")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::Runtime("缺少 content_md 参数".into()))?;

        // 检查大小限制（5MB）
        if content.len() > 5 * 1024 * 1024 {
            return Err(ToolError::Runtime("文稿内容超过 5MB 上限".into()));
        }

        let draft = super::db::create_draft(&self.pool, &self.workspace_id, title)
            .await
            .map_err(|e| ToolError::Runtime(format!("创建文稿失败: {}", e)))?;

        super::db::update_draft_content(&self.pool, &draft.id, content)
            .await
            .map_err(|e| ToolError::Runtime(format!("写入文稿内容失败: {}", e)))?;

        Ok(ToolResult {
            content: format!("已保存文稿「{}」（ID: {}）。", title, draft.id),
            yuandian_credits_used: 0,
            kb_hit: false,
        })
    }
}

/// 编辑已有工作区文稿（find & replace）。
pub struct WorkspaceEditDraft {
    pool: SqlitePool,
    workspace_id: String,
}

impl WorkspaceEditDraft {
    pub fn new(pool: SqlitePool, workspace_id: String) -> Self {
        Self { pool, workspace_id }
    }
}

#[async_trait]
impl Tool for WorkspaceEditDraft {
    fn name(&self) -> &str {
        "workspace_edit_draft"
    }

    fn description(&self) -> &str {
        "对已有文稿进行局部编辑（find & replace）。传入文稿 ID、查找内容和替换内容。"
    }

    fn parameters_schema(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "draft_id": {
                    "type": "string",
                    "description": "文稿的 ID"
                },
                "find": {
                    "type": "string",
                    "description": "要查找的原文片段"
                },
                "replace": {
                    "type": "string",
                    "description": "替换后的新内容"
                }
            },
            "required": ["draft_id", "find", "replace"]
        })
    }

    fn is_mutating(&self) -> bool {
        true
    }

    async fn execute(&self, args: &Value, _ctx: &ToolContext<'_>) -> Result<ToolResult, ToolError> {
        let draft_id = args
            .get("draft_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::Runtime("缺少 draft_id 参数".into()))?;
        let find = args
            .get("find")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::Runtime("缺少 find 参数".into()))?;
        let replace = args
            .get("replace")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::Runtime("缺少 replace 参数".into()))?;

        let draft = super::db::get_draft(&self.pool, draft_id)
            .await
            .map_err(|e| ToolError::Runtime(format!("查询文稿失败: {}", e)))?
            .ok_or_else(|| ToolError::Runtime(format!("文稿 {} 不存在", draft_id)))?;

        // 验证文稿属于当前工作区
        if draft.workspace_id != self.workspace_id {
            return Err(ToolError::Runtime("文稿不属于当前工作区".into()));
        }

        if !draft.content_md.contains(find) {
            return Ok(ToolResult {
                content: format!("在文稿「{}」中未找到指定内容，编辑未执行。请检查 find 参数是否与原文完全一致。", draft.title),
                yuandian_credits_used: 0,
                kb_hit: false,
            });
        }

        let new_content = draft.content_md.replace(find, replace);
        super::db::update_draft_content(&self.pool, draft_id, &new_content)
            .await
            .map_err(|e| ToolError::Runtime(format!("更新文稿失败: {}", e)))?;

        Ok(ToolResult {
            content: format!("已修改文稿「{}」，替换了 1 处内容。", draft.title),
            yuandian_credits_used: 0,
            kb_hit: false,
        })
    }
}

/// 将工作区文稿导出为 Word 文件。
pub struct WorkspaceExportDraftDocx {
    pool: SqlitePool,
    workspace_id: String,
}

impl WorkspaceExportDraftDocx {
    pub fn new(pool: SqlitePool, workspace_id: String) -> Self {
        Self { pool, workspace_id }
    }
}

#[async_trait]
impl Tool for WorkspaceExportDraftDocx {
    fn name(&self) -> &str {
        "workspace_export_draft_docx"
    }

    fn description(&self) -> &str {
        "将工作区文稿导出为 Word 文件。传入文稿 ID 和保存路径。"
    }

    fn parameters_schema(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "draft_id": {
                    "type": "string",
                    "description": "要导出的文稿 ID"
                },
                "save_path": {
                    "type": "string",
                    "description": "保存路径（.docx 文件）"
                }
            },
            "required": ["draft_id", "save_path"]
        })
    }

    fn is_mutating(&self) -> bool {
        false
    }

    async fn execute(&self, args: &Value, _ctx: &ToolContext<'_>) -> Result<ToolResult, ToolError> {
        let draft_id = args
            .get("draft_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::Runtime("缺少 draft_id 参数".into()))?;
        let save_path_raw = args
            .get("save_path")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::Runtime("缺少 save_path 参数".into()))?;

        // 路径处理：展开 ~ 并转换 Windows 路径为 macOS 路径
        let save_path = if save_path_raw.starts_with("C:\\Users\\") || save_path_raw.starts_with("c:\\Users\\") {
            // Windows 路径转换为 macOS 路径
            let username = std::env::var("USER").unwrap_or_else(|_| "max".to_string());
            let relative = save_path_raw
                .replace("C:\\Users\\Admin\\", "")
                .replace("c:\\Users\\Admin\\", "")
                .replace("C:\\Users\\", &format!("/Users/{}/", username))
                .replace("c:\\Users\\", &format!("/Users/{}/", username))
                .replace("\\", "/");
            format!("/Users/{}", relative.trim_start_matches('/'))
        } else if save_path_raw.starts_with("~/") || save_path_raw.starts_with("~\\") {
            shellexpand::tilde(save_path_raw).to_string()
        } else {
            save_path_raw.to_string()
        };

        let draft = super::db::get_draft(&self.pool, draft_id)
            .await
            .map_err(|e| ToolError::Runtime(format!("查询文稿失败: {}", e)))?
            .ok_or_else(|| ToolError::Runtime(format!("文稿 {} 不存在", draft_id)))?;

        // 验证文稿属于当前工作区
        if draft.workspace_id != self.workspace_id {
            return Err(ToolError::Runtime("文稿不属于当前工作区".into()));
        }

        // 生成 Word 文件
        let bytes = crate::docx_filing::build_filing_docx_bytes(&draft.title, &draft.content_md)
            .map_err(|e| ToolError::Runtime(format!("生成 Word 失败: {}", e)))?;

        std::fs::write(&save_path, &bytes)
            .map_err(|e| ToolError::Runtime(format!("写入文件失败: {}", e)))?;

        Ok(ToolResult {
            content: format!("已将文稿「{}」导出为 Word 文件：{}", draft.title, save_path),
            yuandian_credits_used: 0,
            kb_hit: false,
        })
    }
}

// ============================================================================
// 工作区工具注册表
// ============================================================================

/// 创建工作区默认工具集，返回 ToolRegistry。
pub fn workspace_tool_registry(pool: SqlitePool, workspace_id: String) -> crate::chat::tools::ToolRegistry {
    let mut tools: Vec<Box<dyn Tool>> = Vec::new();

    // 复用的现有工具
    tools.push(Box::new(crate::chat::tools::laws::SearchLaws));
    tools.push(Box::new(crate::chat::tools::laws::GetLawArticle));
    tools.push(Box::new(crate::chat::tools::laws::SearchRegulations));
    tools.push(Box::new(crate::chat::tools::laws::LawVectorSearch));
    tools.push(Box::new(crate::chat::tools::verify::VerifyLegalCitations));
    tools.push(Box::new(crate::chat::tools::web::WebSearch));
    tools.push(Box::new(crate::chat::tools::web::WebFetch));
    tools.push(Box::new(crate::chat::tools::companies::EnterpriseSearch));
    tools.push(Box::new(crate::chat::tools::companies::EnterpriseBaseInfo));
    tools.push(Box::new(crate::chat::tools::companies::EnterpriseChangeInfo));
    tools.push(Box::new(crate::chat::tools::companies::EnterpriseWritList));

    // 新建的工作区工具
    tools.push(Box::new(WorkspaceReadDoc::new(pool.clone(), workspace_id.clone())));
    tools.push(Box::new(WorkspaceSaveDraft::new(pool.clone(), workspace_id.clone())));
    tools.push(Box::new(WorkspaceEditDraft::new(pool.clone(), workspace_id.clone())));
    tools.push(Box::new(WorkspaceExportDraftDocx::new(pool, workspace_id)));

    crate::chat::tools::ToolRegistry::from_tools(tools)
}
