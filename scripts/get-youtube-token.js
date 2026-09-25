import 'dotenv/config';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { google } from 'googleapis';

const scopes = ['https://www.googleapis.com/auth/youtube.upload'];
const clientId = process.env.YOUTUBE_CLIENT_ID?.trim();
const clientSecret = process.env.YOUTUBE_CLIENT_SECRET?.trim();
const redirectUri = process.env.YOUTUBE_REDIRECT_URI?.trim() || 'http://localhost:3000/oauth2/callback';

if (!clientId || !clientSecret) {
  throw new Error('Define YOUTUBE_CLIENT_ID y YOUTUBE_CLIENT_SECRET en .env antes de continuar.');
}

const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
const authUrl = oauth2.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  include_granted_scopes: true,
  scope: scopes,
});

console.log('\n1. Abre esta URL en el navegador y selecciona el canal/cuenta de YouTube:');
console.log(`\n${authUrl}\n`);
console.log(`2. Autoriza solo el permiso de subida. La redireccion usara: ${redirectUri}`);
console.log('3. Si el navegador no abre la pagina local, copia desde la URL el valor de "code".');
console.log('4. Pega aqui el codigo o la URL completa:\n');

const reader = createInterface({ input: stdin, output: stdout });
const inlineCode = process.argv
  .find((argument) => argument.startsWith('--code='))
  ?.slice('--code='.length);
const answer = (inlineCode ?? await reader.question('> ')).trim();
reader.close();

let code = answer;
if (answer.startsWith('http://') || answer.startsWith('https://')) {
  try {
    code = new URL(answer).searchParams.get('code') ?? '';
  } catch {
    code = '';
  }
}
if (!code) throw new Error('No se encontro un codigo OAuth valido.');

const { tokens } = await oauth2.getToken({ code, redirect_uri: redirectUri });
if (!tokens.refresh_token) {
  throw new Error('Google no devolvio un refresh token. Revoca el acceso previo, vuelve a autorizar y usa prompt=consent.');
}

console.log('\nCopia esta linea en .env (no la compartas):\n');
console.log(`YOUTUBE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
console.log(`Token de acceso actual: expira ${tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : 'sin dato'}.`);
console.log('El refresh token permitira que la app renueve credenciales automaticamente.');
