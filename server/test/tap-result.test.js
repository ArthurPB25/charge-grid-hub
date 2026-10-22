import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeTapResult} from '../tap-result.js';
const approved={nsu:'abcdefab-cdef-abcd-efab-cdefabcdefab',aut:'A12345',card_brand:'visa'};

test('retorno InfiniteTap: erro do provedor prevalece sobre identificadores de aparência válida',()=>{
  for(const extra of [{warning:'NFC indisponível'},{error_message:'Operação interrompida'},{cancelled:'true'},{success:'false'},{status:'cancelled'}]){
    const result=analyzeTapResult({...approved,...extra});
    assert.equal(result.confirmed,false); assert.equal(result.reason,'provider-rejected');
  }
  assert.match(analyzeTapResult({...approved,warning:'NFC indisponível'}).message,/NFC indisponível/);
  assert.equal(analyzeTapResult(approved).confirmed,true);
});

test('retorno InfiniteTap: diagnóstico explica campos faltantes sem expor dados da transação',()=>{
  const result=analyzeTapResult({nsu:approved.nsu});
  assert.equal(result.reason,'incomplete-result'); assert.deepEqual(result.diagnostic.missing,['aut','card_brand']);
  assert.ok(!JSON.stringify(result).includes(approved.nsu));
  const sensitive=analyzeTapResult({warning:'CPF 123.456.789-00 / contato teste@example.com',merchant_document:'98765432100'});
  assert.ok(!JSON.stringify(sensitive).includes('123.456.789-00'));
  assert.ok(!JSON.stringify(sensitive).includes('teste@example.com'));
  assert.ok(!JSON.stringify(sensitive).includes('98765432100'));
});
