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
import { executeTool, toolsForContext } from '@/lib/zylx/tools';
import { buildSystemPrompt } from '@/lib/zylx/prompt';
import { recordAudit } from '@/lib/services/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_MESSAGE_CHARS = 4000;
const MAX_TOOL_ROUNDS = 5;

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
    let conversationId = body.conversationId ?? null;
    if (conversationId) {
      const existing = unwrapMaybe(
        await ctx.db
          .from('ai_conversations')
          .select('id')
          .eq('id', conversationId)
          .eq('user_id', ctx.userId)
          .single(),
        'load that conversation'
      );
      if (!existing) conversationId = null;
    }
    if (!conversationId) {
      const created = unwrapMaybe(
        await ctx.db
          .from('ai_conversations')
          .insert({ user_id: ctx.userId, title: message.slice(0, 80) })
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
      webSearchEnabled: isEnabled(plan, 'web_search'),
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

    // ── Tool loop ────────────────────────────────────────────
    const toolCallsMade: Array<{ name: string; ok: boolean }> = [];
    let proposal: unknown = null;
    let answer = '';

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const completion = await openai.chat.completions.create({
        model,
        messages,
        tools,
        tool_choice: 'auto',
        temperature: 0.3,
        max_tokens: 1200,
      });

      const choice = completion.choices[0];
      const assistantMessage = choice.message;

      if (!assistantMessage.tool_calls?.length) {
        answer = assistantMessage.content ?? '';
        break;
      }

      messages.push(assistantMessage);

      for (const call of assistantMessage.tool_calls) {
        if (call.type !== 'function') continue;

        let args: unknown = {};
        try {
          args = JSON.parse(call.function.arguments || '{}');
        } catch {
          args = {};
        }

        const result = await executeTool(ctx, call.function.name, args);
        toolCallsMade.push({ name: call.function.name, ok: result.ok });

        if (result.proposal) proposal = result.proposal;

        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result).slice(0, 12_000),
        });
      }
    }

    if (!answer) {
      answer =
        'I looked that up but could not put together an answer. Try asking a narrower question, or open the relevant page directly.';
    }

    const { error: assistantInsertError } = await ctx.db.from('ai_messages').insert({
      conversation_id: conversationId!,
      user_id: ctx.userId,
      role: 'assistant',
      content: answer,
    });
    if (assistantInsertError) {
      logError('zylx.persist_assistant_message_failed', assistantInsertError, { requestId });
    }

    if (proposal) {
      await recordAudit(ctx.db, {
        businessId: ctx.businessId,
        actorUserId: ctx.userId,
        actorType: 'zylx',
        entity: 'proposal',
        action: 'propose',
        after: proposal,
        source: 'zylx',
        requestId,
      });
    }

    logEvent('zylx.answer', {
      requestId,
      businessId: ctx.businessId,
      userId: ctx.userId,
      model,
      tools: toolCallsMade.map((t) => t.name).join(','),
      hasProposal: Boolean(proposal),
    });

    return NextResponse.json({
      message: answer,
      conversationId,
      toolCalls: toolCallsMade,
      proposal,
      usage: { used: (usedCount ?? 0) + 1, limit: quota.limit },
    });
  } catch (error) {
    const serviceError = toServiceError(error, 'answer that question');
    logError('zylx.chat_failed', serviceError, { requestId, route: '/api/zylx/chat' });
    return NextResponse.json(serviceError.toJSON(), { status: serviceError.status });
  }
}
