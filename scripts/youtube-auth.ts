/**
 * One-time YouTube OAuth setup — generates token.json for clip uploads.
 *
 *   1. Google Cloud Console → APIs & Services → Credentials
 *      → Create OAuth client ID (type: Desktop app) → download client_secret.json
 *      → put it in the project root. Enable "YouTube Data API v3".
 *   2. Run: npx tsx scripts/youtube-auth.ts
 *   3. Open the printed URL, authorize, and the token saves itself.
 */
import fs from 'fs';
import path from 'path';
import http from 'http';
import { google } from 'googleapis';

const PORT = 8089;
const SCOPES = [
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/youtube.readonly',
];

async function main() {
    const secretPath = path.join(process.cwd(), 'client_secret.json');
    const tokenPath = path.join(process.cwd(), 'token.json');

    if (!fs.existsSync(secretPath)) {
        console.error('❌ Falta client_secret.json en la raíz del proyecto.');
        console.error('   Google Cloud Console → Credentials → OAuth client ID (Desktop app) → Download JSON.');
        console.error('   Recuerda habilitar "YouTube Data API v3" en el proyecto de Google Cloud.');
        process.exit(1);
    }

    const credentials = JSON.parse(fs.readFileSync(secretPath, 'utf8'));
    const { client_secret, client_id } = credentials.installed || credentials.web;
    const redirectUri = `http://localhost:${PORT}`;
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirectUri);

    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent', // force refresh_token even on re-auth
        scope: SCOPES,
    });

    console.log('\n🔑 Abre esta URL en tu navegador y autoriza la cuenta de YouTube donde subirás los Shorts:\n');
    console.log(authUrl + '\n');
    console.log(`Esperando autorización en ${redirectUri} ...`);

    const code = await new Promise<string>((resolve, reject) => {
        const server = http.createServer((req, res) => {
            const url = new URL(req.url || '/', redirectUri);
            const authCode = url.searchParams.get('code');
            const error = url.searchParams.get('error');
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            if (authCode) {
                res.end('<h2>✅ Autorizado. Ya puedes cerrar esta pestaña y volver a la terminal.</h2>');
                server.close();
                resolve(authCode);
            } else {
                res.end(`<h2>❌ ${error || 'Sin código de autorización'}</h2>`);
                if (error) {
                    server.close();
                    reject(new Error(error));
                }
            }
        });
        server.listen(PORT);
        setTimeout(() => { server.close(); reject(new Error('Timeout esperando autorización (5 min)')); }, 5 * 60_000);
    });

    const { tokens } = await oAuth2Client.getToken(code);
    fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2));
    console.log(`\n✅ token.json guardado${tokens.refresh_token ? ' (incluye refresh_token: las subidas no caducan)' : ''}.`);
    console.log('   Ya puedes usar el botón "Subir a YT" en la app.');
}

main().catch(err => {
    console.error('❌', err instanceof Error ? err.message : err);
    process.exit(1);
});
