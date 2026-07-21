//! 工作区上下文构建。
//!
//! 提供 workspace_snapshot_md 和 workspace_docs_md 函数，
//! 用于构建工作区的上下文信息给 AI。

use super::db;

/// 工作区快照：名称、描述、材料数、文稿数。
pub fn workspace_snapshot_md(workspace: &db::Workspace) -> String {
    let mut s = String::with_capacity(256);
    s.push_str("【工作区快照】\n");
    push_kv(&mut s, "名称", Some(&workspace.name));
    if let Some(ref desc) = workspace.description {
        if !desc.is_empty() {
            push_kv(&mut s, "描述", Some(desc));
        }
    }
    push_kv(&mut s, "状态", Some(&workspace.status));
    s
}

/// 工作区材料轻量摘要（防自证循环：只列原始材料，不列 AI 文稿）。
///
/// 返回 (格式化文本, 文档 ID 列表)。
pub fn workspace_docs_md(docs: &[db::WorkspaceDocument]) -> (String, Vec<String>) {
    let active: Vec<&db::WorkspaceDocument> = docs
        .iter()
        .filter(|d| d.extraction_status != "failed")
        .collect();

    if active.is_empty() {
        return ("(工作区暂无材料)\n".to_string(), Vec::new());
    }

    let mut out = format!("共 {} 份材料:\n\n", active.len());
    let mut ids = Vec::new();

    for doc in &active {
        ids.push(doc.id.clone());
        out.push_str(&format!("### 材料 · {}\n", doc.filename));
        if let Some(ref mime) = doc.mime_type {
            out.push_str(&format!("- 类型: {}\n", mime));
        }
        if let Some(size) = doc.size_bytes {
            out.push_str(&format!("- 大小: {:.1} KB\n", size as f64 / 1024.0));
        }
        out.push_str(&format!("- 抽取状态: {}\n", doc.extraction_status));
        if doc.extraction_status == "done" {
            out.push_str("- ✅ AI 可引用此材料\n");
        }
        out.push('\n');
    }

    (out, ids)
}

fn push_kv(s: &mut String, key: &str, value: Option<&str>) {
    if let Some(v) = value {
        if !v.is_empty() {
            s.push_str(&format!("- {}: {}\n", key, v));
        }
    }
}
