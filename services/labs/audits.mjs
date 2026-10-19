import { randomUUID } from 'node:crypto';
import * as viem from '../../web/vendor/runtime/c5e656ecf7fbe34e412c.mjs';
import { assert, HttpError, IMD, UPSTREAM, canonical, hash, hexToken, safeGithub, scopePaths, quoteApproval } from './security.mjs';
import { createReportPdf } from './pdf.mjs';

const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const text = (value) => String(value ?? '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').replace(/\r\n?/g, '\n');
const parsed = (value, fallback = null) => { try { return value ? JSON.parse(value) : fallback; } catch { return fallback; } };

export function normalizeReport({ job, submissions, markdown, scope = [] }) {
  const candidates = (submissions.submissions || []).filter(item => item.nodeKey === 'audit_judge' && item.accepted === true && item.outcome === 'completed');
  candidates.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const judge = candidates[0];
  assert(judge, 409, 'report_not_ready', 'The audit judge has not produced an accepted report. This is incomplete work, not a completed review.', { state: job.state, blockedReason: job.blockedReason || null });
  const repoUrl = safeGithub(submissions.repoUrl, { imported: true });
  const commit = submissions.baseCommit;
  assert(/^[0-9a-f]{40}$/.test(commit), 502, 'report_identity_mismatch', 'The report does not identify a valid pinned commit.');
  assert(job.template === 'audit' && job.id === submissions.jobId, 502, 'report_identity_mismatch', 'The provider returned an inconsistent audit report.');
  const severities = new Set(['critical', 'high', 'medium', 'low', 'info', 'informational']);
  const findings = (judge.findings || []).map((finding, index) => {
    const path = text(finding.path);
    const safePath = path && !path.startsWith('/') && !path.includes('\\') && !path.split('/').includes('..') && !/[\x00-\x1f]/.test(path);
    const sourceUrl = safePath ? `${repoUrl.replace(/\.git$/, '')}/blob/${commit}/${path.split('/').map(encodeURIComponent).join('/')}${Number.isSafeInteger(finding.line) && finding.line > 0 ? `#L${finding.line}` : ''}` : null;
    return {
      id: `${judge.hash}:${index}`, severity: severities.has(String(finding.severity).toLowerCase()) ? String(finding.severity).toLowerCase().replace('informational', 'info') : 'unclassified',
      title: text(finding.title), path, line: Number.isSafeInteger(finding.line) ? finding.line : null,
      description: text(finding.description), reproduction: text(finding.reproduction), proof: text(finding.proof), snippet: text(finding.snippet),
      recommendation: text(finding.recommendation || finding.recommendations || ''), citation: text(finding.citation), sourceUrl,
    };
  });
  return {
    markdown: text(markdown), findings, jobId: job.id, commit, repoUrl, date: judge.createdAt || job.updatedAt,
    complete: job.state === 'completed', state: job.state, scope, reportHash: hash(text(markdown)),
    sourceLinks: { repository: repoUrl.replace(/\.git$/, ''), commit: `${repoUrl.replace(/\.git$/, '')}/tree/${commit}`, report: `${UPSTREAM}/jobs/${job.id}/report.md`, submissions: `${UPSTREAM}/jobs/${job.id}/submissions`, job: `https://explorer.imd.fun/jobs/${job.id}` },
    judge: { hash: judge.hash, accepted: true, date: judge.createdAt },
    limitations: 'Public AI review of the selected code at the pinned commit. Findings may be incomplete or incorrect. This is not a security guarantee; admission and payment do not guarantee findings, completion or refunds.',
  };
}

