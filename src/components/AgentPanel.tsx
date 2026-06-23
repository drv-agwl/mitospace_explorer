import React, { useEffect, useRef, useState } from 'react';
import {
  Sparkles,
  ArrowUp,
  Square,
  ShieldCheck,
  Palette,
  Filter,
  Film,
  RotateCcw,
  RefreshCw,
  AlertCircle,
  Wrench,
  Eraser,
  Circle,
  Grid3X3,
  Droplet,
  Copy,
  Check,
} from 'lucide-react';
import { AgentAction } from '../api/client';
import { useAgent, AgentMessage } from '../context/AgentContext';
import { onCommand } from '../lib/uiCommands';

/**
 * AgentPanel — the conversational workspace, docked in the right rail.
 *
 * Layout is a fixed column: a scrolling transcript on top and an input bar
 * anchored to the bottom. Because it lives inside the dock's column, growing
 * input or long answers never overlap the 3D atlas — they scroll within the
 * rail. This is the deliberate replacement for the old floating bar.
 *
 * Safety: actions only mutate view state. Numbers stay backend-computed and
 * groundedness-checked; the agent narrates + drives, never invents data.
 */

const EXAMPLE_PROMPTS = [
  'Which drugs collapse membrane potential?',
  'Color the atlas by motility',
  'Compare CCCP and Rotenone',
  'What does Nigericin do to mitochondria?',
];

function renderRich(text: string): React.ReactNode {
  const inline = (chunk: string): React.ReactNode[] => {
    const parts: React.ReactNode[] = [];
    let i = 0;
    let key = 0;
    while (i < chunk.length) {
      const next = chunk.indexOf('**', i);
      if (next === -1) {
        parts.push(chunk.slice(i));
        break;
      }
      if (next > i) parts.push(chunk.slice(i, next));
      const end = chunk.indexOf('**', next + 2);
      if (end === -1) {
        parts.push(chunk.slice(next));
        break;
      }
      parts.push(
        <strong key={`b${key++}`} className="font-semibold text-white">
          {chunk.slice(next + 2, end)}
        </strong>,
      );
      i = end + 2;
    }
    return parts;
  };

  const lines = text.split('\n');
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  let k = 0;
  const flush = () => {
    if (!list.length) return;
    blocks.push(
      <ul key={`l${k++}`} className="my-1 list-disc space-y-0.5 pl-4">
        {list.map((it, idx) => (
          <li key={idx}>{inline(it)}</li>
        ))}
      </ul>,
    );
    list = [];
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const m = line.match(/^\s*[-•]\s+(.*)$/) || line.match(/^\s*\d+\.\s+(.*)$/);
    if (m) {
      list.push(m[1]);
      continue;
    }
    flush();
    if (!line) blocks.push(<div key={`s${k++}`} className="h-1.5" />);
    else blocks.push(<p key={`p${k++}`}>{inline(line)}</p>);
  }
  flush();
  return <>{blocks}</>;
}

function actionChip(action: AgentAction): { icon: React.ReactNode; label: string } | null {
  switch (action.type) {
    case 'color_by_feature':
      return { icon: <Palette size={12} />, label: `Coloured by ${action.label}` };
    case 'set_coloring_mode':
      return { icon: <Droplet size={12} />, label: `Coloured by ${action.label}` };
    case 'filter_conditions':
      return { icon: <Filter size={12} />, label: `Filtered: ${action.drugs.join(', ')}` };
    case 'open_cell':
      return {
        icon: <Film size={12} />,
        label:
          action.selection === 'representative'
            ? `Opened ${action.drug} cell`
            : `Opened ${action.selection}-${action.featureLabel ?? ''} ${action.drug} cell`,
      };
    case 'set_point_size':
      return { icon: <Circle size={12} />, label: `Point size: ${action.label}` };
    case 'set_grid':
      return { icon: <Grid3X3 size={12} />, label: action.show ? 'Grid on' : 'Grid off' };
    case 'reset_view':
      return { icon: <RotateCcw size={12} />, label: 'Reset view' };
    default:
      return null;
  }
}

