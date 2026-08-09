// ============================================================
// ZYLX CHAT
//
// Tool-calling loop: the model asks for numbers, the backend computes
// them deterministically, the model explains the result.
//
// Rate limiting here is enforced against the entitlements table and is
// verified by a live read-back — the previous implementation queried
// columns that did not exist, so the free-tier cap never applied and
// AI spend was uncapped.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { requireBusiness } from '@/lib/services/context';
import { ServiceError, logError, logEvent, toServiceError, unwrapMaybe } from '@/lib/services/errors';
import { checkQuota, isEnabled, planFor } from '@/lib/services/entitlements';
import { executeTool, toolsForContext, TOOL_DEFINITIONS } from '@/lib/zylx/tools';
import { buildSystemPrompt } from '@/lib/zylx/prompt';
import { recordAudit } from '@/lib/services/audit';
import { buildBlocks, sanitizeBlocks } from '@/lib/zylx/envelope';
import {
  moneySafeForModel,
  requiresWorkspaceFinancialTool,
  routeWorkspaceFinancialTool,
  verifiedFinancialAnswer,
} from '@/lib/zylx/financial-truth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_MESSAGE_CHARS = 4000;
const MAX_TOOL_ROUNDS = 5;
const PROVIDER_TIMEOUT_MS = 45_000;
const MAX_PROVIDER_ATTEMPTS = 2;

/**
 * Retry only the FIRST connection attempt, and only for transient
 * failures. Reads are safe to repeat; writes never pass through here —
 * they go to /api/zylx/approve, which is idempotent separately.
 */
async function withRetry<T>(fn: () => Promise<T>, requestId: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_PROVIDER_ATTEMPTS; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const status = (error as { status?: number })?.status;
      const transient = status === undefined || status === 429 || (status >= 500 && status < 600);
      if (!transient || attempt === MAX_PROVIDER_ATTEMPTS) break;
      logEvent('zylx.provider_retry', { requestId, attempt, status });
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }
  throw lastError;
}

/**
 * User-facing status per tool. Curated, never derived from arguments —
 * a merchant name or amount must not leak into a status line.
 */
const TOOL_STATUS: Record<string, string> = {
  get_business_summary: 'Checking your numbers',
  get_revenue: 'Adding up money in',
  get_expenses: 'Adding up money out',
  get_profit: 'Working out profit',
  get_profit_and_loss: 'Building your P&L',
  get_cash_position: 'Checking your accounts',
  compare_periods: 'Comparing periods',
  get_outstanding_commissions: 'Checking unpaid commissions',
  get_bookings: 'Searching bookings',
  get_commission_pipeline: 'Building the commission pipeline',
  get_commission_report: 'Opening the commission report',
  get_commission_anomalies: 'Checking report anomalies',
  get_commission_chart_data: 'Building commission chart data',
  propose_booking: 'Preparing booking entries',
  get_brand_performance: 'Splitting by brand',
  get_project_profitability: 'Checking project profit',
  get_tax_reserve_estimate: 'Estimating a tax set-aside',
  find_uncategorized: 'Looking for uncategorised items',
  find_missing_receipts: 'Looking for missing receipts',
  search_transactions: 'Searching your transactions',
  get_portfolio_summary: 'Comparing your businesses',
  get_invoices: 'Checking invoices',
  get_invoice: 'Opening that invoice',
  get_outstanding_invoices: 'Checking unpaid invoices',
  get_overdue_invoices: 'Checking overdue invoices',
  get_receivables_position: "Checking what you're owed",
  propose_transaction: 'Preparing that entry',
  propose_invoice_draft: 'Preparing an invoice draft',
  propose_categorize_transactions: 'Preparing those changes',
};

