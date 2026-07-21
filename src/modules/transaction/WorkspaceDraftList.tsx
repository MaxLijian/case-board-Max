/**
 * AI 事务工作区 — 文稿列表。
 *
 * 显示工作区中的文稿，支持新建、编辑、删除。
 */

import { useCallback } from "react";
import { FileText, Plus, Trash2, Star } from "lucide-react";
import { workspaceCreateDraft, workspaceDeleteDraft } from "@/lib/api";
import type { WorkspaceDraft } from "@/lib/types";

interface Props {
  workspaceId: string;
  drafts: WorkspaceDraft[];
  onDraftsChange: (drafts: WorkspaceDraft[]) => void;
  onSelectDraft?: (draftId: string) => void;
}

export function WorkspaceDraftList({
  workspaceId,
  drafts,
  onDraftsChange,
  onSelectDraft,
}: Props) {
  const handleCreate = useCallback(async () => {
    try {
      const draft = await workspaceCreateDraft(workspaceId, "新文稿");
      onDraftsChange([draft, ...drafts]);
    } catch (e) {
      console.error("创建文稿失败:", e);
    }
  }, [workspaceId, drafts, onDraftsChange]);

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await workspaceDeleteDraft(id);
        onDraftsChange(drafts.filter((d) => d.id !== id));
      } catch (e) {
        console.error("删除文稿失败:", e);
      }
    },
    [drafts, onDraftsChange],
  );

  return (
    <div className="p-2">
      {/* 新建按钮 */}
      <button
        type="button"
        onClick={handleCreate}
        className="flex w-full items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
      >
        <Plus className="h-3 w-3" />
        新建文稿
      </button>

      {/* 文稿列表 */}
      {drafts.length > 0 && (
        <div className="mt-2 space-y-1">
          {drafts.map((draft) => (
            <div
              key={draft.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelectDraft?.(draft.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSelectDraft?.(draft.id);
              }}
              className="group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-muted/50"
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {draft.title}
              </span>
              {draft.status === "final" && (
                <Star className="h-3 w-3 shrink-0 text-yellow-500 fill-yellow-500" />
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(draft.id);
                }}
                className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
