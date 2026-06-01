'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { clsx } from 'clsx';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import type { AIMessage } from '@/lib/command/types';
import type { UserType } from '@/lib/command/types';
import { AI_SUGGESTED_QUESTIONS } from '@/lib/command/constants';

const THINKING_STEPS = [
  'Analyzing financial profile...',
  'Calculating wealth trajectory...',
  'Evaluating financial risks...',
  'Modeling retirement scenarios...',
  'Building strategic response...',
];

type ResponseMode = 'instant' | 'quick' | 'deep';

function classifyPromptClient(message: string): ResponseMode {
  const text = message.trim().toLowerCase();

  if (
    /^(hi|hey|hello|yo|sup|what'?s up|good morning|good afternoon|good evening)[!. ]*$/.test(text) ||
    /^(thanks|thank you|ok|okay|cool|nice|perfect|awesome|great)[!. ]*$/.test(text) ||
    /^(who are you|what can you do)[?!. ]*$/.test(text)
  ) {
    return 'instant';
  }

  const deepKeywords = [
    'retire',
    'retirement',
    'fire',
    'financial independence',
    'wealth',
    'net worth',
    'projection',
    'forecast',
    'scenario',
    'business',
    'debt or invest',
    'invest or debt',
    'mortgage',
    'house',
    'afford',
    'strategy',
    'plan',
    'roadmap',
    'tax',
    'passive income',
  ];

  if (deepKeywords.some((word) => text.includes(word))) {
    return 'deep';
  }

  if (text.length <= 90) return 'quick';

  return 'deep';
}

const THINKING_COPY: Record<ResponseMode, string[]> = {
  instant: ['Opening chat...'],
  quick: ['Reading your question...', 'Checking your profile...', 'Preparing answer...'],
  deep: THINKING_STEPS,
};

function MessageBubble({
  msg,
  isLatestAssistant,
}: {
  msg: AIMessage;
  isLatestAssistant: boolean;
}) {
  const isUser = msg.role === 'user';

  return (
    <div className={clsx('flex gap-3', isUser ? 'flex-row-reverse' : 'flex-row')}>
      <div
        className={clsx(
          'mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-black',
          isUser
            ? 'bg-[rgba(198,162,74,.18)] text-[var(--bdm-gold)]'
            : 'bg-zinc-950 text-white overflow-hidden border border-[rgba(198,162,74,.24)]'
        )}
      >
        {isUser ? (
          'Y'
        ) : (
          <img
            src="/bankdemark-logo-black-background.png"
            alt="BankDeMark AI"
            className="h-[115%] w-[115%] rounded-full object-cover"
          />
        )}
      </div>

      <div
        className={clsx(
          'max-w-[94%] rounded-3xl px-5 py-4 text-sm shadow-[0_18px_50px_rgba(15,23,42,.07)] sm:max-w-[86%]',
          isUser
            ? 'rounded-tr-sm border border-[rgba(198,162,74,.22)] bg-[rgba(198,162,74,.12)] text-white'
            : 'rounded-tl-sm border border-[rgba(198,162,74,.2)] bg-white/80 text-zinc-800'
        )}
      >
        {isUser ? (
          <p className="text-sm leading-7">{msg.content}</p>
        ) : (
          <div className="ai-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
              {msg.content}
            </ReactMarkdown>
            {isLatestAssistant && <span className="ai-type-caret" />}
          </div>
        )}

        <p className="mt-3 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
          {new Date(msg.created_at).toLocaleTimeString('en-CA', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </p>
      </div>
    </div>
  );
}

export default function AICoach() {
  const supabase = createClient();

  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [thinkingStep, setThinkingStep] = useState(0);
  const [responseMode, setResponseMode] = useState<ResponseMode>('deep');
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [userType, setUserType] = useState<UserType>('individual');
  const [hasProfile, setHasProfile] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const suggestedQuestions = useMemo(
    () => AI_SUGGESTED_QUESTIONS[userType] || AI_SUGGESTED_QUESTIONS.default || [],
    [userType]
  );

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) return;

      const [{ data: profile }, { data: snapshot }] = await Promise.all([
        supabase.from('profiles').select('user_type').eq('id', user.id).single(),
        supabase.from('financial_snapshots').select('id').eq('user_id', user.id).single(),
      ]);

      if (profile?.user_type) setUserType(profile.user_type as UserType);
      setHasProfile(Boolean(snapshot));
    })();
  }, [supabase]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    if (!loading) {
      setThinkingStep(0);
      return;
    }

    const steps = THINKING_COPY[responseMode];
    let i = 0;
    setThinkingStep(0);

    const intervalMs = responseMode === 'quick' ? 550 : 1100;

    const interval = window.setInterval(() => {
      i += 1;

      if (i < steps.length) {
        setThinkingStep(i);
      }
    }, intervalMs);

    return () => window.clearInterval(interval);
  }, [loading, responseMode]);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || loading) return;

      const nextMode = classifyPromptClient(trimmed);
      setResponseMode(nextMode);

      const userMsg: AIMessage = {
        id: Date.now().toString(),
        role: 'user',
        content: trimmed,
        created_at: new Date().toISOString(),
      };

      setMessages((current) => [...current, userMsg]);
      setInput('');
      setLoading(true);
      setError(null);

      try {
        const res = await fetch('/api/command/coach', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: trimmed,
            conversationId,
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error || 'Request failed');
        }

        const contentType = res.headers.get('content-type') || '';

        if (contentType.includes('application/json')) {
          const data = await res.json();

          const assistantMsg: AIMessage = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: data.message || '',
            created_at: new Date().toISOString(),
          };

          setMessages((current) => [...current, assistantMsg]);

          if (data.conversationId) {
            setConversationId(data.conversationId);
          }

          return;
        }

        if (!res.body) {
          throw new Error('No response stream.');
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        const assistantId = (Date.now() + 1).toString();

        setMessages((current) => [
          ...current,
          {
            id: assistantId,
            role: 'assistant',
            content: '',
            created_at: new Date().toISOString(),
          },
        ]);

        let accumulated = '';
        let buffer = '';

        while (true) {
          const { value, done } = await reader.read();

          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() || '';

          for (const part of parts) {
            const line = part.trim();

            if (!line.startsWith('data: ')) continue;

            const json = line.replace(/^data:\s*/, '');
            if (!json) continue;

            const parsed = JSON.parse(json);

            if (parsed.error) {
              throw new Error(parsed.error);
            }

            if (parsed.content) {
              accumulated += parsed.content;

              setMessages((current) =>
                current.map((msg) =>
                  msg.id === assistantId
                    ? { ...msg, content: accumulated }
                    : msg
                )
              );
            }

            if (parsed.conversationId) {
              setConversationId(parsed.conversationId);
            }
          }
        }
      } catch (err: any) {
        setError(err.message || 'Something went wrong. Please try again.');
      } finally {
        setLoading(false);
        inputRef.current?.focus();
      }
    },
    [conversationId, loading]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const startNew = () => {
    setMessages([]);
    setConversationId(undefined);
    setError(null);
    inputRef.current?.focus();
  };

  return (
    <div className="flex h-[calc(100vh-9rem)] max-w-4xl flex-col px-4 lg:mx-auto lg:h-[calc(100vh-4rem)] lg:px-6">
      <div className="flex flex-shrink-0 items-center justify-between border-b border-white/6 py-4">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-black text-white">
            <span className="text-brand-green">✦</span> AI Financial Coach
          </h1>
          <p className="text-xs text-zinc-500">Educational guidance only — not financial advice</p>
        </div>

        <div className="flex items-center gap-2">
          {!hasProfile && (
            <a
              href="/command/onboarding"
              className="rounded-lg border border-yellow-400/30 bg-yellow-400/8 px-2 py-1 text-xs text-yellow-700 transition-colors hover:bg-yellow-400/15"
            >
              Complete profile
            </a>
          )}

          {messages.length > 0 && (
            <button onClick={startNew} className="cmd-btn-ghost px-3 py-1.5 text-xs">
              New Chat
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto py-4">
        {messages.length === 0 && (
          <div className="py-8 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-[rgba(198,162,74,.22)] bg-white/60 text-2xl shadow-[0_18px_50px_rgba(15,23,42,.07)]">
              ✦
            </div>

            <h2 className="mb-2 text-lg font-black text-white">BankDeMark AI Coach</h2>

            <p className="mx-auto mb-6 max-w-md text-sm leading-relaxed text-zinc-400">
              Ask about debt, investing, retirement, affordability, business cash flow, or your next best financial move.
            </p>

            <div className="mx-auto max-w-lg text-left">
              <p className="mb-3 text-xs font-black uppercase tracking-wide text-zinc-500">
                Suggested Questions
              </p>

              <div className="space-y-2">
                {suggestedQuestions.map((q) => (
                  <button
                    key={q}
                    onClick={() => sendMessage(q)}
                    className="w-full rounded-xl border border-white/7 bg-white/3 px-4 py-3 text-left text-sm text-zinc-300 transition-all hover:border-brand-green/30 hover:bg-brand-green/5 hover:text-white"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {messages.map((msg, index) => (
          <MessageBubble
            key={msg.id}
            msg={msg}
            isLatestAssistant={msg.role === 'assistant' && index === messages.length - 1 && loading}
          />
        ))}

        {loading && messages[messages.length - 1]?.role !== 'assistant' && (
          <div className="flex gap-3">
            <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-full border border-[rgba(198,162,74,.24)] bg-zinc-950 text-xs font-black text-white">
              <img
                src="/bankdemark-logo-black-background.png"
                alt="BankDeMark AI"
                className="h-[115%] w-[115%] rounded-full object-cover"
              />
            </div>

            <div className="min-w-[260px] rounded-2xl rounded-tl-sm border border-[rgba(198,162,74,.2)] bg-white/80 px-4 py-3">
              <div className="mb-3 flex items-center gap-2">
                <div className="h-2 w-2 animate-pulse rounded-full bg-[var(--bdm-gold)]" />
                <p className="text-sm font-black text-zinc-800">{responseMode === 'deep' ? 'Thinking deeply' : 'Thinking'}</p>
              </div>

              <div className="space-y-2">
                {THINKING_COPY[responseMode].map((step, index) => (
                  <div
                    key={step}
                    className={clsx(
                      'text-xs transition-all duration-500',
                      index <= thinkingStep
                        ? 'text-zinc-700 opacity-100'
                        : 'text-zinc-400 opacity-45'
                    )}
                  >
                    {index <= thinkingStep ? '✓' : '•'} {step}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="flex gap-3">
            <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-red-500/20 text-xs">
              ⚠
            </div>

            <div className="rounded-2xl rounded-tl-sm border border-red-500/20 bg-red-500/8 px-4 py-3 text-sm text-red-400">
              {error}
              {error.includes('configured') && (
                <p className="mt-1 text-xs text-red-500">
                  See BANKDEMARK_COMMAND_SETUP.md to configure your AI API key.
                </p>
              )}
              {error.includes('free AI messages') && (
                <a
                  href="/command/marketplace"
                  className="mt-2 inline-block rounded-lg bg-yellow-400/20 px-3 py-1.5 text-xs font-semibold text-yellow-300 hover:bg-yellow-400/30 transition-colors"
                >
                  ✦ Upgrade to Pro — Unlimited AI →
                </a>
              )}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {messages.length > 0 && messages.length < 6 && (
        <div className="flex-shrink-0 pb-2">
          <div className="scrollbar-none flex gap-2 overflow-x-auto pb-1">
            {suggestedQuestions.slice(0, 3).map((q) => (
              <button
                key={q}
                onClick={() => sendMessage(q)}
                disabled={loading}
                className="flex-shrink-0 rounded-full border border-white/8 bg-white/4 px-3 py-2 text-xs text-zinc-400 transition-all hover:border-brand-green/30 hover:text-zinc-200 disabled:opacity-40"
              >
                {q.length > 50 ? `${q.slice(0, 50)}…` : q}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex-shrink-0 border-t border-white/6 pb-4 pt-4">
        <form onSubmit={handleSubmit} className="flex items-end gap-3">
          <textarea
            ref={inputRef}
            className="cmd-input max-h-32 min-h-[44px] flex-1 resize-none py-3 text-white placeholder:text-zinc-500"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your finances…"
            rows={1}
            disabled={loading}
          />

          <button
            type="submit"
            className={clsx(
              'cmd-btn-primary flex-shrink-0 px-5 py-3 transition-all',
              (!input.trim() || loading) && 'cursor-not-allowed opacity-50'
            )}
            disabled={!input.trim() || loading}
          >
            {loading ? '…' : '→'}
          </button>
        </form>

        <p className="ai-coach-footer-note mt-2 text-center text-xs">
          BankDeMark AI provides educational guidance only. Not financial advice.
        </p>
      </div>
    </div>
  );
}
