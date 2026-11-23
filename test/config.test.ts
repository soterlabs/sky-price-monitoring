import {it}from 'node:test';import assert from 'node:assert/strict';import {period}from '../src/config.js';import {safeError}from '../src/errors.js';
it('validates every supported period and rejects arbitrary query values',()=>{for(const p of ['24h','7d','30d','90d','180d'])assert.equal(period(p),p);for(const p of ['1d','all',"' OR 1=1",''])assert.throws(()=>period(p));});
it('redacts endpoint credentials in public job failures',()=>{assert.equal(safeError(new Error('Could not reach https://user:secret@node.example/private-key\nprivate diagnostic')),'Could not reach [endpoint]');});
