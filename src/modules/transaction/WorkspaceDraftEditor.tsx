/**
 * AI 事务工作区 — 文稿编辑器。
 *
 * Markdown 编辑 + 格式工具栏 + 预览 + 保存 + 保存版本 + 导出 Word。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Save,
  Star,
  Download,
  Eye,
  Edit3,
  Heading1,
  Heading2,
  Heading3,
  Bold,
  Italic,
  List,
  ListOrdered,
  Table,
  Check,
  ChevronDown,
} from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import {
  workspaceGetDraft,
  workspaceUpdateDraft,
  workspaceMarkDraftFinal,
  workspaceExportDraftDocx,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import type { WorkspaceDraft } from "@/lib/types";

interface Props {
  draftId: string;
  onBack?: () => void;
  onSaved?: () => void;
  showBackButton?: boolean;
}

export function WorkspaceDraftEditor({
  draftId,
  onBack,
  onSaved,
  showBackButton = true,
}: Props) {
  const [draft, setDraft] = useState<WorkspaceDraft | null>(null);
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showVersionMenu, setShowVersionMenu] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    loadDraft();
  }, [draftId]);

  const loadDraft = async () => {
    try {
      const d = await workspaceGetDraft(draftId);
      setDraft(d);
      setContent(d.content_md);
    } catch (e) {
      console.error("加载文稿失败:", e);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = useCallback(async () => {
    if (!draft || saving) return;
    setSaving(true);
    try {
      await workspaceUpdateDraft(draft.id, content);
      setDirty(false);
      onSaved?.();
    } catch (e) {
      console.error("保存文稿失败:", e);
    } finally {
      setSaving(false);
    }
  }, [draft, content, saving, onSaved]);

  const handleMarkFinal = useCallback(async () => {
    if (!draft) return;
    try {
      await workspaceMarkDraftFinal(draft.id);
      setDraft({ ...draft, status: "final" });
      onSaved?.();
    } catch (e) {
      console.error("保存版本失败:", e);
    }
  }, [draft, onSaved]);

  const handleExportDocx = useCallback(async () => {
    if (!draft) return;
    try {
      const savePath = await save({
        defaultPath: `${draft.title}.docx`,
        filters: [{ name: "Word 文档", extensions: ["docx"] }],
      });
      if (!savePath) return;
      await workspaceExportDraftDocx(content, draft.title, savePath);
    } catch (e) {
      console.error("导出 Word 失败:", e);
    }
  }, [draft, content]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
    setDirty(true);
  }, []);

  /** 在光标处插入 Markdown 标记 */
  const insertMarkdown = useCallback((before: string, after: string = "") => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = content.slice(start, end);
    const newValue = content.slice(0, start) + before + selected + after + content.slice(end);

    setContent(newValue);
    setDirty(true);

    // 光标移到插入内容之后
    const newCursor = start + before.length + selected.length;
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(newCursor, newCursor);
    });
  }, [content]);

  /** 行首加 Markdown 标记 */
  const toggleLinePrefix = useCallback((prefix: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const lineStart = content.lastIndexOf("\n", start - 1) + 1;
    const lineEnd = content.indexOf("\n", start);
    const actualLineEnd = lineEnd === -1 ? content.length : lineEnd;
    const line = content.slice(lineStart, actualLineEnd);

    let newLine: string;
    if (line.startsWith(prefix)) {
      newLine = line.slice(prefix.length);
    } else {
      newLine = prefix + line;
    }

    const newValue = content.slice(0, lineStart) + newLine + content.slice(actualLineEnd);
    setContent(newValue);
    setDirty(true);

    const newCursor = lineStart + newLine.length;
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(newCursor, newCursor);
    });
  }, [content]);

  /** 保存快捷键 */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleSave]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-sm text-muted-foreground">加载中...</div>
      </div>
    );
  }

  if (!draft) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-sm text-muted-foreground">文稿不存在</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* 顶部工具栏 */}
      <header className="app-subheader flex shrink-0 flex-col border-b bg-background">
        <div className="flex items-center gap-3 px-4 py-2.5 sm:px-6">
          {showBackButton && onBack && (
            <button
              type="button"
              onClick={onBack}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ArrowLeft className="size-3.5" />
              返回
            </button>
          )}
          <h2 className="flex-1 truncate text-sm font-medium text-foreground">
            {draft.title}
            {draft.status === "final" && (
              <Star className="ml-2 inline h-3 w-3 text-yellow-500 fill-yellow-500" />
            )}
          </h2>
          <div className="flex items-center gap-2">
            {/* 保存状态 */}
            <span
              className={cn(
                "flex items-center gap-1 rounded-full px-2 py-0.5 text-xs",
                dirty
                  ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                  : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
              )}
            >
              {dirty ? (
                <>
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                  未保存
                </>
              ) : (
                <>
                  <Check className="h-3 w-3" />
                  已保存
                </>
              )}
            </span>

            {/* 保存版本 */}
            <button
              type="button"
              onClick={handleMarkFinal}
              disabled={draft.status === "final"}
              className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              <Star className="h-3 w-3" />
              保存版本
            </button>

            {/* 导出 Word */}
            <button
              type="button"
              onClick={handleExportDocx}
              className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Download className="h-3 w-3" />
              导出
            </button>

            {/* 版本下拉 */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowVersionMenu((v) => !v)}
                className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                版本 {draft.version}
                <ChevronDown className="h-3 w-3" />
              </button>
              {showVersionMenu && (
                <div className="absolute right-0 z-20 mt-1 w-40 rounded-md border border-border bg-popover p-1 shadow-sm">
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    当前版本：v{draft.version}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      handleMarkFinal();
                      setShowVersionMenu(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-muted"
                  >
                    <Star className="h-3 w-3" />
                    保存为新版本
                  </button>
                </div>
              )}
            </div>

            {/* 预览切换 */}
            <button
              type="button"
              onClick={() => setPreview(!preview)}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {preview ? <Edit3 className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              {preview ? "编辑" : "预览"}
            </button>

            {/* 保存按钮 */}
            <button
              type="button"
              onClick={handleSave}
              disabled={!dirty || saving}
              className="flex items-center gap-1 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-50"
            >
              <Save className="h-3 w-3" />
              {saving ? "保存中..." : "保存"}
            </button>
          </div>
        </div>

        {/* 格式工具栏 */}
        {!preview && (
          <div className="flex items-center gap-1 border-t border-border px-4 py-1.5 sm:px-6">
            <ToolbarButton onClick={() => insertMarkdown("# ")} title="标题 1">
              <Heading1 className="h-3.5 w-3.5" />
            </ToolbarButton>
            <ToolbarButton onClick={() => insertMarkdown("## ")} title="标题 2">
              <Heading2 className="h-3.5 w-3.5" />
            </ToolbarButton>
            <ToolbarButton onClick={() => insertMarkdown("### ")} title="标题 3">
              <Heading3 className="h-3.5 w-3.5" />
            </ToolbarButton>
            <span className="mx-1 h-4 w-px bg-border" />
            <ToolbarButton onClick={() => insertMarkdown("**", "**")} title="粗体">
              <Bold className="h-3.5 w-3.5" />
            </ToolbarButton>
            <ToolbarButton onClick={() => insertMarkdown("*", "*")} title="斜体">
              <Italic className="h-3.5 w-3.5" />
            </ToolbarButton>
            <span className="mx-1 h-4 w-px bg-border" />
            <ToolbarButton onClick={() => toggleLinePrefix("- ")} title="无序列表">
              <List className="h-3.5 w-3.5" />
            </ToolbarButton>
            <ToolbarButton onClick={() => toggleLinePrefix("1. ")} title="有序列表">
              <ListOrdered className="h-3.5 w-3.5" />
            </ToolbarButton>
            <ToolbarButton
              onClick={() =>
                insertMarkdown(
                  "\n| 列1 | 列2 |\n| --- | --- |\n| 内容 | 内容 |\n",
                )
              }
              title="表格"
            >
              <Table className="h-3.5 w-3.5" />
            </ToolbarButton>
          </div>
        )}
      </header>

      {/* 编辑/预览区域 */}
      <div className="min-h-0 flex-1 overflow-auto">
        {preview ? (
          <div className="prose prose-sm max-w-none px-6 py-4">
            <div className="whitespace-pre-wrap">{content}</div>
          </div>
        ) : (
          <textarea
            ref={textareaRef}
            value={content}
            onChange={handleChange}
            className="h-full w-full resize-none border-none bg-background px-6 py-4 font-mono text-sm leading-relaxed focus:outline-none"
            placeholder="在此输入 Markdown 内容..."
          />
        )}
      </div>
    </div>
  );
}

function ToolbarButton({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {children}
    </button>
  );
}
