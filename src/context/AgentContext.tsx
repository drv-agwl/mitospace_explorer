import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  ReactNode,
} from 'react';
import {
  AgentAction,
  ChatRequestError,
  getFeatureValues,
  sendChatMessage,
} from '../api/client';
import { useSample } from './SampleContext';
import { emitToast, ToastPayload } from '../lib/uiCommands';

const TOAST_KIND: Record<AgentAction['type'], ToastPayload['kind']> = {
  color_by_feature: 'color',
  set_coloring_mode: 'color',
  filter_conditions: 'filter',
  open_cell: 'cell',
  set_point_size: 'size',
  set_grid: 'grid',
  reset_view: 'reset',
};

/**
 * The agent layer. This is what turns MitoSpace from a set of controls you
 * operate into an atlas you converse with: the user asks in natural language,
 * the backend agent answers with grounded numbers AND returns view actions,
 * and this provider dispatches those actions into the visualizer (SampleContext).
 *
 * Safety: actions only mutate view state (colour / filter / focus / reset).
 * No numbers are produced here — those stay backend-computed and
 * groundedness-checked. The agent narrates and drives; it never invents data.
 */

export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  /** Structured stats the answer was grounded in (for the "view data" affordance). */
  data?: unknown;
  /** Every number verified against backend stats. */
  grounded?: boolean;
  /** 'agent' | 'llm' | 'fallback'. */
  source?: string;
  /** Compute/action tools the agent invoked, in order. */
  toolsUsed?: string[];
  /** View actions the agent performed this turn (rendered as chips). */
  actions?: AgentAction[];
  /** One-click follow-up questions. */
  suggestions?: string[];
  /** Synthetic error bubble (offers retry). */
  isError?: boolean;
}

interface AgentContextValue {
  messages: AgentMessage[];
  isLoading: boolean;
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  send: (text: string) => void;
  retryLast: () => void;
  clear: () => void;
  stop: () => void;
  /** Human-readable log of view changes the agent made (latest first). */
  actionLog: string[];
}

const AgentContext = createContext<AgentContextValue | null>(null);

const MAX_HISTORY = 12;