const AssistantBubble: React.FC<{
  msg: AgentMessage;
  onSuggestion: (s: string) => void;
  onRetry: () => void;
  disabled: boolean;
}> = ({ msg, onSuggestion, onRetry, disabled }) => {
  if (msg.isError) {
    return (
      <div className="rounded-xl border border-red-400/30 bg-red-500/10 px-3.5 py-3 text-sm text-red-100">
        <div className="flex items-start gap-2">
          <AlertCircle size={15} className="mt-0.5 shrink-0 text-red-300" />
          <div>
            <p className="font-medium text-red-100">Something went wrong</p>
            <p className="mt-0.5 text-red-100/80">{msg.content}</p>
            <button
              onClick={onRetry}
              disabled={disabled}
              className="mt-2 inline-flex items-center gap-1 text-xs text-red-100/90 hover:text-white disabled:opacity-50"
            >
              <RefreshCw size={12} /> Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  const [copied, setCopied] = useState(false);
  const copyAnswer = async () => {
    try {
      await navigator.clipboard.writeText(msg.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // best-effort
    }
  };

  const chips = (msg.actions ?? []).map(actionChip).filter(Boolean) as {
    icon: React.ReactNode;
    label: string;
  }[];

  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] px-3.5 py-3">
      {chips.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {chips.map((c, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1.5 rounded-md border border-cyan-300/20 bg-cyan-400/10 px-2 py-0.5 text-[11px] font-medium text-cyan-100"
            >
              {c.icon}
              {c.label}
            </span>
          ))}
        </div>
      )}

      <div className="space-y-1 text-[13.5px] leading-relaxed text-white/85">
        {renderRich(msg.content)}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2.5 text-[11px] text-white/40">
        {msg.grounded && (
          <span
            className="inline-flex items-center gap-1 text-emerald-300/70"
            title="Every number is computed by the backend and verified"
          >
            <ShieldCheck size={12} /> grounded
          </span>
        )}
        {msg.toolsUsed && msg.toolsUsed.length > 0 && (
          <span className="inline-flex items-center gap-1 text-white/35" title={msg.toolsUsed.join(' → ')}>
            <Wrench size={11} />
            {msg.toolsUsed.length} {msg.toolsUsed.length === 1 ? 'tool' : 'tools'}
          </span>
        )}
        {msg.source === 'fallback' && (
          <span className="text-amber-300/70" title="Deterministic answer (LLM unavailable)">
            deterministic
          </span>
        )}
        <button
          onClick={copyAnswer}
          className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-white/35 transition-colors hover:bg-white/10 hover:text-white/70"
          title="Copy answer"
        >
          {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      {msg.suggestions && msg.suggestions.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {msg.suggestions.map((s) => (
            <button
              key={s}
              onClick={() => onSuggestion(s)}
              disabled={disabled}
              className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-white/65 transition-colors hover:border-white/20 hover:bg-white/[0.08] hover:text-white/90 disabled:opacity-40"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const AgentPanel: React.FC = () => {
  const { messages, isLoading, send, retryLast, clear, stop } = useAgent();
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const hasConversation = messages.length > 0;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Focus the input when the user invokes the Ask command (⌘K / top-bar pill).
  useEffect(
    () =>
      onCommand((cmd) => {
        if (cmd === 'focus-ask') {
          // Defer so the dock has expanded/switched tabs first.
          window.setTimeout(() => inputRef.current?.focus(), 60);
        }
      }),
    [],
  );

  const submit = () => {
    const t = input.trim();
    if (!t || isLoading) return;
    send(t);
    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Transcript / empty state */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto scrollbar-thin px-4 py-4">
        {!hasConversation ? (
          <div className="flex h-full flex-col">
            <div className="mb-5 mt-2">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400/25 to-fuchsia-500/25 ring-1 ring-white/10">
                <Sparkles size={20} className="text-cyan-200" />
              </div>
              <h3 className="text-[15px] font-semibold tracking-tight text-white">Ask the atlas</h3>
              <p className="mt-1 text-[12.5px] leading-relaxed text-white/45">
                Explore 36,106 mitochondrial cells in natural language. I answer with
                verified numbers and can drive the 3D view — colour by a feature, filter
                conditions, or open a cell.
              </p>
            </div>
            <div className="space-y-1.5">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-white/35">
                Try
              </p>
              {EXAMPLE_PROMPTS.map((p) => (
                <button
                  key={p}
                  onClick={() => send(p)}
                  className="group flex w-full items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-2.5 text-left text-[13px] text-white/70 transition-all hover:border-white/15 hover:bg-white/[0.06] hover:text-white/95"
                >
                  <Sparkles size={12} className="shrink-0 text-cyan-300/50 group-hover:text-cyan-300/80" />
                  {p}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((m) =>
              m.role === 'user' ? (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[88%] rounded-xl bg-white px-3.5 py-2 text-[13.5px] font-medium text-black">
                    {m.content}
                  </div>
                </div>
              ) : (
                <AssistantBubble
                  key={m.id}
                  msg={m}
                  onSuggestion={(s) => send(s)}
                  onRetry={retryLast}
                  disabled={isLoading}
                />
              ),
            )}
            {isLoading && (
              <div className="flex items-center gap-2.5 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3.5 py-3">
                <span className="flex gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-300/80" style={{ animationDelay: '0ms' }} />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-300/80" style={{ animationDelay: '120ms' }} />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-300/80" style={{ animationDelay: '240ms' }} />
                </span>
                <span className="text-xs text-white/45">Thinking & exploring the data…</span>
              </div>
            )}
            <div ref={endRef} />
          </>
        )}
      </div>

      {/* Input bar — anchored to the bottom of the dock column */}
      <div className="shrink-0 border-t border-white/[0.08] bg-black/40 p-3">
        {hasConversation && (
          <div className="mb-2 flex justify-end">
            <button
              onClick={clear}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-white/35 transition-colors hover:bg-white/10 hover:text-white/70"
            >
              <Eraser size={11} /> Clear
            </button>
          </div>
        )}
        <div className="flex items-end gap-2 rounded-xl border border-white/[0.12] bg-white/[0.04] px-2.5 py-2 transition-colors focus-within:border-white/25">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            rows={1}
            placeholder="Ask anything about the atlas…"
            className="max-h-32 flex-1 resize-none self-center bg-transparent py-1 text-sm text-white placeholder-white/35 scrollbar-thin focus:outline-none"
            onInput={(e) => {
              const t = e.target as HTMLTextAreaElement;
              t.style.height = 'auto';
              t.style.height = Math.min(t.scrollHeight, 128) + 'px';
            }}
          />
          {isLoading ? (
            <button
              onClick={stop}
              className="mb-0.5 shrink-0 rounded-lg border border-red-400/40 bg-red-500/20 p-1.5 text-red-100 transition-colors hover:bg-red-500/30"
              title="Stop"
            >
              <Square size={14} strokeWidth={2.5} />
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={!input.trim()}
              className="mb-0.5 shrink-0 rounded-lg bg-white p-1.5 text-black transition-all hover:bg-gray-100 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/40"
              title="Ask (Enter)"
            >
              <ArrowUp size={15} strokeWidth={2.5} />
            </button>
          )}
        </div>
        <p className="mt-1.5 px-1 text-[10.5px] text-white/30">
          Numbers are computed and verified server‑side. Enter to send · Shift+Enter for newline.
        </p>
      </div>
    </div>
  );
};

export default AgentPanel;
