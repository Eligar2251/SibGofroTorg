// Deliberate local-only launcher. Prepare dependencies/build while online.
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const mode=process.argv[2];
if(mode!=='dev' && mode!=='start') { console.error('Choose dev or start'); process.exit(1); }
const bin=require.resolve('next/dist/bin/next');
const port=process.env.PORT || '3000';
const pcHome=process.env.SGT_PC_CONFIG_DIR || path.join(os.homedir(),'.sibgofrotorg-pc');
const env={...process.env,SGT_PC_LOCAL_SERVER:'1',HOSTNAME:'127.0.0.1',SGT_PC_CONFIG_DIR:pcHome,SGT_DATA_DIR:path.join(pcHome,'runtime')};
const args=mode==='dev' ? [bin,'dev','-H','127.0.0.1','-p',port] : [bin,'start','-H','127.0.0.1','-p',port];
const child=spawn(process.execPath,args,{stdio:'inherit',env});
child.on('error',e=>{console.error(e);process.exitCode=1});
child.on('exit',(code,signal)=>{if(signal) process.kill(process.pid,signal); else process.exitCode=code??1});
