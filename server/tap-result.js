// Local callback classification, never independent financial verification.
export function analyzeTapResult(data = {}) {
  const clean = value => typeof value === 'string' && value.length <= 200 && !/[\x00-\x1f\x7f]/.test(value);
  const meaningful = value => value != null && value !== '' && value !== false && value !== 'false';
  const required = ['nsu', 'aut', 'card_brand'];
  const missing = required.filter(key => !clean(data[key]) || !data[key].trim());
  const invalid = [];
  if (!missing.includes('nsu') && !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(data.nsu)) invalid.push('nsu');
  if (!missing.includes('aut') && !/^[a-z\d]{1,40}$/i.test(data.aut)) invalid.push('aut');
  const errors = ['warning', 'error', 'error_message', 'error_code', 'cancelled', 'canceled'].filter(key => meaningful(data[key]));
  const successInvalid = data.success != null && ![true, 'true'].includes(data.success);
  const statusInvalid = data.status != null && !['approved', 'success', 'successful', 'paid', 'completed'].includes(data.status);
  if (!missing.length && !invalid.length && !errors.length && !successInvalid && !statusInvalid) return { confirmed: true };
  const safeText = value => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[email omitido]')
    .replace(/\b\d[\d.\-/ ]{9,}\d\b/g, '[identificador omitido]')
    .replace(/\b[a-f\d]{32,}\b/gi, '[identificador omitido]').slice(0, 160).trim() : '';
  const providerMessage = ['warning', 'error_message', 'error', 'error_code'].map(key => safeText(data[key])).find(Boolean);
  let reason, message;
  if (errors.length || successInvalid || statusInvalid) {
    reason = 'provider-rejected';
    message = providerMessage ? `InfinitePay: ${providerMessage}`
      : statusInvalid ? `O InfinitePay retornou um status de pagamento não reconhecido (${safeText(data.status) || 'inválido'}).`
      : 'O InfinitePay retornou cancelamento ou falha na operação.';
  } else if (missing.length) {
    reason = 'incomplete-result';
    message = `O InfinitePay voltou sem a confirmação completa (${missing.join(', ')}).`;
  } else {
    reason = 'invalid-result';
    message = `O retorno do InfinitePay contém dados inválidos (${invalid.join(', ')}).`;
  }
  return { confirmed: false, reason, message: message + ' A recarga permanece bloqueada. Confira a transação no InfinitePay antes de repetir.',
    diagnostic: { reason, missing, invalid, errorFields: errors,
      ...(providerMessage ? { providerMessage } : {}),
      ...(clean(data.status) ? { providerStatus: safeText(data.status) } : {}) } };
}
