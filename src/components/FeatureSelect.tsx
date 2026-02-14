import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { dropdownCloseInProgressRef } from '../utils/dropdownCloseRef';

export interface FeatureOption {
  id: string;
  label: string;
  apiName: string;
}

export interface FeatureGroup {
  category: string;
  features: FeatureOption[];
}

interface FeatureSelectProps {
  groups: FeatureGroup[];
  value: string | null;
  onChange: (apiName: string | null) => void;
  disabled?: boolean;
  placeholder?: string;
}

function getLabelForValue(groups: FeatureGroup[], apiName: string | null): string {
  if (!apiName) return '';
  for (const grp of groups) {
    const opt = grp.features.find((f) => f.apiName === apiName);
    if (opt) return opt.label;
  }
  return '';
}

const FeatureSelect: React.FC<FeatureSelectProps> = ({
  groups,
  value,
  onChange,
  disabled = false,
  placeholder = 'Select feature',
}) => {
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const focusChangedByKeyboardRef = useRef(false);

  const flatOptions = groups.flatMap((g) => g.features);
  const selectedLabel = value ? getLabelForValue(groups, value) : '';

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        focusChangedByKeyboardRef.current = true;
        setFocusedIndex((i) => Math.min(i + 1, flatOptions.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        focusChangedByKeyboardRef.current = true;
        setFocusedIndex((i) => Math.max(i - 1, -1));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (focusedIndex === -1) {
          onChange(null);
        } else if (flatOptions[focusedIndex]) {
          onChange(flatOptions[focusedIndex].apiName);
        }
        close();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, flatOptions, focusedIndex, onChange, close]);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        dropdownCloseInProgressRef.current = true;
        close();
        setTimeout(() => {
          dropdownCloseInProgressRef.current = false;
        }, 0);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open, close]);

  useEffect(() => {
    if (open && listRef.current && focusChangedByKeyboardRef.current) {
      focusChangedByKeyboardRef.current = false;
      const el = listRef.current.querySelector('[data-focused="true"]') as HTMLElement | null;
      el?.scrollIntoView({ block: 'nearest' });
    }
  }, [open, focusedIndex]);

  useEffect(() => {
    if (open) {
      const idx = value ? flatOptions.findIndex((o) => o.apiName === value) : -1;
      setFocusedIndex(idx >= 0 ? idx : -1);
    }
  }, [open, value, flatOptions]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={selectedLabel || placeholder}
        className={`
          min-w-[180px] flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm font-medium
          border transition-all duration-150
          focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-2 focus-visible:ring-offset-black
          ${disabled
            ? 'opacity-60 cursor-not-allowed border-white/10 bg-white/5 text-white/60'
            : open
              ? 'border-white/30 bg-white/10 text-white ring-1 ring-white/20'
              : 'border-white/15 bg-white/5 text-white hover:bg-white/8 hover:border-white/25'
          }
        `}
      >
        <span className={`flex-1 min-w-0 truncate text-left ${selectedLabel ? 'text-white' : 'text-white/50'}`}>
          {selectedLabel || placeholder}
        </span>
        <ChevronDown
          size={16}
          className={`shrink-0 text-white/50 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          ref={listRef}
          role="listbox"
          className="absolute top-full left-0 mt-1.5 z-50 min-w-[240px] max-h-[280px] overflow-y-auto
            rounded-xl border border-white/[0.12] bg-black/95 backdrop-blur-md shadow-elevated
            py-2 scrollbar-thin animate-slide-up origin-top"
        >
          <button
            type="button"
            role="option"
            aria-selected={!value}
            data-focused={focusedIndex === -1}
            onClick={() => {
              onChange(null);
              close();
            }}
            onMouseEnter={() => setFocusedIndex(-1)}
            className={`
              w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left text-sm
              transition-colors border-b border-white/[0.08] mb-2
              ${!value ? 'bg-white/12 text-white' : 'text-white/70 hover:bg-white/8'}
            `}
          >
            <span className="text-white/60">{placeholder}</span>
            {!value && <Check size={14} className="shrink-0 text-mito-400" strokeWidth={2.5} />}
          </button>
          {groups.map((grp) => (
            <div key={grp.category} className="mb-3 last:mb-0">
              <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/50">
                {grp.category}
              </div>
              <div className="space-y-0.5">
                {grp.features.map((opt, grpIdx) => {
                  const flatIdx =
                    groups
                      .slice(0, groups.indexOf(grp))
                      .reduce((sum, g) => sum + g.features.length, 0) + grpIdx;
                  const isSelected = opt.apiName === value;
                  const isFocused = flatIdx === focusedIndex;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      data-focused={isFocused}
                      onClick={() => {
                        onChange(opt.apiName);
                        close();
                      }}
                      onMouseEnter={() => setFocusedIndex(flatIdx)}
                      className={`
                        w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left text-sm
                        transition-colors
                        ${isSelected ? 'bg-white/12 text-white' : 'text-white/90 hover:bg-white/8'}
                        ${isFocused && !isSelected ? 'bg-white/6' : ''}
                      `}
                    >
                      <span className="font-medium">{opt.label}</span>
                      {isSelected && <Check size={14} className="shrink-0 text-mito-400" strokeWidth={2.5} />}
                    </button>
                  );
                })}
                <div className="px-3 py-2 text-xs italic text-white/40">
                  More coming soon
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default FeatureSelect;
