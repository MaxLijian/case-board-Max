/**
 * AI 事务工作区 — 详情页（三栏布局）。
 *
 * 左栏：文件面板（材料 + 文稿）
 * 中栏：文稿编辑器 / 材料查看器 / 空状态
 * 右栏：AI 助手对话面板
 *
 * 每个面板右上角都有独立的全屏 / 缩小按钮。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  FileText,
  FolderOpen,
  Plus,
  FileUp,
  CheckCircle,
  Clock,
  AlertCircle,
  Trash2,
  Star,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";

import {
  workspaceListConversations,
  workspaceCreateConversation,
  workspaceDeleteConversation,
  workspaceListDocuments,
  workspaceListDrafts,
  workspaceGetWorkspace,
  workspaceAddDocuments,
  workspaceCreateDraft,
  workspaceRemoveDocument,
  workspaceDeleteDraft,
  workspaceExtractDocument,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import type {
  Workspace,
  WorkspaceConversation,
  WorkspaceDocument,
  WorkspaceDraft,
} from "@/lib/types";
import { WorkspaceDraftEditor } from "./WorkspaceDraftEditor";
import { WorkspaceChatPanel } from "./WorkspaceChatPanel";

interface Props {
  workspaceId: string;
  onBack: () => void;
}

type ExpandedPanel = "left" | "center" | "right" | null;
type CenterView = "empty" | "draft" | "document";

export function WorkspaceDetail({ workspaceId, onBack }: Props) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [conversations, setConversations] = useState<WorkspaceConversation[]>([]);
  const [documents, setDocuments] = useState<WorkspaceDocument[]>([]);
  const [drafts, setDrafts] = useState<WorkspaceDraft[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [centerView, setCenterView] = useState<CenterView>("empty");
  const [expanded, setExpanded] = useState<ExpandedPanel>(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const [ws, convs, docs, drfts] = await Promise.all([
        workspaceGetWorkspace(workspaceId),
        workspaceListConversations(workspaceId),
        workspaceListDocuments(workspaceId),
        workspaceListDrafts(workspaceId),
      ]);
      setWorkspace(ws);
      setDocuments(docs);
      setDrafts(drfts);

      // 自动维护至少一个对话
      if (convs.length === 0) {
        const conv = await workspaceCreateConversation(workspaceId);
        setConversations([conv]);
        setActiveConversationId(conv.id);
      } else {
        setConversations(convs);
        setActiveConversationId((prev) => prev ?? convs[0].id);
      }
    } catch (e) {
      console.error("加载工作区数据失败:", e);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  // 仅刷新材料列表（抽取完成后更新左侧状态图标）
  const refreshDocuments = useCallback(async () => {
    try {
      const docs = await workspaceListDocuments(workspaceId);
      setDocuments(docs);
    } catch (e) {
      console.error("刷新材料列表失败:", e);
    }
  }, [workspaceId]);

  useEffect(() => {
    loadData();
  }, [workspaceId, loadData]);

  const toggleExpand = useCallback((panel: ExpandedPanel) => {
    setExpanded((prev) => (prev === panel ? null : panel));
  }, []);

  // 创建新对话
  const handleCreateConversation = useCallback(async () => {
    try {
      const conv = await workspaceCreateConversation(workspaceId);
      setConversations((prev) => [...prev, conv]);
      setActiveConversationId(conv.id);
    } catch (e) {
      console.error("创建对话失败:", e);
    }
  }, [workspaceId]);

  // 删除对话
  const handleDeleteConversation = useCallback(
    async (id: string) => {
      try {
        const next = conversations.filter((c) => c.id !== id);
        await workspaceDeleteConversation(id);
        setConversations(next);
        if (activeConversationId === id) {
          setActiveConversationId(next[0]?.id ?? null);
        }
      } catch (e) {
        console.error("删除对话失败:", e);
      }
    },
    [activeConversationId, conversations],
  );

  // 重命名对话（本地乐观更新）
  const handleRenameConversation = useCallback((id: string, title: string) => {
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)));
  }, []);

  // 轮询单个材料的抽取状态，直到 done/failed 后刷新左侧列表（避免状态图标卡在「处理中」）。
  // OCR（云端 MinerU/Paddle 或本机 vision）对扫描件可能耗时数分钟，轮询窗口放宽到 ~10 分钟；
  // 快速直抽（txt/docx/文字型 PDF）通常 1-2 秒即 done，会提前 return。
  const pollExtraction = useCallback(
    async (docId: string) => {
      for (let i = 0; i < 200; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        try {
          const docs = await workspaceListDocuments(workspaceId);
          const target = docs.find((x) => x.id === docId);
          if (target && (target.extraction_status === "done" || target.extraction_status === "failed")) {
            setDocuments(docs);
            return;
          }
        } catch {
          return;
        }
      }
    },
    [workspaceId],
  );

  // 添加材料
  const handleAddDocuments = useCallback(async (paths?: string[]) => {
    if (!paths || paths.length === 0) {
      const selected = await open({
        multiple: true,
        title: "选择材料文件",
      });
      if (!selected) return;
      paths = Array.isArray(selected) ? selected : [selected];
      if (paths.length === 0) return;
    }
    try {
      const newDocs = await workspaceAddDocuments(workspaceId, paths);
      setDocuments((prev) => [...prev, ...newDocs]);
      // 上传后自动触发文本抽取（fire-and-forget），并轮询状态直到 done/failed
      for (const d of newDocs) {
        workspaceExtractDocument(d.id).catch((e) =>
          console.error("自动抽取失败:", d.filename, e),
        );
        pollExtraction(d.id);
      }
    } catch (e) {
      console.error("添加材料失败:", e);
    }
  }, [workspaceId, pollExtraction]);

  // 拖拽上传
  const [isDragging, setIsDragging] = useState(false);
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;
      // Tauri WebView 拖入的文件在 webkitGetAsEntry 不可用，
      // 这里使用 dataTransfer.files 的 path 属性（Tauri 会注入）。
      const paths = files
        .map((f) => (f as unknown as { path?: string }).path)
        .filter((p): p is string => typeof p === "string" && p.length > 0);
      if (paths.length > 0) {
        handleAddDocuments(paths);
      }
    },
    [handleAddDocuments],
  );

  // 删除材料
  const handleRemoveDocument = useCallback(
    async (id: string) => {
      try {
        await workspaceRemoveDocument(id);
        setDocuments((prev) => prev.filter((d) => d.id !== id));
        if (selectedDocumentId === id) {
          setSelectedDocumentId(null);
          setCenterView("empty");
        }
      } catch (e) {
        console.error("删除材料失败:", e);
      }
    },
    [selectedDocumentId],
  );

  // 新建文稿
  const handleCreateDraft = useCallback(async () => {
    try {
      const draft = await workspaceCreateDraft(workspaceId, "新文稿");
      setDrafts((prev) => [draft, ...prev]);
      setSelectedDraftId(draft.id);
      setCenterView("draft");
    } catch (e) {
      console.error("创建文稿失败:", e);
    }
  }, [workspaceId]);

  // 删除文稿
  const handleDeleteDraft = useCallback(
    async (id: string) => {
      try {
        await workspaceDeleteDraft(id);
        setDrafts((prev) => prev.filter((d) => d.id !== id));
        if (selectedDraftId === id) {
          setSelectedDraftId(null);
          setCenterView("empty");
        }
      } catch (e) {
        console.error("删除文稿失败:", e);
      }
    },
    [selectedDraftId],
  );

  // 选中左侧文稿
  const handleSelectDraft = useCallback((id: string) => {
    setSelectedDraftId(id);
    setCenterView("draft");
  }, []);

  // 选中左侧材料
  const handleSelectDocument = useCallback((id: string) => {
    setSelectedDocumentId(id);
    setCenterView("document");
  }, []);

  // 刷新数据（保存文稿后）
  const handleSaved = useCallback(() => {
    loadData();
  }, [loadData]);

  const selectedDraft = useMemo(
    () => drafts.find((d) => d.id === selectedDraftId) ?? null,
    [drafts, selectedDraftId],
  );

  const selectedDocument = useMemo(
    () => documents.find((d) => d.id === selectedDocumentId) ?? null,
    [documents, selectedDocumentId],
  );

  if (loading) {
    return (
      <main className="app-shell flex h-full w-full flex-col items-center justify-center">
        <div className="text-sm text-muted-foreground">加载中...</div>
      </main>
    );
  }

  return (
    <main className="app-shell flex h-full w-full flex-col">
      {/* 顶部标题栏 */}
      <header className="app-subheader flex shrink-0 items-center gap-3 border-b px-4 py-2.5 sm:px-6">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          返回工作区列表
        </button>
        <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
          <FolderOpen className="size-4 text-sky-600 dark:text-sky-400" />
          {workspace?.name ?? "工作区"}
        </h2>
      </header>

      {/* 三栏布局 */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* 左栏：文件面板 */}
        <aside
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={cn(
            "flex flex-col bg-background",
            expanded === "left"
              ? "fixed inset-0 z-50 w-full flex flex-col bg-background shadow-2xl"
              : "relative w-64 shrink-0 border-r border-border",
            isDragging && "ring-2 ring-inset ring-sky-500/50",
          )}
        >
          <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
            <span className="text-xs font-semibold text-foreground">文件</span>
            <button
              type="button"
              onClick={() => toggleExpand("left")}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title={expanded === "left" ? "缩小" : "全屏"}
            >
              {expanded === "left" ? (
                <Minimize2 className="h-3.5 w-3.5" />
              ) : (
                <Maximize2 className="h-3.5 w-3.5" />
              )}
            </button>
          </div>

          <div className="flex-1 overflow-auto p-3">
            {/* 新建 / 添加 按钮 */}
            <div className="mb-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={handleCreateDraft}
                className="flex items-center justify-center gap-1 rounded-md border border-border bg-card px-2 py-1.5 text-xs text-foreground transition-colors hover:border-foreground/30 hover:bg-muted"
              >
                <Plus className="h-3 w-3" />
                新建文稿
              </button>
              <button
                type="button"
                onClick={() => handleAddDocuments()}
                className="flex items-center justify-center gap-1 rounded-md border border-border bg-card px-2 py-1.5 text-xs text-foreground transition-colors hover:border-foreground/30 hover:bg-muted"
              >
                <FileUp className="h-3 w-3" />
                添加材料
              </button>
            </div>

            {/* 材料列表 */}
            <Section title={`材料 ${documents.length}`}>
              {documents.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground/70">
                  拖入或选择文件，原文件保持不变。
                </p>
              ) : (
                <div className="space-y-0.5">
                  {documents.map((doc) => (
                    <DocumentItem
                      key={doc.id}
                      doc={doc}
                      selected={selectedDocumentId === doc.id}
                      onSelect={() => handleSelectDocument(doc.id)}
                      onDelete={() => handleRemoveDocument(doc.id)}
                    />
                  ))}
                </div>
              )}
            </Section>

            {/* 文稿列表 */}
            <Section title={`文稿 ${drafts.length}`} className="mt-4">
              {drafts.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground/70">
                  AI 生成的文稿会保存在这里。
                </p>
              ) : (
                <div className="space-y-0.5">
                  {drafts.map((draft) => (
                    <DraftItem
                      key={draft.id}
                      draft={draft}
                      selected={selectedDraftId === draft.id}
                      onSelect={() => handleSelectDraft(draft.id)}
                      onDelete={() => handleDeleteDraft(draft.id)}
                    />
                  ))}
                </div>
              )}
            </Section>
          </div>
        </aside>

        {/* 中栏：编辑器 / 材料查看 / 空状态 */}
        <section
          className={cn(
            "flex min-w-0 flex-col bg-background",
            expanded === "center"
              ? "fixed inset-0 z-50 w-full flex min-w-0 flex-col bg-background shadow-2xl"
              : "relative flex-1 border-r border-border",
          )}
        >
          <CenterHeader
            view={centerView}
            draft={selectedDraft}
            document={selectedDocument}
            isExpanded={expanded === "center"}
            onToggleExpand={() => toggleExpand("center")}
          />

          <div className="min-h-0 flex-1">
            {centerView === "draft" && selectedDraftId ? (
              <WorkspaceDraftEditor
                draftId={selectedDraftId}
                onSaved={handleSaved}
                showBackButton={false}
              />
            ) : centerView === "document" && selectedDocument ? (
              <DocumentViewer document={selectedDocument} onExtracted={refreshDocuments} />
            ) : (
              <EmptyCenter />
            )}
          </div>
        </section>

        {/* 右栏：AI 助手 */}
        <aside
          className={cn(
            "flex flex-col bg-background",
            expanded === "right"
              ? "fixed inset-0 z-50 w-full flex flex-col bg-background shadow-2xl"
              : "relative w-[26rem] shrink-0",
          )}
        >
          {activeConversationId ? (
            <WorkspaceChatPanel
              key={activeConversationId}
              conversationId={activeConversationId}
              workspaceId={workspaceId}
              documents={documents}
              conversations={conversations}
              isExpanded={expanded === "right"}
              onToggleExpand={() => toggleExpand("right")}
              onCreateConversation={handleCreateConversation}
              onSelectConversation={setActiveConversationId}
              onDeleteConversation={handleDeleteConversation}
              onRenameConversation={handleRenameConversation}
            />
          ) : (
            <div className="flex h-full flex-col">
              <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
                <span className="text-xs font-semibold text-foreground">AI 助手</span>
                <button
                  type="button"
                  onClick={() => toggleExpand("right")}
                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {expanded === "right" ? (
                    <Minimize2 className="h-3.5 w-3.5" />
                  ) : (
                    <Maximize2 className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
              <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                初始化中...
              </div>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}

/** 分栏小标题 */
function Section({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("", className)}>
      <h3 className="mb-1.5 px-1 text-xs font-medium text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}

/** 材料项 */
function DocumentItem({
  doc,
  selected,
  onSelect,
  onDelete,
}: {
  doc: WorkspaceDocument;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const statusIcon = {
    done: <CheckCircle className="h-3.5 w-3.5 text-green-500" />,
    processing: <Clock className="h-3.5 w-3.5 animate-pulse text-blue-500" />,
    failed: <AlertCircle className="h-3.5 w-3.5 text-red-500" />,
    pending: <Clock className="h-3.5 w-3.5 text-muted-foreground" />,
  }[doc.extraction_status] ?? <Clock className="h-3.5 w-3.5 text-muted-foreground" />;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => e.key === "Enter" && onSelect()}
      className={cn(
        "group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors",
        selected
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
      )}
    >
      {statusIcon}
      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{doc.filename}</span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
        title="删除"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}

/** 文稿项 */
function DraftItem({
  draft,
  selected,
  onSelect,
  onDelete,
}: {
  draft: WorkspaceDraft;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => e.key === "Enter" && onSelect()}
      className={cn(
        "group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors",
        selected
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
      )}
    >
      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{draft.title}</span>
      {draft.status === "final" && <Star className="h-3 w-3 shrink-0 text-yellow-500 fill-yellow-500" />}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
        title="删除"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}

/** 中间栏 header */
function CenterHeader({
  view,
  draft,
  document,
  isExpanded,
  onToggleExpand,
}: {
  view: CenterView;
  draft: WorkspaceDraft | null;
  document: WorkspaceDocument | null;
  isExpanded: boolean;
  onToggleExpand: () => void;
}) {
  const title =
    view === "draft" && draft
      ? draft.title
      : view === "document" && document
        ? document.filename
        : "文稿";

  return (
    <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
      <span className="min-w-0 truncate text-xs font-semibold text-foreground">{title}</span>
      <button
        type="button"
        onClick={onToggleExpand}
        className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        title={isExpanded ? "缩小" : "全屏"}
      >
        {isExpanded ? (
          <Minimize2 className="h-3.5 w-3.5" />
        ) : (
          <Maximize2 className="h-3.5 w-3.5" />
        )}
      </button>
    </div>
  );
}

/** 空状态 */
function EmptyCenter() {
  return (
    <div className="flex h-full flex-col items-center justify-center text-sm text-muted-foreground">
      <FileText className="mb-3 h-10 w-10 opacity-30" />
      <p>选择左侧材料查看，或新建一份文稿。</p>
    </div>
  );
}

/** 材料文本查看器 */
function DocumentViewer({
  document: doc,
  onExtracted,
}: {
  document: WorkspaceDocument;
  onExtracted?: () => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setText(null);
    setError(null);
    setLoading(true);
    // 该命令触发抽取（如尚未完成）并返回抽取出的真实文本
    workspaceExtractDocument(doc.id)
      .then((extracted) => {
        if (cancelled) return;
        setText(extracted);
        onExtracted?.();
      })
      .catch((e) => {
        if (cancelled) return;
        setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [doc.id, onExtracted]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        读取材料中...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-sm text-red-500">
        读取失败：{error}
      </div>
    );
  }

  if (!text || text.trim().length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
        该材料尚未完成文本抽取，或抽取内容为空。
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto px-6 py-4">
      <pre className="whitespace-pre-wrap font-mono text-sm text-foreground">{text}</pre>
    </div>
  );
}
