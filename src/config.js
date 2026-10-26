import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const readJSON = p => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
export const accounts = readJSON('config/accounts.json');
export const campaign = readJSON('config/campaign.json');
export const platforms = Object.keys(accounts);
export function requireOAuthProvider(p) {
  if (![...platforms,'google_ads'].includes(p)) throw new Error('Unknown OAuth provider.');
  return p;
}
export function loadConfig(env = process.env) {
  const machinePath = path.join(root, 'machines', `${os.hostname().toLowerCase()}.json`);
  const machine = fs.existsSync(machinePath) ? JSON.parse(fs.readFileSync(machinePath, 'utf8')) : {};
  const artifacts = env.STUDIO_ARTIFACTS_ROOT || machine.artifactsRoot;
  if (!artifacts || !path.isAbsolute(artifacts)) throw new Error('STUDIO_ARTIFACTS_ROOT must be an absolute external directory.');
  const relative = path.relative(root, path.resolve(artifacts));
  if (!relative || (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))) throw new Error('Artifacts must be outside the repository.');
  return { env, artifacts, origin: 'http://127.0.0.1:4317' };
}
export function loadEnv() {
  const file = path.join(root, '.env');
  if (fs.existsSync(file)) process.loadEnvFile(file);
}
export function requirePlatform(p) {
  if (!platforms.includes(p)) throw new Error('Unknown platform.');
  return p;
}
