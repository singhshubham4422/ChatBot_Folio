import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const srcDir = resolve(root, 'SmartBot/data');
const destDir = resolve(root, 'public/data');

mkdirSync(destDir, { recursive: true });

const files = ['faq_dataset.jsonl', 'chatbot_intents.jsonl', 'chatbot_config.json'];
let syncedCount = 0;

for (const file of files) {
  const src = resolve(srcDir, file);
  const dest = resolve(destDir, file);
  if (!existsSync(src)) {
    throw new Error(`Canonical SmartBot file missing: ${src}`);
  }
  const srcContent = readFileSync(src);
  const destExists = existsSync(dest);
  const destContent = destExists ? readFileSync(dest) : null;
  if (!destExists || !srcContent.equals(destContent!)) {
    copyFileSync(src, dest);
    syncedCount++;
  }
}

console.log(`[SmartBot] Data sync complete: ${files.length} canonical files verified, ${syncedCount} updated in public/data/.`);
