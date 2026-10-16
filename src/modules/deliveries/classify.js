/**
 * Classify an SMTP send error so a bad ADDRESS is handled differently from a bad ROUTE.
 *
 *  hard_bounce  the mailbox/domain doesn't exist -> suppress the address, never retry
 *  soft_bounce  mailbox full / temporarily unavailable -> failed, retryable, address kept
 *  rejected     blocked for content/policy/reputation (5.7.x, 554) -> failed, address NOT suppressed
 *  transient    4xx / network trouble -> failed, retryable
 *
 * Only `hard_bounce` is the recipient's fault. Everything else may be OUR problem (blocklisted IP,
 * SMTP outage), so it must never suppress an address and it counts toward the circuit breaker.
 */
function classifySmtpError(err) {
  const code = Number(err?.responseCode) || null;
  const text = `${err?.response || ''} ${err?.message || ''}`;
  const enhanced = (text.match(/\b([245])\.(\d{1,3})\.(\d{1,3})\b/) || []).slice(1).map(Number); // [class, subject, detail]
  const [klass, subject] = enhanced;

  if (klass === 5 && subject === 7) return { kind: 'rejected', code }; // policy / spam / reputation
  if (klass === 5 && subject === 1) return { kind: 'hard_bounce', code }; // 5.1.x: bad destination address
  if (code === 552 || (klass === 5 && subject === 2)) return { kind: 'soft_bounce', code }; // mailbox full
  if ([550, 551, 553].includes(code)) return { kind: 'hard_bounce', code }; // unknown user / not local / bad mailbox name
  if (code === 554) return { kind: 'rejected', code };
  if ((code && code >= 400 && code < 500) || klass === 4) return { kind: 'transient', code };
  return { kind: 'transient', code };
}

module.exports = { classifySmtpError };