function statusFor(tool: string): string {
  return TOOL_STATUS[tool] ?? 'Working';
}

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();

  try {
    const body = (await req.json()) as {
      businessId?: string;
      message?: string;
      conversationId?: string;
    };

    if (!body.businessId) {
      throw new ServiceError('validation', 'Choose a business first.');
    }
    const message = (body.message ?? '').trim();
    if (!message) throw new ServiceError('validation', 'Type a message.');
    if (message.length > MAX_MESSAGE_CHARS) {
      throw new ServiceError('validation', `Keep messages under ${MAX_MESSAGE_CHARS} characters.`);
    }

    const ctx = await requireBusiness(body.businessId, 'viewer');
    const financialQuestion = requiresWorkspaceFinancialTool(message);
    const financialRoute = routeWorkspaceFinancialTool(message, ctx.business.base_currency);

    // ── Plan + quota ─────────────────────────────────────────
    const profile = unwrapMaybe(
      await ctx.db.from('profiles').select('plan').eq('id', ctx.userId).single(),
      'read your plan'
    ) as { plan: string | null } | null;
    const plan = profile?.plan ?? 'free';

    const monthStart = new Date();
    monthStart.setUTCDate(1);
    const monthStartIso = monthStart.toISOString().slice(0, 10);

    const { count: usedCount, error: usageError } = await ctx.db
      .from('ai_messages')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', ctx.userId)
      .eq('role', 'user')
      .gte('created_at', `${monthStartIso}T00:00:00Z`);

    if (usageError) {
      // Fail closed on a metering failure rather than granting free usage.
      logError('zylx.usage_check_failed', usageError, { requestId, userId: ctx.userId });
      throw new ServiceError('internal', 'Could not check your usage. Please try again.');
    }

    const quota = checkQuota(plan, 'ai_messages_per_month', usedCount ?? 0);
    if (!quota.allowed) {
      return NextResponse.json(
        {
          error: `${quota.reason} Your ${planFor(plan).name} plan includes ${quota.limit} per month.`,
          code: 'rate_limited',
          limitReached: true,
        },
        { status: 429 }
      );
    }

    if (!process.env.AI_API_KEY) {
      throw new ServiceError(
        'not_configured',
        'No AI provider is connected. Add a key under Connections to use Zylx.'
      );
    }

    // ── Conversation ─────────────────────────────────────────
    //
    // A conversation belongs to a user AND a business. Both must match
    // or we start a fresh thread. Without the business check, a thread
    // begun under one business replays its figures — real amounts, in
    // prior assistant turns — into another business's prompt.
    //
    // Legacy rows (business_id IS NULL) predate scoping and are never
    // adopted into a business thread.
    let conversationId = body.conversationId ?? null;
    if (conversationId) {
      const existing = unwrapMaybe(
        await ctx.db
          .from('ai_conversations')
          .select('id, business_id')
          .eq('id', conversationId)
          .eq('user_id', ctx.userId)
          .eq('business_id', ctx.businessId)
          .single(),
        'load that conversation'
      ) as { id: string; business_id: string | null } | null;

      if (!existing) {
        logEvent('zylx.conversation_rejected', {
          requestId,
          businessId: ctx.businessId,
          userId: ctx.userId,
          reason: 'not owned by this user and business',
        });
        conversationId = null;
      }
    }
    if (!conversationId) {
      const created = unwrapMaybe(
        await ctx.db
          .from('ai_conversations')
          .insert({
            user_id: ctx.userId,
            business_id: ctx.businessId,
            title: message.slice(0, 80),
          })
          .select('id')
          .single(),
        'start a conversation'
      ) as { id: string } | null;
      conversationId = created?.id ?? null;
    }

    const { data: history } = await ctx.db
      .from('ai_messages')
      .select('role, content')
      .eq('conversation_id', conversationId!)
      .eq('user_id', ctx.userId)
      .order('created_at', { ascending: false })
      .limit(16);

    const priorMessages = (history ?? [])
      .reverse()
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    // Persist the user turn. A failure here is surfaced, not swallowed.
    const { error: insertError } = await ctx.db.from('ai_messages').insert({
      conversation_id: conversationId!,
      user_id: ctx.userId,
      role: 'user',
      content: message,
    });
    if (insertError) {
      logError('zylx.persist_user_message_failed', insertError, { requestId, businessId: ctx.businessId });
    }

    // ── Context counts for the system prompt ────────────────
    const [{ count: accountCount }, { count: transactionCount }, { count: bookingCount }] =
      await Promise.all([
        ctx.db.from('accounts').select('id', { count: 'exact', head: true }).eq('business_id', ctx.businessId).eq('is_active', true),
        ctx.db.from('transactions').select('id', { count: 'exact', head: true }).eq('business_id', ctx.businessId).is('deleted_at', null),
        ctx.db.from('bookings').select('id', { count: 'exact', head: true }).eq('business_id', ctx.businessId),
      ]);

    const systemPrompt = buildSystemPrompt({
      business: ctx.business,
      role: ctx.role,
      accountCount: accountCount ?? 0,
      transactionCount: transactionCount ?? 0,
      hasBookings: (bookingCount ?? 0) > 0,
      // The RUNTIME registry is authoritative, not the plan flag. A plan
      // may grant `web_search` before any search tool exists; claiming the
      // capability without one is how a model ends up inventing a CRA
      // citation. Entitlement AND implementation must both be true.
      webSearchEnabled:
        isEnabled(plan, 'web_search') &&
        TOOL_DEFINITIONS.some((t) => t.capability === 'web_search'),
      writesEnabled: isEnabled(plan, 'ai_writes') && ctx.role !== 'viewer',
      today: new Date().toISOString().slice(0, 10),
    });

    const tools = toolsForContext(plan).map((t) => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description, parameters: t.parameters as never },
    }));

    const openai = new OpenAI({
      apiKey: process.env.AI_API_KEY,
      baseURL: process.env.AI_BASE_URL || 'https://api.openai.com/v1',
    });
    const model = process.env.AI_MODEL || 'gpt-4o-mini';

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...priorMessages,
      { role: 'user', content: message },
    ];

    // ══════════════════════════════════════════════════════════
    // STREAMING TOOL LOOP
    //
    // Server-Sent Events. Four event kinds, all safe to show a user:
    //   status  what Zylx is doing, from a curated label per tool
    //   text    answer text as it arrives
    //   blocks  typed render blocks, built SERVER-SIDE from tool results
    //   done    conversation id and usage
    //
    // Never streamed: prompts, tool arguments, raw tool payloads, or
    // anything resembling chain-of-thought.
    // ══════════════════════════════════════════════════════════

    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: string, data: unknown) => {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        };

        const toolResults: Array<Record<string, unknown>> = [];
        const toolsUsed: string[] = [];
        let verifiedFinancialResult: Record<string, unknown> | null = null;
        let answer = '';

        try {
          if (financialQuestion && !financialRoute) {
            answer = 'I couldn’t retrieve your current BankDeMark records for that question.';
            send('text', { delta: answer });
            send('done', {
              conversationId,
              toolsUsed,
              usage: { used: (usedCount ?? 0) + 1, limit: quota.limit },
            });
            return;
          }

          for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
            const toolChoice = financialRoute
              ? round === 0
                ? { type: 'function' as const, function: { name: financialRoute.tool } }
                : 'none' as const
              : 'auto' as const;
            const completion = await withRetry(
              () =>
                openai.chat.completions.create(
                  {
                    model,
                    messages,
                    tools,
                    tool_choice: toolChoice,
                    temperature: 0.3,
                    max_tokens: 1200,
                    stream: true,
                  },
                  { timeout: PROVIDER_TIMEOUT_MS }
                ),
              requestId
            );

            let content = '';
            const calls = new Map<
              number,
              { id: string; name: string; args: string }
            >();

            for await (const chunk of completion) {
              const delta = chunk.choices[0]?.delta;
              if (!delta) continue;

              if (delta.content) {
                content += delta.content;
                if (!financialQuestion) send('text', { delta: delta.content });
              }

              for (const tc of delta.tool_calls ?? []) {
                const slot = calls.get(tc.index) ?? { id: '', name: '', args: '' };
                if (tc.id) slot.id = tc.id;
                if (tc.function?.name) slot.name += tc.function.name;
                if (tc.function?.arguments) slot.args += tc.function.arguments;
                calls.set(tc.index, slot);
              }
            }

            // No tools requested — this round is the final answer.
            if (calls.size === 0) {
              answer = financialQuestion
                ? verifiedFinancialAnswer(content, verifiedFinancialResult)
                : content;
              if (financialQuestion) send('text', { delta: answer });
              break;
            }

            messages.push({
              role: 'assistant',
              content: content || null,
              tool_calls: [...calls.values()].map((c) => ({
                id: c.id,
                type: 'function' as const,
                function: { name: c.name, arguments: c.args },
              })),
            });

            for (const call of calls.values()) {
              // Curated label only. The tool NAME is safe; its arguments
              // are not, so they never reach the client.
              send('status', { label: statusFor(call.name), tool: call.name });

              let args: Record<string, unknown> = {};
              try {
                args = JSON.parse(call.args || '{}') as Record<string, unknown>;
              } catch {
                args = {};
              }
              if (financialRoute && call.name === financialRoute.tool) {
                args = { ...args, ...financialRoute.enforcedArgs };
              }

              const result = await executeTool(ctx, call.name, args);
              toolsUsed.push(call.name);
              toolResults.push(result as unknown as Record<string, unknown>);
              const modelSafeResult = moneySafeForModel(
                result,
                ctx.business.base_currency
              ) as Record<string, unknown>;
              if (financialQuestion) verifiedFinancialResult = modelSafeResult;

              messages.push({
                role: 'tool',
                tool_call_id: call.id,
                content: JSON.stringify(modelSafeResult).slice(0, 12_000),
              });
            }
          }

          if (!answer) {
            answer = financialQuestion
              ? verifiedFinancialAnswer('', verifiedFinancialResult)
              : 'I looked that up but could not put together an answer. Try a narrower question, or open the relevant page directly.';
            send('text', { delta: answer });
          }

          // Blocks are built from tool results on the server. The model
          // never emits a block, so it cannot name a component or invent
          // a figure inside one.
          const blocks = sanitizeBlocks(buildBlocks(toolResults as never));
          if (blocks.length > 0) send('blocks', { blocks });

          const { error: assistantInsertError } = await ctx.db.from('ai_messages').insert({
            conversation_id: conversationId!,
            user_id: ctx.userId,
            role: 'assistant',
            content: answer,
          });
          if (assistantInsertError) {
            logError('zylx.persist_assistant_message_failed', assistantInsertError, { requestId });
          }

          const proposalBlock = blocks.find((b) => b.type === 'proposal');
          if (proposalBlock) {
            await recordAudit(ctx.db, {
              businessId: ctx.businessId,
              actorUserId: ctx.userId,
              actorType: 'zylx',
              entity: 'proposal',
              action: 'propose',
              after: proposalBlock,
              source: 'zylx',
              requestId,
            });
          }

          logEvent('zylx.answer', {
            requestId,
            businessId: ctx.businessId,
            userId: ctx.userId,
            model,
            tools: toolsUsed.join(','),
            blockCount: blocks.length,
          });

          send('done', {
            conversationId,
            toolsUsed,
            usage: { used: (usedCount ?? 0) + 1, limit: quota.limit },
          });
        } catch (streamError) {
          // A read failed. Nothing was written, so no state is corrupt —
          // the user just needs to know and retry.
          logError('zylx.stream_failed', streamError, { requestId, businessId: ctx.businessId });
          send('error', {
            error:
              streamError instanceof ServiceError
                ? streamError.message
                : 'Zylx lost its connection partway through. Nothing was changed — try again.',
          });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });

  } catch (error) {
    const serviceError = toServiceError(error, 'answer that question');
    logError('zylx.chat_failed', serviceError, { requestId, route: '/api/zylx/chat' });
    return NextResponse.json(serviceError.toJSON(), { status: serviceError.status });
  }
}
