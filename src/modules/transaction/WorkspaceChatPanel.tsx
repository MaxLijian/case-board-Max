/**
 * AI 事务工作区 — 对话面板。
 *
 * 支持流式输出、消息历史、工具调用记录、对话切换。
 */

import { type ComponentProps, useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Send,
  Loader2,
  Bot,
  ChevronDown,
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  workspaceListMessages,
  workspaceChat,
  workspaceRenameConversation,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import type { WorkspaceConversation, WorkspaceDocument, WorkspaceMessage } from "@/lib/types";

interface Props {
  conversationId: string;
  workspaceId: string;
  documents: WorkspaceDocument[];
  conversations: WorkspaceConversation[];
  isExpanded: boolean;
  onToggleExpand: () => void;
  onCreateConversation: () => void;
  onSelectConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  onRenameConversation?: (id: string, title: string) => void;
}

type MdComponents = ComponentProps<typeof ReactMarkdown>["components"];

const mdComponents: MdComponents = {
  table({ children, ...props }) {
    return (
      <div className="my-2 w-full overflow-x-auto rounded-md border border-border bg-background">
        <table {...props} className="w-full min-w-max border-collapse text-left text-[13px] leading-relaxed">
          {children}
        </table>
      </div>
    );
  },
  thead({ children, ...props }) {
    return <thead {...props} className="bg-muted/70">{children}</thead>;
  },
  th({ children, ...props }) {
    return <th {...props} className="border-b border-r border-border px-3 py-2 text-center text-xs font-semibold text-muted-foreground last:border-r-0">{children}</th>;
  },
  td({ children, ...props }) {
    return <td {...props} className="border-b border-r border-border px-3 py-2 align-top last:border-r-0 [&_p]:my-1">{children}</td>;
  },
  tr({ children, ...props }) {
    return <tr {...props} className="last:[&_td]:border-b-0 last:[&_th]:border-b-0">{children}</tr>;
  },
};

const mdClassName = cn(
  "min-w-0 max-w-none break-words text-sm leading-[1.7] text-foreground",
  "[&_h1]:mb-3 [&_h1]:mt-2 [&_h1]:text-center [&_h1]:text-xl [&_h1]:font-semibold",
  "[&_h2]:mb-2 [&_h2]:mt-3 [&_h2]:border-b [&_h2]:border-border [&_h2]:pb-1.5 [&_h2]:text-base [&_h2]:font-semibold",
  "[&_h3]:mb-1.5 [&_h3]:mt-2.5 [&_h3]:text-[15px] [&_h3]:font-semibold",
  "[&_h4]:mb-1 [&_h4]:mt-2 [&_h4]:text-sm [&_h4]:font-semibold",
  "[&_p]:my-1.5",
  "[&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5",
  "[&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5",
  "[&_li]:my-0.5 [&_li>p]:my-0.5",
  "[&_strong]:font-semibold",
  "[&_pre]:my-2.5 [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-border [&_pre]:bg-muted/60 [&_pre]:p-3 [&_pre]:text-xs [&_pre]:leading-relaxed",
  "[&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px]",
  "[&_pre_code]:whitespace-pre [&_pre_code]:bg-transparent [&_pre_code]:p-0",
);

export function WorkspaceChatPanel({
  conversationId,
  workspaceId: _workspaceId,
  documents: _documents,
  conversations,
  isExpanded,
  onToggleExpand,
  onCreateConversation,
  onSelectConversation,
  onDeleteConversation,
  onRenameConversation,
}: Props) {
  const [messages, setMessages] = useState<WorkspaceMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingToolName, setStreamingToolName] = useState<string | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const activeConversation = conversations.find((c) => c.id === conversationId);

  const loadMessages = useCallback(async () => {
    try {
      const msgs = await workspaceListMessages(conversationId);
      setMessages(msgs);
    } catch (e) {
      console.error("加载消息失败:", e);
    }
  }, [conversationId]);

  // 加载消息历史
  useEffect(() => {
    if (conversationId) {
      setMessages([]);
      loadMessages();
    }
    return () => {
      unlistenRef.current?.();
    };
  }, [conversationId, loadMessages]);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  // 点击外部关闭菜单
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSend = useCallback(async () => {
    const content = input.trim();
    if (!content || isStreaming) return;

    // 立即添加用户消息到列表
    const userMsg: WorkspaceMessage = {
      id: `user-${Date.now()}`,
      conversation_id: conversationId,
      role: "user",
      content,
      model: null,
      prompt_tokens: null,
      completion_tokens: null,
      latency_ms: null,
      based_on: null,
      artifact_draft_id: null,
      error_short: null,
      citations_json: null,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);

    setInput("");
    setIsStreaming(true);
    setStreamingContent("");
    setStreamingToolName(null);

    // 先清理上一次的 listener，避免内存泄漏
    unlistenRef.current?.();
    unlistenRef.current = null;

    // 监听流式事件
    const channel = `chat-stream-${conversationId}`;
    try {
      unlistenRef.current = await listen<{
        kind: string;
        text?: string;
        message?: string;
        record?: { tool?: string };
      }>(channel, (event) => {
        const { kind, text } = event.payload;
        if (kind === "delta" && text) {
          setStreamingContent((prev) => prev + text);
        } else if (kind === "reasoning" && text) {
          // 深度推理模型的思考进度 — 不进正文，仅更新状态提示
          setStreamingContent((prev) => prev);
        } else if (kind === "tool_call") {
          const name = event.payload.record?.tool ?? "工具";
          setStreamingToolName(name);
        } else if (kind === "done") {
          setIsStreaming(false);
          setStreamingToolName(null);
          loadMessages().finally(() => setStreamingContent(""));
        } else if (kind === "error") {
          setIsStreaming(false);
          setStreamingToolName(null);
          loadMessages().finally(() => setStreamingContent(""));
        }
      });
    } catch (e) {
      console.error("监听流式事件失败:", e);
    }

    // 发送消息
    try {
      await workspaceChat(conversationId, content);
    } catch (e) {
      console.error("发送消息失败:", e);
      setIsStreaming(false);
      setStreamingContent("");
      // 显示错误消息
      const errorMsg: WorkspaceMessage = {
        id: `error-${Date.now()}`,
        conversation_id: conversationId,
        role: "assistant",
        content: `发送失败: ${e}`,
        model: null,
        prompt_tokens: null,
        completion_tokens: null,
        latency_ms: null,
        based_on: null,
        artifact_draft_id: null,
        error_short: String(e),
        citations_json: null,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    }
  }, [input, isStreaming, conversationId, loadMessages]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleRename = useCallback(async () => {
    if (!editingId || !editingTitle.trim()) {
      setEditingId(null);
      return;
    }
    const title = editingTitle.trim();
    try {
      await workspaceRenameConversation(editingId, title);
      onRenameConversation?.(editingId, title);
    } catch (e) {
      console.error("重命名对话失败:", e);
    } finally {
      setEditingId(null);
    }
  }, [editingId, editingTitle, onRenameConversation]);

  return (
    <div className="flex h-full flex-col">
      {/* 头部：AI 助手 + 对话切换 + 全屏 */}
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-sky-600 dark:text-sky-400" />
          <span className="text-xs font-semibold text-foreground">AI 助手</span>
        </div>

        <div className="flex items-center gap-1">
          {/* 对话切换下拉 */}
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setShowMenu((v) => !v)}
              className="flex max-w-[10rem] items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title={activeConversation?.title ?? "对话"}
            >
              <span className="truncate">{activeConversation?.title ?? "对话"}</span>
              <ChevronDown className="h-3 w-3 shrink-0" />
            </button>

            {showMenu && (
              <div className="absolute right-0 top-full z-20 mt-1 w-52 rounded-md border border-border bg-popover py-1 shadow-sm">
                <div className="max-h-48 overflow-auto">
                  {conversations.map((conv) => (
                    <div
                      key={conv.id}
                      className={cn(
                        "group flex items-center gap-1 px-2 py-1.5 text-xs transition-colors hover:bg-muted",
                        conv.id === conversationId
                          ? "bg-muted text-foreground"
                          : "text-muted-foreground",
                      )}
                    >
                      {editingId === conv.id ? (
                        <>
                          <input
                            type="text"
                            value={editingTitle}
                            onChange={(e) => setEditingTitle(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleRename();
                              if (e.key === "Escape") setEditingId(null);
                            }}
                            autoFocus
                            className="min-w-0 flex-1 rounded border border-border bg-background px-1 py-0.5 text-xs focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={handleRename}
                            className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                          >
                            <Check className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              onSelectConversation(conv.id);
                              setShowMenu(false);
                            }}
                            className="min-w-0 flex-1 truncate text-left"
                          >
                            {conv.title}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(conv.id);
                              setEditingTitle(conv.title);
                            }}
                            className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                          >
                            <Edit2 className="h-3 w-3" />
                          </button>
                          {conversations.length > 1 && (
                            <button
                              type="button"
                              onClick={() => {
                                onDeleteConversation(conv.id);
                                setShowMenu(false);
                              }}
                              className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                </div>
                <div className="border-t border-border pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      onCreateConversation();
                      setShowMenu(false);
                    }}
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-foreground transition-colors hover:bg-muted"
                  >
                    <Plus className="h-3 w-3" />
                    新建对话
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 全屏 / 缩小 */}
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
      </div>

      {/* 消息区域 */}
      <div className="flex-1 overflow-auto px-4 py-4">
        {messages.length === 0 && !streamingContent && (
          <div className="flex h-full items-center justify-center">
            <div className="text-center text-sm text-muted-foreground">
              <p>开始对话，AI 会基于工作区材料回答问题</p>
              <p className="mt-1 text-xs">
                可以上传材料、起草文书、分析文件
              </p>
            </div>
          </div>
        )}

        <div className="space-y-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-lg px-4 py-2 text-sm ${
                  msg.role === "user"
                    ? "bg-foreground text-background"
                    : "bg-muted text-foreground"
                }`}
              >
                {msg.role === "user" ? (
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                ) : (
                  <>
                    <div className={mdClassName}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                        {msg.content}
                      </ReactMarkdown>
                    </div>
                    {/* 模型信息 */}
                    {(msg.model || msg.prompt_tokens !== null || msg.latency_ms !== null) && (
                      <div className="mt-2 flex items-center gap-2 border-t border-border/50 pt-1.5 text-xs text-muted-foreground">
                        {msg.model && <span>{msg.model}</span>}
                        {msg.prompt_tokens !== null && msg.completion_tokens !== null && (
                          <span>{msg.prompt_tokens}p / {msg.completion_tokens}c</span>
                        )}
                        {msg.latency_ms !== null && <span>{(msg.latency_ms / 1000).toFixed(1)}s</span>}
                      </div>
                    )}
                  </>
                )}
                {msg.error_short && (
                  <div className="mt-1 text-xs text-red-500">
                    {msg.error_short}
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* 流式输出 */}
          {isStreaming && streamingContent && (
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-lg bg-muted px-4 py-2 text-sm text-foreground">
                <div className={mdClassName}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                    {streamingContent}
                  </ReactMarkdown>
                </div>
                <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>{streamingToolName ? `正在使用 ${streamingToolName}…` : "生成中..."}</span>
                </div>
              </div>
            </div>
          )}

          {/* 流式等待中 - AI 思考状态 */}
          {isStreaming && !streamingContent && (
            <div className="flex justify-start">
              <div className="rounded-lg bg-muted px-4 py-2.5 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>{streamingToolName ? `正在使用 ${streamingToolName}…` : "正在思考..."}</span>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* 输入区域 */}
      <div className="border-t border-border px-4 py-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="告诉 AI 要写什么、怎么修改……"
            rows={1}
            className="flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-foreground focus:outline-none disabled:opacity-50"
            disabled={isStreaming}
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!input.trim() || isStreaming}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-foreground text-background transition-colors hover:bg-foreground/90 disabled:opacity-50"
          >
            {isStreaming ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
