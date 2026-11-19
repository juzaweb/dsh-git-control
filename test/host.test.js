/**
 * Behaviour tests for the Host half's commit-message retry.
 *
 * The real service is mounted through `apply` with a fake context, so the test
 * drives the same code path the Client route dispatches and never runs git.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../index.js';

/** Mount the service with the minimum context it needs, then take it back. */
function mount(commitModel) {
  let service = null;
  const ctx = {
    provide: (_name, value) => {
      service = value;
    },
    get: () => undefined,
    effect: () => {},
    connection: { fetch: { register: () => () => {} } },
    logger: { warn() {}, info() {} },
  };
  apply(ctx, { commitModel });
  assert.ok(service !== null, 'service provided');
  service.root = async () => '/repo';
  service.status = async () => ({ files: [{ path: 'a.js', code: 'M', staged: true }], branch: 'main', name: 'demo' });
  service.commitContext = async () => ({ files: 'M a.js', scope: 'staged', diff: '', truncated: false, recent: '', branch: 'main', name: 'demo' });
  const waits = [];
  service.delay = async (ms, signal) => {
    if (signal?.aborted) throw Object.assign(new Error('cancelled'), { code: 'git-control/cancelled' });
    waits.push(ms);
  };
  return { service, waits };
}

const emptyFailure = () => Object.assign(new Error('The model returned no usable commit message.'), { code: 'git-control/empty-message' });

test('an empty reply is retried three times, 30 s apart, then succeeds', async () => {
  const { service, waits } = mount({ provider: 'p', model: 'm' });
  const replies = [emptyFailure(), emptyFailure(), emptyFailure(), { message: 'fix: retry' }];
  let calls = 0;
  service.completeCommitMessage = async () => {
    const reply = replies[calls];
    calls += 1;
    if (reply instanceof Error) throw reply;
    return reply;
  };

  const result = await service.generateCommitMessage({ path: '/repo' });
  assert.equal(result.message, 'fix: retry');
  assert.equal(calls, 4, 'first attempt plus three retries');
  assert.deepEqual(waits, [30_000, 30_000, 30_000]);
});

test('four empty replies fail with the empty-message code, not the retry count', async () => {
  const { service, waits } = mount({ provider: 'p', model: 'm' });
  let calls = 0;
  service.completeCommitMessage = async () => {
    calls += 1;
    throw emptyFailure();
  };

  await assert.rejects(service.generateCommitMessage({ path: '/repo' }), (error) => error.code === 'git-control/empty-message');
  assert.equal(calls, 4);
  assert.deepEqual(waits, [30_000, 30_000, 30_000]);
});

test('a model failure is reported at once instead of retried', async () => {
  const { service, waits } = mount({ provider: 'p', model: 'm' });
  let calls = 0;
  service.completeCommitMessage = async () => {
    calls += 1;
    throw Object.assign(new Error('provider exploded'), { code: 'git-control/model-failed' });
  };

  await assert.rejects(service.generateCommitMessage({ path: '/repo' }), /provider exploded/);
  assert.equal(calls, 1);
  assert.deepEqual(waits, []);
});

test('cancelling during the wait ends the retry loop', async () => {
  const { service } = mount({ provider: 'p', model: 'm' });
  const controller = new AbortController();
  let calls = 0;
  service.completeCommitMessage = async () => {
    calls += 1;
    throw emptyFailure();
  };
  service.delay = async (_ms, signal) => {
    controller.abort();
    if (signal?.aborted) throw Object.assign(new Error('cancelled'), { code: 'git-control/cancelled' });
  };

  await assert.rejects(service.generateCommitMessage({ path: '/repo' }, controller.signal), (error) => error.code === 'git-control/cancelled');
  assert.equal(calls, 1, 'no second model call after cancellation');
});