export function createAudits({ store, upstream, now = () => Date.now() }) {
  const { db } = store; const locks = new Map();
  async function locked(key, callback) {
    const previous = locks.get(key) || Promise.resolve();
    const next = previous.catch(() => {}).then(callback); locks.set(key, next);
    try { return await next; } finally { if (locks.get(key) === next) locks.delete(key); }
  }
  function get(id, owner) {
    assert(uuidPattern.test(id), 404, 'order_not_found', 'No audit order was found.');
    const row = db.prepare('SELECT * FROM audit_orders WHERE id=? AND owner=?').get(id, owner);
    assert(row, 404, 'order_not_found', 'No audit order belongs to this wallet with that ID.');
    return row;
  }
  function view(row) {
    const remote = parsed(row.quote_json, {}); const status = parsed(row.status_json, {});
    const knownStatus = status.status || remote.status || row.submit_state;
    return {
      id: row.id, upstreamId: row.upstream_id, requestKey: row.request_key,
      status: row.payment_hash && ['quoted', 'new'].includes(knownStatus) ? 'submission_saved' : knownStatus,
      quote: remote.quote || null, inputJson: remote.inputJson || row.input_json,
      input: parsed(remote.inputJson || row.input_json), scope: parsed(row.scope_json, []),
      createdAt: remote.createdAt || new Date(row.created).toISOString(), paidAt: remote.paidAt || null,
      payment: status.payment || null, admission: status.admission || null, jobId: row.job_id || null,
      submissionSaved: Boolean(row.payment_hash),
    };
  }
  async function importSource(body) {
    const url = safeGithub(body.url);
    assert(body.ref === undefined || (typeof body.ref === 'string' && body.ref.length > 0 && body.ref.length <= 200 && /^[A-Za-z0-9_.\/-]+$/.test(body.ref) && !body.ref.includes('..')), 400, 'invalid_ref', 'Use a public branch, tag, or full commit SHA.');
    const result = (await upstream.request('/requests/import', { method: 'POST', body: { url, kind: 'code', ...(body.ref ? { ref: body.ref } : {}) } })).data;
    if (result.ok) {
      safeGithub(result.source?.repoUrl, { imported: true });
      assert(/^[0-9a-f]{40}$/.test(result.source?.baseCommit || ''), 502, 'invalid_import', 'The import did not resolve a full commit SHA.');
      store.set(`import:${result.source.repoUrl.toLowerCase()}:${result.source.baseCommit}`, { source: result.source, at: now() });
    }
    return result;
  }
  async function prepare(body) {
    const source = body.source || body;
    const repoUrl = safeGithub(source.repoUrl, { imported: true }); const baseCommit = source.baseCommit;
    assert(typeof baseCommit === 'string' && /^[a-f0-9]{40}$/.test(baseCommit), 400, 'invalid_commit', 'Import the repository and use its full pinned commit SHA.');
    const imported = store.get(`import:${repoUrl.toLowerCase()}:${baseCommit}`);
    if (!imported || now() - imported.at > 3600000) {
      const confirmed = await importSource({ url: repoUrl, ref: baseCommit });
      assert(confirmed.ok && confirmed.source.baseCommit === baseCommit, 422, 'invalid_import', 'The selected public repository and commit could not be imported.');
    }
    const scope = scopePaths(body.scope);
    const tree = await upstream.githubTree(repoUrl, baseCommit);
    const missing = scope.filter(path => path !== '.' && !tree.some(item => item.path === path.replace(/\/$/, '') || item.path.startsWith(`${path.replace(/\/$/, '')}/`)));
    assert(!missing.length, 422, 'scope_not_found', 'Some selected paths do not exist at the imported commit.', { paths: missing });
    const objective = typeof body.objective === 'string' ? body.objective.trim() : '';
    assert(objective.length <= 2000 && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(objective), 400, 'invalid_objective', 'Describe the focus in at most 2,000 characters.');
    const input = {
      objective: `Audit existing code at the pinned commit. Scope paths: ${scope.join(', ')}. ${objective ? `Focus: ${objective}\n` : ''}Review only the selected scope and necessary dependencies. Identify severity, affected code, evidence or tests, recommendations, and coverage limitations. Do not modify code, deploy contracts, or make paid transactions.`,
      template: 'audit', repoUrl, baseCommit, github: false,
    };
    return { input, scope };
  }
  async function check(body) {
    const { input, scope } = await prepare(body);
    const result = (await upstream.request('/requests/check', { method: 'POST', body: { action: 'job.open', input } })).data;
    return { ...result, input, scope };
  }
  function validateQuote(remote, input) {
    const q = remote.quote;
    assert(q && q.action === 'job.open' && q.payment?.network === 'eip155:1' && q.payment.asset?.toLowerCase() === IMD && q.payment.scheme === 'exact'
      && /^0x[0-9a-fA-F]{40}$/.test(q.payment.payTo || '') && /^[1-9][0-9]*$/.test(q.payment.amount || '') && q.payment.decimals === 18
      && Number.isSafeInteger(q.expiresAt) && q.expiresAt > Math.floor(now() / 1000), 502, 'unsupported_quote', 'The current quote is not a valid Ethereum IMD audit quote. Payment remains disabled.');
    const prepared = typeof remote.inputJson === 'string' ? parsed(remote.inputJson) : input;
    assert(prepared && prepared.template === 'audit' && prepared.baseCommit === input.baseCommit && prepared.repoUrl?.toLowerCase() === input.repoUrl.toLowerCase()
      && prepared.objective === input.objective && !prepared.onchain && !prepared.ipfs, 502, 'prepared_input_changed', 'The prepared audit input differs from the validated scope or commit. Revalidate before payment.');
    return prepared;
  }
  async function quote(owner, body) {
    assert(typeof body.requestKey === 'string' && uuidPattern.test(body.requestKey), 400, 'invalid_request_key', 'Generate and retain a UUID request key for this audit.');
    const { input, scope } = await prepare(body); const inputHash = hash(canonical(input));
    return locked(`quote:${owner}:${inputHash}`, async () => {
      let row = db.prepare('SELECT * FROM audit_orders WHERE owner=? AND request_key=?').get(owner, body.requestKey);
      assert(!row || row.input_hash === inputHash, 409, 'request_key_conflict', 'This request key already belongs to a different repository, scope or commit.');
      if (!row) {
        // A new browser key for the same active scope must recover the old order, not buy it again.
        const previous = db.prepare('SELECT * FROM audit_orders WHERE owner=? AND input_hash=? ORDER BY created DESC LIMIT 1').get(owner, inputHash);
        const q = parsed(previous?.quote_json)?.quote;
        if (previous) {
          // An unresolved quote keeps its original bearer/key, even after a lost response.
          if (!previous.upstream_id) row = previous;
          else {
            let mayReplace = false;
            if (q?.expiresAt <= Math.floor(now() / 1000) && !previous.job_id) {
              const current = await status(previous.id, owner, { force: true });
              mayReplace = current.status === 'expired' && current.payment?.paid !== true
                && !['pending', 'confirmed', 'settling'].includes(current.payment?.status) && !current.order.jobId;
            }
            if (!mayReplace) return { created: false, recovered: true, order: view(get(previous.id, owner)), input, scope };
          }
        }
      }
      if (!row) {
        const count = db.prepare('SELECT count(*) AS n FROM audit_orders WHERE owner=? AND created>?').get(owner, now() - 86400000).n;
        assert(count < 30 && db.prepare('SELECT count(*) AS n FROM audit_orders').get().n < 10000, 429, 'order_store_quota', 'Audit storage is limited to 30 new orders per wallet per day and 10,000 total. Existing orders remain available.');
        const id = randomUUID();
        db.prepare('INSERT INTO audit_orders(id,owner,request_key,token,input_hash,input_json,scope_json,created,updated) VALUES(?,?,?,?,?,?,?,?,?)')
          .run(id, owner, body.requestKey, hexToken(), inputHash, canonical(input), JSON.stringify(scope), now(), now());
        row = get(id, owner);
      }
      if (row.upstream_id) return { created: false, order: view(row), input, scope };
      const checked = (await upstream.request('/requests/check', { method: 'POST', body: { action: 'job.open', input } })).data;
      assert(Array.isArray(checked.blockers) && checked.blockers.length === 0, 422, 'audit_refused', 'The IMD input check refused this scope. No payment was requested.', checked);
      const quoted = await upstream.request('/requests/quote', { method: 'POST', token: row.token, body: { requestKey: row.request_key, action: 'job.open', input } });
      const remote = quoted.data.order; validateQuote(remote, input);
      assert(uuidPattern.test(remote.id), 502, 'invalid_order', 'The provider returned an invalid order ID.');
      db.prepare('UPDATE audit_orders SET upstream_id=?,quote_json=?,submit_state=?,updated=? WHERE id=?').run(remote.id, JSON.stringify(remote), remote.status, now(), row.id);
      return { created: quoted.data.created, order: view(get(row.id, owner)), input, scope };
    });
  }
  async function status(id, owner, { force = false } = {}) {
    let row = get(id, owner);
    if (row.upstream_id && (force || now() - row.updated > 8000 || !row.status_json)) {
      const data = (await upstream.request(`/requests/${row.upstream_id}`, { token: row.token })).data;
      const jobId = data.admission?.result?.kind === 'job' ? data.admission.result.jobId : null;
      assert(!jobId || uuidPattern.test(jobId), 502, 'invalid_job_id', 'The provider returned an invalid job ID.');
      db.prepare('UPDATE audit_orders SET status_json=?,job_id=COALESCE(?,job_id),updated=? WHERE id=?').run(JSON.stringify(data), jobId, now(), id);
      row = get(id, owner);
    }
    const data = parsed(row.status_json, {}); let job = null;
    if (row.job_id) job = await upstream.cached(`job:${row.job_id}`, 15000, async () => (await upstream.request(`/jobs/${row.job_id}`)).data);
    return { ...data, status: view(row).status, order: view(row), job };
  }
  async function challenge(id, owner) {
    const row = get(id, owner);
    assert(row.upstream_id, 409, 'quote_not_ready', 'This order has not received a quote. Retry the same request key.');
    const remote = parsed(row.quote_json); const q = remote?.quote;
    assert(q?.expiresAt > Math.floor(now() / 1000), 409, 'quote_expired', 'This quote expired. Refresh status before creating a new quote; never sign an expired quote.');
    assert(!row.payment_hash, 409, 'payment_already_saved', 'This order already has a signed payment. Retry the saved payment or refresh status; do not sign again.');
    const latest = await status(id, owner, { force: true });
    assert(latest.status === 'quoted', 409, 'order_not_payable', 'This order is already paid, pending, failed, or expired. Check status before taking another action.', latest);
    const result = await upstream.request(`/requests/${row.upstream_id}/submit`, { method: 'POST', token: row.token, allow402: true });
    assert(result.status === 402 && result.data?.x402Version === 2, 409, 'challenge_unavailable', 'This order no longer needs a payment challenge. Refresh its status.');
    const ch = result.data;
    assert(canonical(ch.quote) === canonical(q) && ch.resourceUrl === `${UPSTREAM}/requests/${row.upstream_id}/submit`
      && canonical(ch.input) === canonical(parsed(remote.inputJson || row.input_json)), 502, 'challenge_mismatch', 'The payment challenge changed its quote or scope. Payment is disabled.');
    assert(Array.isArray(ch.accepts) && ch.accepts.length === 1 && ch.accepts[0].scheme === 'exact' && ch.accepts[0].network === q.payment.network
      && ch.accepts[0].asset?.toLowerCase() === q.payment.asset.toLowerCase() && ch.accepts[0].payTo?.toLowerCase() === q.payment.payTo.toLowerCase() && ch.accepts[0].amount === q.payment.amount
      && ch.accepts[0].extra?.assetTransferMethod === 'permit2', 502, 'unsupported_payment_challenge', 'The provider did not offer a supported exact IMD Permit2 payment.');
    db.prepare('UPDATE audit_orders SET challenge_json=?,updated=? WHERE id=?').run(JSON.stringify(ch), now(), id);
    return ch;
  }
  async function validatePayment(row, owner, payment, signature) {
    const ch = parsed(row.challenge_json); assert(ch, 409, 'challenge_required', 'Load and review the current payment challenge first.');
    const q = ch.quote;
    assert(q.expiresAt > Math.floor(now() / 1000), 409, 'quote_expired', 'The payment quote expired. Do not sign or submit a new payment.');
    assert(payment && typeof payment === 'object' && payment.x402Version === 2 && canonical(payment.accepted) === canonical(ch.accepts[0]), 400, 'payment_terms_mismatch', 'The signed payment must match the saved challenge exactly.');
    const permit = payment.payload?.permit2Authorization;
    assert(permit?.from?.toLowerCase() === owner && permit?.permitted?.token?.toLowerCase() === IMD
      && permit?.permitted?.amount === q.payment.amount && permit?.witness?.to?.toLowerCase() === q.payment.payTo.toLowerCase(), 403, 'payer_mismatch', 'The logged-in wallet must fund this exact IMD quote.');
    assert(/^\d+$/.test(String(permit?.deadline)) && BigInt(permit.deadline) <= BigInt(q.expiresAt) && BigInt(permit.deadline) > BigInt(Math.floor(now() / 1000)), 400, 'payment_expired', 'The payment window must be open and end before the quote expires.');
    assert(!payment.resource || payment.resource.url === ch.resourceUrl, 400, 'payment_resource_mismatch', 'The payment must name this exact order.');
    assert(typeof signature === 'string' && /^0x[0-9a-fA-F]{130}$/.test(signature), 400, 'invalid_quote_signature', 'A 65-byte quote approval from the paying wallet is required.');
    let recovered;
    try { recovered = await viem.recoverTypedDataAddress({ ...quoteApproval(ch, payment), signature }); } catch {}
    assert(recovered?.toLowerCase() === owner, 403, 'quote_signature_mismatch', 'The quote approval does not belong to the logged-in paying wallet.');
  }
  async function submit(id, owner, body) {
    return locked(`submit:${id}`, async () => {
      let row = get(id, owner);
      assert(row.upstream_id, 409, 'quote_not_ready', 'Create and review an audit quote first.');
      if (row.payment_hash && body.payment) assert(hash(canonical(body.payment)) === row.payment_hash && body.quoteSignature === row.quote_signature, 409, 'payment_already_saved', 'This order already has a different signed payment. Only its saved payment can be retried.');
      if (!row.payment_hash) {
        await validatePayment(row, owner, body.payment, body.quoteSignature);
        const paymentJson = canonical(body.payment);
        // Write ahead of dispatch. A crash or lost response is recovered with these exact bytes.
        db.prepare('UPDATE audit_orders SET payment_json=?,quote_signature=?,payment_hash=?,submit_state=?,updated=? WHERE id=?')
          .run(paymentJson, body.quoteSignature, hash(paymentJson), 'submission_saved', now(), id);
        row = get(id, owner);
      }
      // Read-only recovery first. The provider also binds/replays one order idempotently.
      const current = await status(id, owner, { force: true });
      if (['payment_pending', 'admission_pending', 'admitted', 'payment_failed', 'expired'].includes(current.status) || current.payment?.paid) return current;
      const quote = parsed(row.quote_json)?.quote;
      if (quote?.expiresAt <= Math.floor(now() / 1000)) return { ...current, status: 'expired', message: 'The saved quote expired. Refresh status; no new signature is requested.' };
      const result = await upstream.request(`/requests/${row.upstream_id}/submit`, {
        method: 'POST', token: row.token, payment: Buffer.from(row.payment_json).toString('base64'), body: { quoteSignature: row.quote_signature },
      });
      const data = result.data; const jobId = data.admission?.result?.kind === 'job' ? data.admission.result.jobId : null;
      db.prepare('UPDATE audit_orders SET status_json=?,job_id=COALESCE(?,job_id),submit_state=?,updated=? WHERE id=?')
        .run(JSON.stringify(data), jobId, data.status || 'submitted', now(), id);
      return { ...data, order: view(get(id, owner)) };
    });
  }
  async function reportByJob(jobId, scope = []) {
    assert(uuidPattern.test(jobId), 400, 'invalid_job_id', 'Use a valid public audit job ID.');
    const saved = await upstream.cached(`report:${jobId}`, 60000, async () => {
      // Fetch only documented, fixed-origin paths. No artifact URL, Markdown URL or repository instruction is followed.
      const [job, submissions, report] = await Promise.all([
        upstream.request(`/jobs/${jobId}`), upstream.request(`/jobs/${jobId}/submissions`), upstream.request(`/jobs/${jobId}/report.md`, { text: true }),
      ]);
      return normalizeReport({ job: job.data, submissions: submissions.data, markdown: report.data });
    });
    return { ...saved, scope };
  }
  async function report(id, owner) {
    const current = await status(id, owner); const row = get(id, owner);
    assert(row.job_id, 409, 'job_not_admitted', 'This order has no admitted audit job yet.', { status: current.status });
    const result = await reportByJob(row.job_id, parsed(row.scope_json, []));
    const input = parsed(row.input_json);
    assert(result.commit === input.baseCommit && result.repoUrl.toLowerCase() === input.repoUrl.toLowerCase(), 502, 'report_identity_mismatch', 'The accepted report does not match this order’s pinned source.');
    return result;
  }
  function list(owner) { return { orders: db.prepare('SELECT * FROM audit_orders WHERE owner=? ORDER BY created DESC LIMIT 100').all(owner).map(view) }; }
  return { importSource, check, quote, status, challenge, submit, report, reportByJob, list, pdf: createReportPdf };
}
