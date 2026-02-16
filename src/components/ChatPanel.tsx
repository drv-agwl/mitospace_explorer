import React, { useState, useRef, useEffect } from 'react';
import { MessageCircle, X, Send, Loader2, ChevronDown, Sparkles, Move } from 'lucide-react';
import { sendChatMessage } from '../api/client';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  data?: any;
}

const ChatPanel: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 }); // Offset from default position
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [showIntro, setShowIntro] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const buttonRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Show intro animation for first 3 seconds, then wiggle at 3s
  useEffect(() => {
    const introTimer = setTimeout(() => setShowIntro(false), 3000);
    
    // Wiggle at 3 seconds to catch attention
    const wiggleTimer = setTimeout(() => {
      if (buttonRef.current && !isOpen) {
        buttonRef.current.classList.add('animate-wiggle');
        setTimeout(() => {
          buttonRef.current?.classList.remove('animate-wiggle');
        }, 500);
      }
    }, 3000);
    
    return () => {
      clearTimeout(introTimer);
      clearTimeout(wiggleTimer);
    };
  }, [isOpen]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (isOpen) return; // Don't drag when chat is open
    setIsDragging(true);
    setDragStart({
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    });
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging) return;
    const newX = e.clientX - dragStart.x;
    const newY = e.clientY - dragStart.y;
    setPosition({ x: newX, y: newY });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, dragStart]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: Date.now()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const response = await sendChatMessage(userMessage.content);
      
      const assistantMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response.answer,
        timestamp: Date.now(),
        data: response.data
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      const errorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `Sorry, I encountered an error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: Date.now()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClear = () => {
    setMessages([]);
  };

  if (!isOpen) {
    return (
      <div
        ref={buttonRef}
        className={`fixed z-50 group ${showIntro ? 'animate-pop-in' : ''}`}
        style={{
          bottom: `${32 - position.y}px`,
          right: `${32 - position.x}px`,
          cursor: isDragging ? 'grabbing' : 'grab',
        }}
        onMouseDown={handleMouseDown}
      >
        {/* Attention-grabbing pulse rings - only for first 3 seconds */}
        {showIntro && (
          <>
            <div className="absolute inset-0 rounded-2xl bg-cyan-400/40 animate-ping" style={{ animationDuration: '2s' }}></div>
            <div className="absolute inset-0 rounded-2xl bg-blue-400/30 animate-ping" style={{ animationDuration: '2s', animationDelay: '0.5s' }}></div>
          </>
        )}
        
        {/* Floating button with gradient theme */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setIsOpen(true);
          }}
          className="relative bg-gradient-to-br from-cyan-500/90 to-blue-600/90 hover:from-cyan-400 hover:to-blue-500 border-2 border-cyan-300/50 hover:border-cyan-200/80 text-white p-4 rounded-2xl shadow-2xl transition-all duration-300 hover:scale-105 flex items-center justify-center backdrop-blur-md"
          aria-label="Ask MitoSpace"
          style={{ 
            cursor: 'pointer',
            boxShadow: '0 0 30px rgba(6, 182, 212, 0.4), 0 20px 60px -15px rgba(0, 0, 0, 0.8)'
          }}
        >
          <MessageCircle size={24} strokeWidth={2} className="text-white drop-shadow-lg" />
          
          {/* Beta badge with gradient */}
          <div className="absolute -top-2 -right-2 px-2 py-0.5 bg-gradient-to-r from-yellow-400 to-orange-500 text-white text-[10px] font-bold uppercase tracking-wider rounded-md shadow-lg animate-pulse">
            Beta
          </div>
          
          {/* Drag indicator - shows on hover */}
          <div className="absolute -top-2 -left-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <div className="bg-white/30 backdrop-blur-sm p-1 rounded border border-white/50">
              <Move size={12} className="text-white" strokeWidth={2} />
            </div>
          </div>
          
          {/* Tooltip on hover */}
          <div className="absolute bottom-full right-0 mb-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
            <div className="bg-black/95 backdrop-blur-sm text-white text-sm font-medium px-4 py-2 rounded-lg shadow-xl border border-cyan-500/30 whitespace-nowrap">
              Ask MitoSpace • Drag to move
              <div className="absolute top-full right-6 w-0 h-0 border-l-8 border-r-8 border-t-8 border-transparent border-t-black/95"></div>
            </div>
          </div>
        </button>
      </div>
    );
  }

  return (
    <div
      className="fixed w-[440px] h-[620px] bg-black/95 border border-white/[0.08] rounded-2xl shadow-2xl flex flex-col overflow-hidden z-50 animate-slide-up backdrop-blur-md"
      style={{
        bottom: `${32 - position.y}px`,
        right: `${32 - position.x}px`,
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.08] bg-black/50 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-white/10 rounded-lg flex items-center justify-center">
            <MessageCircle size={18} className="text-white" strokeWidth={2} />
          </div>
          <div className="flex items-center gap-2">
            <div>
              <h3 className="text-white font-semibold text-sm">MitoSpace Chat</h3>
              <p className="text-white/45 text-xs">Ask MitoSpace</p>
            </div>
            <span className="px-2 py-0.5 bg-white/10 text-white/60 text-[10px] font-semibold uppercase tracking-wider rounded border border-white/20">
              Beta
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {messages.length > 0 && (
            <button
              onClick={handleClear}
              className="text-white/45 hover:text-white/80 text-xs px-2 py-1 rounded hover:bg-white/10 transition-all"
              title="Clear chat"
            >
              Clear
            </button>
          )}
          <button
            onClick={() => setIsOpen(false)}
            className="text-white/45 hover:text-white p-1.5 rounded hover:bg-white/10 transition-all"
            aria-label="Close chat"
          >
            <X size={18} strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center px-4">
            <div className="w-16 h-16 bg-white/[0.06] rounded-xl flex items-center justify-center mb-4 border border-white/[0.08] animate-pulse">
              <MessageCircle size={32} className="text-white/70" strokeWidth={2} />
            </div>
            <h4 className="text-white font-semibold text-base mb-2">Ask MitoSpace</h4>
            <p className="text-white/45 text-sm leading-relaxed mb-6 max-w-xs">
              Get insights from the mitochondrial dataset
            </p>
            <div className="w-full space-y-2">
              <button
                onClick={() => setInput('Which drugs increase motility the most?')}
                className="w-full text-left bg-white/[0.03] rounded-lg p-3 border border-white/[0.08] hover:border-white/20 hover:bg-white/[0.06] transition-all cursor-pointer group hover:scale-[1.02]"
              >
                <p className="text-white/70 text-sm group-hover:text-white/90 transition-colors">Which drugs increase motility?</p>
              </button>
              <button
                onClick={() => setInput('Is motility correlated with segment length?')}
                className="w-full text-left bg-white/[0.03] rounded-lg p-3 border border-white/[0.08] hover:border-white/20 hover:bg-white/[0.06] transition-all cursor-pointer group hover:scale-[1.02]"
              >
                <p className="text-white/70 text-sm group-hover:text-white/90 transition-colors">Is motility correlated with segment length?</p>
              </button>
              <button
                onClick={() => setInput('Compare Rotenone and CCCP effects on membrane potential')}
                className="w-full text-left bg-white/[0.03] rounded-lg p-3 border border-white/[0.08] hover:border-white/20 hover:bg-white/[0.06] transition-all cursor-pointer group hover:scale-[1.02]"
              >
                <p className="text-white/70 text-sm group-hover:text-white/90 transition-colors">Compare Rotenone & CCCP on membrane potential</p>
              </button>
            </div>
          </div>
        )}

        {messages.map((msg, idx) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in`}
            style={{ animationDelay: `${idx * 50}ms` }}
          >
            <div
              className={`max-w-[85%] rounded-xl px-3 py-2.5 shadow-sm ${
                msg.role === 'user'
                  ? 'bg-white text-black'
                  : 'bg-white/[0.06] text-white/90 border border-white/[0.08]'
              }`}
            >
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
              {msg.role === 'assistant' && msg.data && (
                <button
                  className="text-xs text-white/40 hover:text-white/60 mt-2 transition-colors flex items-center gap-1"
                  onClick={() => console.log('Data:', msg.data)}
                  title="View raw data"
                >
                  <span>View data</span>
                  <ChevronDown size={12} />
                </button>
              )}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start animate-fade-in">
            <div className="bg-white/[0.06] border border-white/[0.08] rounded-xl px-4 py-3 flex items-center gap-3">
              <div className="flex gap-1.5">
                <div className="w-2 h-2 bg-white/60 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                <div className="w-2 h-2 bg-white/60 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                <div className="w-2 h-2 bg-white/60 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
              </div>
              <span className="text-white/50 text-sm">Analyzing data...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-white/[0.08] bg-black/50">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Ask a question..."
            disabled={isLoading}
            className="flex-1 bg-white/[0.06] border border-white/[0.08] rounded-lg px-3 py-2 text-white text-sm placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-white/20 resize-none scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent disabled:opacity-50 transition-all"
            rows={1}
            style={{ maxHeight: '100px' }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = 'auto';
              target.style.height = Math.min(target.scrollHeight, 100) + 'px';
            }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className="bg-white hover:bg-gray-100 disabled:bg-white/10 disabled:cursor-not-allowed text-black disabled:text-white/50 p-2.5 rounded-lg transition-all shrink-0 group"
            aria-label="Send message"
          >
            <Send size={18} strokeWidth={2} className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform group-disabled:translate-x-0 group-disabled:translate-y-0" />
          </button>
        </div>
        <p className="text-xs text-white/30 mt-2">
          Press Enter to send, Shift+Enter for new line
        </p>
      </div>
    </div>
  );
};

export default ChatPanel;
