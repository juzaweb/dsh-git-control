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
function mount(commitModel, llm = undefined, agentModel = undefined) {
  let service = null;
  const ctx = {
    provide: (_name, value) => {
      service = value;
    },
    get: (name) => {
      if (name === 'llm') return llm;
      if (name === 'agentDefaultModel') return agentModel;
      return undefined;
    },
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

/** Material `completeCommitMessage` reads; it never touches git itself. */
const context = { files: 'M a.js', scope: 'staged', diff: '', truncated: false, recent: '', branch: 'main', name: 'demo' };

/**
 * A fake `llm` service. `efforts` is the route's reasoning metadata, or null
 * for a route that does not reason; each prepared call's controls are recorded.
 */
function fakeLlm(reply, efforts = ['off', 'low', 'high']) {
  const calls = [];
  return {
    calls,
    async prepareCall(config, _signal, configure) {
      const effortsInfo = efforts === null
        ? {}
        : {
          reasoning: {
            efforts: efforts.map((id) => ({ id, name: id })),
            defaultEffort: efforts[efforts.length - 1],
          },
        };
      const model = { provider: config.provider, id: config.model, name: config.model, ...effortsInfo };
      const controls = configure({ maxTokens: config.maxTokens, temperature: config.temperature }, model);
      calls.push(controls);
      return {
        config: { provider: config.provider, model: config.model, ...controls },
        stream: () => (async function* replyText() {
          yield { type: 'text-delta', text: reply };
          yield { type: 'finish', reason: { kind: 'stop' } };
        })(),
      };
    },
  };
}

test('an unset effort picks the least the route offers, so the call never thinks', async () => {
  const llm = fakeLlm('feat: add the panel');
  const { service } = mount({ provider: 'p', model: 'm' }, llm);

  const result = await service.completeCommitMessage({ provider: 'p', model: 'm' }, context);

  assert.equal(result.message, 'feat: add the panel');
  assert.equal(llm.calls.length, 1);
  assert.equal(llm.calls[0].reasoningEffort, 'off');
});

test('a configured reasoning effort is the one the call sends', async () => {
  const llm = fakeLlm('fix: keep the configured effort');
  const { service } = mount({ provider: 'p', model: 'm', reasoningEffort: 'high' }, llm);

  await service.completeCommitMessage({ provider: 'p', model: 'm', reasoningEffort: 'high' }, context);

  assert.equal(llm.calls[0].reasoningEffort, 'high');
});

test('a route without reasoning metadata sends no effort at all', async () => {
  const llm = fakeLlm('chore: drop dead code', null);
  const { service } = mount({ provider: 'p', model: 'm' }, llm);

  await service.completeCommitMessage({ provider: 'p', model: 'm' }, context);

  assert.equal('reasoningEffort' in llm.calls[0], false);
});

test('the agent default model\'s effort is not carried into the message call', async () => {
  const llm = fakeLlm('docs: explain the panel');
  const { service } = mount(undefined, llm, {
    currentSelection: () => ({ provider: 'p', model: 'm', reasoningEffort: 'medium' }),
  });

  const result = await service.generateCommitMessage({ path: '/repo' });

  assert.equal(result.message, 'docs: explain the panel');
  assert.equal(llm.calls[0].reasoningEffort, 'off');
});

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
