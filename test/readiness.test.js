import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inspectReadiness} from '../server/readiness.js';
import {randomBytes} from 'node:crypto';
test('readiness detects malformed/same keys and DB errors without returning secrets',async()=>{
 process.env.ID_ENCRYPTION_KEY=randomBytes(32).toString('base64');
 process.env.ID_LOOKUP_KEY=randomBytes(32).toString('base64');
 process.env.APP_ORIGIN='https://job-counseling-kappa.vercel.app';
 process.env.GEMINI_API_KEY='test-key';process.env.DATABASE_URL='postgres://test';
 const db={query:async()=>({rows:[]})};
 assert.equal(Object.values(await inspectReadiness(db)).every(Boolean),true);
 process.env.ID_LOOKUP_KEY='node -e example';
 assert.equal((await inspectReadiness(db)).ID_LOOKUP_KEY,false);
 process.env.ID_LOOKUP_KEY=process.env.ID_ENCRYPTION_KEY;
 assert.equal((await inspectReadiness(db)).independentKeys,false);
 const checks=await inspectReadiness({query:async()=>{throw Object.assign(new Error('redacted'),{code:'ECONNREFUSED'});}});
 assert.equal(checks.databaseSchema,false);
 assert.equal(Object.values(checks).every(v=>typeof v==='boolean'),true);
});

