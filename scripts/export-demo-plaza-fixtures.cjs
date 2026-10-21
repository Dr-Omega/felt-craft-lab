// Public presentation fixtures only; no account credentials or API calls.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'src/renderer/src/demo/plaza-demo.ts'),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const fixtureExports={};
vm.runInNewContext(code,{exports:fixtureExports,Math},{timeout:3000});
process.stdout.write(JSON.stringify(fixtureExports.DEMO_PLAZA_POSTS));
