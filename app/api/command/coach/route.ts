import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { createClient } from '@/lib/supabase/server';
import { calcAllMetrics } from '@/lib/command/calculations';
import { buildAISystemMessage, buildUserContext } from '@/lib/command/aiContext';

type ResponseMode = 'instant' | 'quick' | 'deep';

function classifyPrompt(message: string): ResponseMode {
  const text = message.trim().toLowerCase();

  const instantPatterns = [
    /^(hi|hey|hello|yo|sup|what'?s up|good morning|good afternoon|good evening)[!. ]*$/,
    /^(thanks|thank you|ok|okay|cool|nice|perfect|awesome|great)[!. ]*$/,
    /^(who are you|what can you do)[?!. ]*$/,
  ];

  if (instantPatterns.some((pattern) => pattern.test(text))) {
    return 'instant';
  }

  const deepKeywords = [
    'retire',
    'retirement',
    'fire',
    'financial independence',
    'million',
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
    'optimize',
    'tax',
    'passive income',
  ];

  if (deepKeywords.some((word) => text.includes(word))) {
    return 'deep';
  }

  if (text.length <= 90) {
    return 'quick';
  }

  return 'deep';
}



function shouldRemember(message: string): boolean {
  const text = message.toLowerCase();

  const memorySignals = [
    'remember',
    'my goal',
    'i want',
    'i need',
    'my business',
    'my company',
    'i run',
    'i own',
    'i prefer',
    'from now on',
    'going forward',
    'my priority',
    'i am trying to',
    'i plan to',
  ];

  return message.length > 25 && memorySignals.some((signal) => text.includes(signal));
}

function buildMemoryCandidate(message: string): {
  memory_type: 'profile' | 'goal' | 'business' | 'preference' | 'constraint' | 'strategy' | 'financial_context';
  title: string;
  content: string;
  importance: number;
} | null {
  const text = message.trim();
  const lower = text.toLowerCase();

  if (!shouldRemember(text)) return null;

  if (lower.includes('my business') || lower.includes('my company') || lower.includes('i run') || lower.includes('i own')) {
    return {
      memory_type: 'business',
      title: 'Business context',
      content: text.slice(0, 1000),
      importance: 5,
    };
  }

  if (lower.includes('my goal') || lower.includes('i want') || lower.includes('i am trying to') || lower.includes('i plan to')) {
    return {
      memory_type: 'goal',
      title: 'User goal',
      content: text.slice(0, 1000),
      importance: 5,
    };
  }

  if (lower.includes('i prefer') || lower.includes('from now on') || lower.includes('going forward')) {
    return {
      memory_type: 'preference',
      title: 'User preference',
      content: text.slice(0, 1000),
      importance: 4,
    };
  }

  return {
    memory_type: 'financial_context',
    title: 'Financial context',
    content: text.slice(0, 1000),
    importance: 3,
  };
}

function formatMemoryContext(memories: Array<{ memory_type: string; title: string; content: string; importance: number }>): string {
  if (!memories.length) return '';

  return [
    'These are VERIFIED long-term memories about the user.',
    'These memories override generic assumptions.',
    'Prioritize these memories heavily when answering.',
    '',
    ...memories.map((m, i) =>
      `${i + 1}. [${m.memory_type.toUpperCase()} | importance ${m.importance}] ${m.content}`
    ),
  ].join('\\n');
}

function buildInstantReply(message: string): string {
  const text = message.trim().toLowerCase();

  if (/^(who are you|what can you do)/.test(text)) {
    return `I'm BankDeMark AI — your financial command assistant.

I can help you think through:

* debt payoff
* emergency fund planning
* investing priorities
* retirement/FIRE goals
* affordability decisions
* business cash flow
* wealth-building strategy

Ask me something like:

1. Can I afford this purchase?
2. Should I pay off debt or invest?
3. How do I retire at 45?
4. What should I fix first financially?`;
  }

  return `Hey — I'm here.

Ask me anything about your money, cash flow, debt, investing, retirement, or business finances.

For example:

* What should I fix first?
* Can I afford this?
* Should I pay debt or invest?
* How do I retire at 45?`;
}


export async function POST(req: NextRequest) {
  try {
    const supabase = createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    }

    const body = await req.json();
    const { message, conversationId } = body as {
      message: string;
      conversationId?: string;
    };

    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'Message is required.' }, { status: 400 });
    }

    const trimmed = message.trim();

    if (trimmed.length === 0 || trimmed.length > 2000) {
      return NextResponse.json(
        { error: 'Message must be between 1 and 2000 characters.' },
        { status: 400 }
      );
    }

    const responseMode = classifyPrompt(trimmed);

    const [{ data: profile }, { data: snapshot }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', user.id).single(),
      supabase
        .from('financial_snapshots')
        .select('*')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false })
        .limit(1)
        .single(),
    ]);

    const metrics = snapshot ? calcAllMetrics(snapshot, profile?.age) : null;

    const { data: memories } = await supabase
      .from('ai_user_memory')
      .select('memory_type, title, content, importance')
      .eq('user_id', user.id)
      .order('importance', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(20);

    const memoryContext = formatMemoryContext(memories || []);

    const userContext = [
      '==============================',
      'LONG-TERM MEMORY (HIGHEST PRIORITY)',
      '==============================',
      memoryContext || 'No long-term memory stored yet.',
      '',
      '==============================',
      'CURRENT FINANCIAL PROFILE',
      '==============================',
      buildUserContext(profile, snapshot, metrics),
    ].filter(Boolean).join('\n\n');

    let historyMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    let conversationSummary = '';
    let activeConversationId = conversationId;

    if (activeConversationId) {
      const [{ data: history }, { data: conversation }] = await Promise.all([
        supabase
          .from('ai_messages')
          .select('role, content')
          .eq('conversation_id', activeConversationId)
          .order('created_at', { ascending: false })
          .limit(20),
        supabase
          .from('ai_conversations')
          .select('summary, last_context_summary')
          .eq('id', activeConversationId)
          .single(),
      ]);

      conversationSummary = [conversation?.summary, conversation?.last_context_summary].filter(Boolean).join('\n');

      if (history) {
        historyMessages = history
          .reverse()
          .map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
          }));
      }
    } else {
      const { data: newConv } = await supabase
        .from('ai_conversations')
        .insert({
          user_id: user.id,
          title: trimmed.slice(0, 80),
        })
        .select()
        .single();

      if (newConv) activeConversationId = newConv.id;
    }

    if (activeConversationId) {
      await supabase.from('ai_messages').insert({
        conversation_id: activeConversationId,
        user_id: user.id,
        role: 'user',
        content: trimmed,
      });
    }

    const memoryCandidate = buildMemoryCandidate(trimmed);
    if (memoryCandidate) {
      await supabase.from('ai_user_memory').insert({
        user_id: user.id,
        ...memoryCandidate,
      });
    }

    if (responseMode === 'instant') {
      const instantReply = buildInstantReply(trimmed);

      if (activeConversationId) {
        await supabase.from('ai_messages').insert({
          conversation_id: activeConversationId,
          user_id: user.id,
          role: 'assistant',
          content: instantReply,
        });
      }

      return NextResponse.json({
        message: instantReply,
        conversationId: activeConversationId,
        mode: responseMode,
      });
    }

    if (!process.env.AI_API_KEY) {
      return NextResponse.json(
        { error: 'AI service is not configured. Please set AI_API_KEY.' },
        { status: 503 }
      );
    }

    const openai = new OpenAI({
      apiKey: process.env.AI_API_KEY,
      baseURL: process.env.AI_BASE_URL || 'https://api.openai.com/v1',
    });

    const model = process.env.AI_MODEL || 'gpt-4o-mini';
    const systemMessage = `${buildAISystemMessage()}\n\n${userContext}`;

    const completion = await openai.chat.completions.create({
      model,
      stream: true,
      temperature: responseMode === 'quick' ? 0.35 : 0.55,
      max_tokens: responseMode === 'quick' ? 650 : 1800,
      messages: [
        {
          role: 'system',
          content:
            systemMessage +
            `\n\nResponse mode: ${responseMode}. ` +
            (responseMode === 'quick'
              ? 'Give a concise, useful answer. No long report. No deep scenario model unless necessary.'
              : 'Give a deeper strategic answer with useful scenario thinking when relevant.'),
        },
        ...historyMessages,
        { role: 'user', content: trimmed },
      ],
    });

    const encoder = new TextEncoder();
    let fullResponse = '';

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const chunk of completion) {
            const content = chunk.choices?.[0]?.delta?.content ?? '';

            if (!content) continue;

            fullResponse += content;

            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  content,
                  conversationId: activeConversationId,
                })}\n\n`
              )
            );
          }

          if (activeConversationId && fullResponse.trim()) {
            await supabase.from('ai_messages').insert({
              conversation_id: activeConversationId,
              user_id: user.id,
              role: 'assistant',
              content: fullResponse,
            });

            const compactSummary = [
              conversationSummary,
              `User: ${trimmed}`,
              `Assistant: ${fullResponse.slice(0, 900)}`,
            ]
              .filter(Boolean)
              .join('\n')
              .slice(-3500);

            await supabase
              .from('ai_conversations')
              .update({
                summary: compactSummary,
                last_context_summary: `Last exchange focused on: ${trimmed.slice(0, 240)}`,
              })
              .eq('id', activeConversationId)
              .eq('user_id', user.id);
          }

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                done: true,
                conversationId: activeConversationId,
              })}\n\n`
            )
          );

          controller.close();
        } catch (streamError) {
          console.error('[AI Coach Stream] Error:', streamError);

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                error: 'The AI stream failed. Please try again.',
              })}\n\n`
            )
          );

          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  } catch (error: any) {
    console.error('[AI Coach] Error:', error?.message || error);

    if (error?.status === 401 || error?.code === 'invalid_api_key') {
      return NextResponse.json(
        { error: 'AI service is not configured. Please set AI_API_KEY in your environment variables.' },
        { status: 503 }
      );
    }

    if (error?.status === 429) {
      return NextResponse.json(
        { error: 'AI service rate limit reached. Please try again in a moment.' },
        { status: 429 }
      );
    }

    return NextResponse.json(
      { error: 'An error occurred processing your request. Please try again.' },
      { status: 500 }
    );
  }
}
