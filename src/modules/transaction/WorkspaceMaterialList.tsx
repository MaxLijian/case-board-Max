/**
 * AI 事务工作区 — 材料列表 + 上传区。
 *
 * 支持拖拽上传、文件选择器上传、OCR 触发。
 */

import { useCallback } from "react";
import {
  FileText,
  CheckCircle,
  Clock,
  AlertCircle,
  Trash2,
  Play,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  workspaceAddDocuments,
  workspaceRemoveDocument,
  workspaceExtractDocument,
} from "@/lib/api";
import type { WorkspaceDocument } from "@/lib/types";

interface Props {
  workspaceId: string;
  documents: WorkspaceDocument[];
  onDocumentsChange: (docs: WorkspaceDocument[]) => void;
}

export function WorkspaceMaterialList({ workspaceId, documents, onDocumentsChange }: Props) {
  const handleAddFiles = useCallback(async () => {
    const selected = await open({
      multiple: true,
      title: "选择材料文件",
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    if (paths.length === 0) return;
    try {
      const newDocs = await workspaceAddDocuments(workspaceId, paths);
      onDocumentsChange([...documents, ...newDocs]);
    } catch (e) {
      console.error("添加材料失败:", e);
    }
  }, [workspaceId, documents, onDocumentsChange]);

  const handleRemove = useCallback(
    async (id: string) => {
      try {
        await workspaceRemoveDocument(id);
        onDocumentsChange(documents.filter((d) => d.id !== id));
      } catch (e) {
        console.error("删除材料失败:", e);
      }
    },
    [documents, onDocumentsChange],
  );

  const handleExtract = useCallback(
    async (id: string) => {
      // 先标记为处理中
      const updating = documents.map((d) =>
        d.id === id ? { ...d, extraction_status: "processing" } : d,
      );
      onDocumentsChange(updating);

      try {
        await workspaceExtractDocument(id);
        // 刷新文档状态
        const updated = documents.map((d) =>
          d.id === id ? { ...d, extraction_status: "done" } : d,
        );
        onDocumentsChange(updated);
      } catch (e) {
        console.error("抽取失败:", e);
        // 标记为失败
        const failed = documents.map((d) =>
          d.id === id ? { ...d, extraction_status: "failed", last_error: String(e) } : d,
        );
        onDocumentsChange(failed);
      }
    },
    [documents, onDocumentsChange],
  );

  // 批量抽取所有 pending 的材料
  const handleExtractAll = useCallback(async () => {
    const pending = documents.filter((d) => d.extraction_status === "pending");
    for (const doc of pending) {
      await handleExtract(doc.id);
    }
  }, [documents, handleExtract]);

  return (
    <div className="p-2">
      {/* 上传区域 */}
      <div
        role="button"
        tabIndex={0}
        onClick={handleAddFiles}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleAddFiles();
        }}
        className="flex cursor-pointer flex-col items-center rounded-lg border border-dashed border-border p-4 text-center transition-colors hover:border-foreground/30"
      >
        <FileText className="mb-1 h-6 w-6 text-muted-foreground/50" />
        <p className="text-xs text-muted-foreground">
          点击或拖拽文件到此处添加材料
        </p>
      </div>

      {/* 批量抽取按钮 */}
      {documents.some((d) => d.extraction_status === "pending") && (
        <button
          type="button"
          onClick={handleExtractAll}
          className="mt-2 flex w-full items-center justify-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Play className="h-3 w-3" />
          抽取所有待处理材料
        </button>
      )}

      {/* 材料列表 */}
      {documents.length > 0 && (
        <div className="mt-3 space-y-1">
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-muted/50"
            >
              {/* 状态图标 */}
              <span className="shrink-0">
                {doc.extraction_status === "done" && (
                  <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                )}
                {doc.extraction_status === "processing" && (
                  <Clock className="h-3.5 w-3.5 text-blue-500 animate-pulse" />
                )}
                {doc.extraction_status === "failed" && (
                  <AlertCircle className="h-3.5 w-3.5 text-red-500" />
                )}
                {doc.extraction_status === "pending" && (
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                )}
              </span>

              {/* 文件名 */}
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {doc.filename}
              </span>

              {/* 操作按钮 */}
              <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                {doc.extraction_status === "pending" && (
                  <button
                    type="button"
                    onClick={() => handleExtract(doc.id)}
                    className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                    title="开始抽取"
                  >
                    <Play className="h-3 w-3" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleRemove(doc.id)}
                  className="rounded p-0.5 text-muted-foreground hover:text-red-500"
                  title="删除"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
