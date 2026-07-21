/**
 * AI 事务工作区 — 工作区卡片网格（入口页）。
 *
 * 显示所有工作区，支持新建、进入详情。
 */

import { useEffect, useState } from "react";
import {
  FolderOpen,
  Plus,
  FileText,
  MessageSquare,
  Trash2,
} from "lucide-react";
import { workspaceList, workspaceCreate, workspaceDelete } from "@/lib/api";
import type { WorkspaceInfo } from "@/lib/types";
import { confirmDialog } from "@/lib/dialog";

interface Props {
  onSelectWorkspace: (id: string) => void;
}

export function WorkspaceList({ onSelectWorkspace }: Props) {
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");

  useEffect(() => {
    loadWorkspaces();
  }, []);

  const loadWorkspaces = async () => {
    try {
      const list = await workspaceList();
      setWorkspaces(list);
    } catch (e) {
      console.error("加载工作区列表失败:", e);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const ws = await workspaceCreate(newName.trim(), newDesc.trim() || undefined);
      setNewName("");
      setNewDesc("");
      setShowCreateDialog(false);
      setTimeout(() => onSelectWorkspace(ws.id), 50);
    } catch (e) {
      console.error("创建工作区失败:", e);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    const confirmed = await confirmDialog(
      `确定要删除工作区「${name}」吗？\n\n工作区中的材料、文稿和对话都会被删除。`,
      { danger: true, okLabel: "删除" },
    );
    if (!confirmed) return;
    try {
      await workspaceDelete(id);
      await loadWorkspaces();
    } catch (e) {
      console.error("删除工作区失败:", e);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-sm text-muted-foreground">加载中...</div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto px-4 py-5 sm:px-6 xl:px-8 xl:py-6">
      <div className="mx-auto max-w-5xl">
        {/* 标题栏 */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              AI 事务工作区
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              独立于在办案件，为临时函件、专项材料或同一相关事项建立可持续工作区
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowCreateDialog(true)}
            className="inline-flex items-center gap-2 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
          >
            <Plus className="h-4 w-4" />
            新建工作区
          </button>
        </div>

        {/* 新建对话框 */}
        {showCreateDialog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="w-full max-w-md rounded-lg bg-background p-6 shadow-lg">
              <h2 className="text-lg font-semibold">新建工作区</h2>
              <div className="mt-4 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-foreground">
                    名称 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="如：张三股权转让函"
                    className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-foreground focus:outline-none"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground">
                    描述（可选）
                  </label>
                  <input
                    type="text"
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                    placeholder="简要说明这个工作区的用途"
                    className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-foreground focus:outline-none"
                  />
                </div>
              </div>
              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateDialog(false);
                    setNewName("");
                    setNewDesc("");
                  }}
                  className="rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-muted"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={!newName.trim() || creating}
                  className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:bg-foreground/90 disabled:opacity-50"
                >
                  {creating ? "创建中..." : "创建"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 工作区卡片网格 */}
        {workspaces.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16">
            <FolderOpen className="h-12 w-12 text-muted-foreground/50" />
            <p className="mt-4 text-sm text-muted-foreground">
              还没有工作区，点击「新建工作区」开始
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {workspaces.map((info) => (
              <WorkspaceCard
                key={info.workspace.id}
                info={info}
                onSelect={onSelectWorkspace}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** 单个工作区卡片 — 抽成独立组件避免闭包 + 重渲染问题 */
function WorkspaceCard({
  info,
  onSelect,
  onDelete,
}: {
  info: WorkspaceInfo;
  onSelect: (id: string) => void;
  onDelete: (id: string, name: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(info.workspace.id)}
      className="group relative flex w-full items-start rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-foreground/20 hover:shadow-sm"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <FolderOpen className="h-5 w-5" />
      </div>
      <div className="ml-3 min-w-0 flex-1">
        <h3 className="truncate text-sm font-medium text-foreground">
          {info.workspace.name}
        </h3>
        {info.workspace.description && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {info.workspace.description}
          </p>
        )}
        <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <FileText className="h-3 w-3" />
            {info.document_count} 材料
          </span>
          <span className="flex items-center gap-1">
            <FileText className="h-3 w-3" />
            {info.draft_count} 文稿
          </span>
          <span className="flex items-center gap-1">
            <MessageSquare className="h-3 w-3" />
            {info.conversation_count} 对话
          </span>
        </div>
        <div className="mt-1.5 text-xs text-muted-foreground/60">
          更新于 {new Date(info.workspace.updated_at).toLocaleDateString("zh-CN")}
        </div>
      </div>
      {/* 删除按钮 */}
      <span
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation();
          onDelete(info.workspace.id, info.workspace.name);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.stopPropagation();
            onDelete(info.workspace.id, info.workspace.name);
          }
        }}
        className="absolute right-2 top-2 inline-flex cursor-pointer items-center justify-center rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-red-500 group-hover:opacity-100"
      >
        <Trash2 className="h-4 w-4" />
      </span>
    </button>
  );
}
