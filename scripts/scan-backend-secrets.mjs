// Limited current-tree signature scan, including new files. Not a history/entropy audit.
import { execFileSync } from 'node:child_process';
import { readFileSync,writeFileSync } from 'node:fs';
const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{ encoding:'utf8' }).split('\0').filter(Boolean);
const matches=[];
let count=0;
for (const file of files.filter(f => /^(backend|contracts|docker|scripts|security)\//.test(f) && /\.(js|cjs|mjs|json|sql|ya?ml|example)$/.test(f))) {
  count++;
  const text=readFileSync(file,'utf8');
  for (const [kind,pattern] of Object.entries({ privateKey:/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,githubToken:/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/g,awsKey:/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g })) {
    for (const match of text.matchAll(pattern)) matches.push({ file,kind,line:text.slice(0,match.index).split('\n').length });
  }
}
writeFileSync('docs/audit/phase04-secret-scan.json',JSON.stringify({ scope:'Current tracked and nonignored new backend/contracts/deployment/scripts/security text files; private-key/GitHub/AWS signatures only; no history/entropy scan',filesChecked:count,matches },null,2)+'\n');
console.log(`Limited secret signatures: ${matches.length} candidates in ${count} files`);
process.exitCode=matches.length ? 1 : 0;