export const AgentProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const {
    datasetVersion,
    samples4D,
    availableDrugs,
    selectedDrugs,
    setSelectedDrugs,
    clearDrugFilter,
    setSelectedSample,
    setSelectedPointIndex,
    setSemanticState,
    setColoringMode,
    setPointSize,
    setShowGrid,
    addComparisonCell,
    clearComparison,
  } = useSample();

  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [actionLog, setActionLog] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const lastUserRef = useRef<string | null>(null);

  // Turn off feature/semantic colouring (shared by several actions).
  const clearFeatureColoring = useCallback(() => {
    setSemanticState((s) => ({
      ...s,
      advancedMode: false,
      selectedFeature: null,
      semanticSliderValue: null,
      projectedPosition: null,
      projectedConfidence: null,
      axisSamplesVisible: false,
    }));
  }, [setSemanticState]);

  // Indices in samples4D belonging to a drug slug (case-insensitive).
  const indicesForDrug = useCallback(
    (drug: string): number[] => {
      const slug = drug.toLowerCase();
      const out: number[] = [];
      samples4D.forEach((s, i) => {
        if (s.treatment.drug.toLowerCase() === slug) out.push(i);
      });
      return out;
    },
    [samples4D],
  );

  // ── Dispatch a single agent view-action into the visualizer ──────────────
  // Async because opening an outlier cell may need to fetch feature values.
  const dispatchAction = useCallback(
    async (action: AgentAction): Promise<string | null> => {
      switch (action.type) {
        case 'color_by_feature': {
          setSemanticState((s) => ({
            ...s,
            advancedMode: true,
            selectedFeature: action.feature,
            projectedPosition: null,
            projectedConfidence: null,
            semanticSliderValue: null,
            axisSamplesVisible: false,
          }));
          return `Coloured by ${action.label}`;
        }
        case 'set_coloring_mode': {
          clearFeatureColoring();
          setColoringMode(action.mode);
          return `Coloured by ${action.label}`;
        }
        case 'filter_conditions': {
          // Resolve requested slugs to the exact strings the dataset filters on.
          const wanted = action.drugs.map((d) => d.toLowerCase());
          const matched = availableDrugs.filter((d) =>
            wanted.includes(d.toLowerCase()),
          );
          if (matched.length === 0) return null;
          setSelectedDrugs(new Set(matched));
          return `Filtered to ${matched.join(', ')}`;
        }
        case 'open_cell': {
          const idxs = indicesForDrug(action.drug);
          if (idxs.length === 0) return null;

          let chosen: number;
          if (action.selection === 'lowest' || action.selection === 'highest') {
            if (!action.feature) return null;
            let values: number[] = [];
            try {
              values = await getFeatureValues(action.feature, datasetVersion);
            } catch {
              return null;
            }
            const wantLow = action.selection === 'lowest';
            let best = -1;
            let bestVal = wantLow ? Infinity : -Infinity;
            for (const i of idxs) {
              const v = values[i];
              if (!Number.isFinite(v)) continue;
              if (wantLow ? v < bestVal : v > bestVal) {
                bestVal = v;
                best = i;
              }
            }
            if (best < 0) return null;
            chosen = best;
          } else {
            // Representative: a middle cell reads as more "typical" than the first.
            chosen = idxs[Math.floor(idxs.length / 2)];
          }

          const sample = samples4D[chosen];
          // If a drug filter is active that would hide this cell, reveal it so
          // the selection isn't immediately auto-deselected by the filter.
          if (selectedDrugs.size > 0 && !selectedDrugs.has(sample.treatment.drug)) {
            setSelectedDrugs(new Set([...selectedDrugs, sample.treatment.drug]));
          }
          setSelectedSample(sample);
          setSelectedPointIndex(chosen);
          // Accumulate into the comparison gallery so multiple open_cell calls
          // (e.g. "compare a CCCP and a DMSO cell") show up side by side.
          addComparisonCell(sample, chosen);

          if (action.selection === 'lowest' || action.selection === 'highest') {
            const dir = action.selection === 'lowest' ? 'lowest' : 'highest';
            return `Opened the ${dir}-${action.featureLabel ?? 'value'} ${action.drug} cell`;
          }
          return `Opened a representative ${action.drug} cell`;
        }
        case 'set_point_size': {
          setPointSize(action.size);
          return `Set point size to ${action.label}`;
        }
        case 'set_grid': {
          setShowGrid(action.show);
          return action.show ? 'Showed the grid' : 'Hid the grid';
        }
        case 'reset_view': {
          clearDrugFilter();
          setSelectedSample(null);
          setSelectedPointIndex(null);
          clearComparison();
          clearFeatureColoring();
          return 'Reset the view';
        }
        default:
          return null;
      }
    },
    [
      availableDrugs,
      samples4D,
      selectedDrugs,
      datasetVersion,
      indicesForDrug,
      clearFeatureColoring,
      setColoringMode,
      setSelectedDrugs,
      clearDrugFilter,
      setSelectedSample,
      setSelectedPointIndex,
      setSemanticState,
      setPointSize,
      setShowGrid,
      addComparisonCell,
      clearComparison,
    ],
  );

  const runRequest = useCallback(
    async (text: string, prior: AgentMessage[]) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setIsLoading(true);
      lastUserRef.current = text;

      try {
        const history = prior
          .filter((m) => !m.isError)
          .slice(-MAX_HISTORY)
          .map((m) => ({ role: m.role, content: m.content }));

        const res = await sendChatMessage(text, history, datasetVersion, {
          signal: controller.signal,
        });

        // Dispatch view actions before showing the bubble so the atlas has
        // already moved by the time the user reads the narration.
        const performed: string[] = [];
        for (const action of res.actions ?? []) {
          const label = await dispatchAction(action);
          if (label) {
            performed.push(label);
            emitToast({ text: label, kind: TOAST_KIND[action.type] ?? 'generic' });
          }
        }
        if (performed.length) {
          setActionLog((prev) => [...performed, ...prev].slice(0, 30));
        }

        const assistant: AgentMessage = {
          id: `${Date.now()}-a`,
          role: 'assistant',
          content: res.answer,
          timestamp: Date.now(),
          data: res.data,
          grounded: res.grounded,
          source: res.source,
          toolsUsed: res.tools_used,
          actions: res.actions,
          suggestions: res.suggestions,
        };
        setMessages((prev) => [...prev, assistant]);
      } catch (err) {
        const cancelled =
          err instanceof ChatRequestError &&
          !err.retryable &&
          err.message === 'Cancelled.';
        if (cancelled) return;
        const msg =
          err instanceof Error ? err.message : 'Something went wrong.';
        setMessages((prev) => [
          ...prev,
          {
            id: `${Date.now()}-e`,
            role: 'assistant',
            content: msg,
            timestamp: Date.now(),
            isError: true,
          },
        ]);
      } finally {
        abortRef.current = null;
        setIsLoading(false);
      }
    },
    [datasetVersion, dispatchAction],
  );

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isLoading) return;
      setIsOpen(true);
      const userMsg: AgentMessage = {
        id: `${Date.now()}-u`,
        role: 'user',
        content: trimmed,
        timestamp: Date.now(),
      };
      setMessages((prev) => {
        const next = [...prev, userMsg];
        void runRequest(trimmed, next);
        return next;
      });
    },
    [isLoading, runRequest],
  );

  const retryLast = useCallback(() => {
    if (isLoading || !lastUserRef.current) return;
    const text = lastUserRef.current;
    setMessages((prev) => {
      const cleaned = prev.filter((m) => !m.isError);
      void runRequest(text, cleaned);
      return cleaned;
    });
  }, [isLoading, runRequest]);

  const stop = useCallback(() => abortRef.current?.abort(), []);
  const clear = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
  }, []);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((o) => !o), []);

  const value = useMemo<AgentContextValue>(
    () => ({
      messages,
      isLoading,
      isOpen,
      open,
      close,
      toggle,
      send,
      retryLast,
      clear,
      stop,
      actionLog,
    }),
    [messages, isLoading, isOpen, open, close, toggle, send, retryLast, clear, stop, actionLog],
  );

  return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>;
};

export const useAgent = (): AgentContextValue => {
  const ctx = useContext(AgentContext);
  if (!ctx) throw new Error('useAgent must be used within an AgentProvider');
  return ctx;
};
