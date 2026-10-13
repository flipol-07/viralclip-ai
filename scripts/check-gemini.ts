/**
 * Dev check: verifies GEMINI_API_KEY, resolves the model ID and runs one
 * trivial structured-output call. Run with: npx tsx scripts/check-gemini.ts
 */
import fs from 'fs';
import path from 'path';

// Load .env.local before importing anything that reads process.env at module scope
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (match && !(match[1] in process.env)) {
            process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
        }
    }
}

async function main() {
    const { z } = await import('zod');
    const { resolveModelId, generateJson } = await import('../src/features/processing/services/analysis/gemini-client');

    const model = await resolveModelId();
    console.log(`Model resolved: ${model}`);

    const result = await generateJson({
        label: 'check',
        input: 'Reply with ok=true and a 5-word greeting in Spanish.',
        schema: z.object({ ok: z.boolean(), greeting: z.string() }),
        responseSchema: {
            type: 'object',
            properties: { ok: { type: 'boolean' }, greeting: { type: 'string' } },
            required: ['ok', 'greeting'],
        },
        maxOutputTokens: 1024,
    });

    console.log('Structured response:', JSON.stringify(result));
    console.log('✅ Gemini foundation working');
}

main().catch(err => {
    console.error('❌', err instanceof Error ? err.message : err);
    process.exit(1);
});
