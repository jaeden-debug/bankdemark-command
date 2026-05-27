import { NextResponse } from 'next/server';
import { appendFile, mkdir } from 'fs/promises';
import path from 'path';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const email = String(body?.email || '').trim().toLowerCase();

    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Valid email required.' }, { status: 400 });
    }

    const dir = path.join(process.cwd(), 'data');
    await mkdir(dir, { recursive: true });

    const entry = {
      email,
      source: 'command_marketplace',
      created_at: new Date().toISOString(),
    };

    await appendFile(
      path.join(dir, 'email-leads.jsonl'),
      JSON.stringify(entry) + '\n',
      'utf8'
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[email-leads]', error);
    return NextResponse.json({ error: 'Could not save email.' }, { status: 500 });
  }
}
