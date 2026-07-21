/**
 * AI 事务工作区 — 文稿修改差异对比。
 *
 * 显示 AI 修改建议的左右对比，用户确认后应用。
 */

import { useCallback, useState } from "react";
import { Check, X } from "lucide-react";

interface Props {
  original: string;
  modified: string;
  onAccept: (newContent: string) => void;
  onReject: () => void;
}

interface DiffLine {
  type: "same" | "added" | "removed";
  content: string;
}

function computeDiff(original: string, modified: string): DiffLine[] {
  const origLines = original.split("\n");
  const modLines = modified.split("\n");
  const diff: DiffLine[] = [];

  // 简单的逐行对比
  const maxLen = Math.max(origLines.length, modLines.length);
  for (let i = 0; i < maxLen; i++) {
    const origLine = origLines[i];
    const modLine = modLines[i];

    if (origLine === modLine) {
      diff.push({ type: "same", content: origLine });
    } else {
      if (origLine !== undefined) {
        diff.push({ type: "removed", content: origLine });
      }
      if (modLine !== undefined) {
        diff.push({ type: "added", content: modLine });
      }
    }
  }

  return diff;
}

export function WorkspaceDraftDiff({ original, modified, onAccept, onReject }: Props) {
  const [diff] = useState(() => computeDiff(original, modified));

  const handleAccept = useCallback(() => {
    onAccept(modified);
  }, [modified, onAccept]);

  return (
    <div className="flex h-full flex-col">
      {/* 标题栏 */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <span className="text-sm font-medium text-foreground">修改对比</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onReject}
            className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-3 w-3" />
            拒绝修改
          </button>
          <button
            type="button"
            onClick={handleAccept}
            className="flex items-center gap-1 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-colors hover:bg-foreground/90"
          >
            <Check className="h-3 w-3" />
            接受修改
          </button>
        </div>
      </div>

      {/* 差异内容 */}
      <div className="flex-1 overflow-auto font-mono text-xs">
        <table className="w-full border-collapse">
          <tbody>
            {diff.map((line, idx) => (
              <tr
                key={idx}
                className={
                  line.type === "added"
                    ? "bg-green-50 dark:bg-green-950/30"
                    : line.type === "removed"
                      ? "bg-red-50 dark:bg-red-950/30"
                      : ""
                }
              >
                <td className="w-8 border-r border-border px-2 py-0.5 text-right text-muted-foreground">
                  {line.type === "removed" && idx + 1}
                </td>
                <td className="w-8 border-r border-border px-2 py-0.5 text-right text-muted-foreground">
                  {line.type === "added" && idx + 1}
                </td>
                <td className="w-8 border-r border-border px-2 py-0.5 text-center">
                  {line.type === "added" && (
                    <span className="text-green-600">+</span>
                  )}
                  {line.type === "removed" && (
                    <span className="text-red-600">-</span>
                  )}
                  {line.type === "same" && (
                    <span className="text-muted-foreground">·</span>
                  )}
                </td>
                <td className="whitespace-pre px-2 py-0.5">{line.content}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
