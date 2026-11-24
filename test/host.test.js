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
  const commands = [];
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
    inject: (_deps, run) => {
      run({ commands: { register: (definition) => { commands.push(definition); return () => {}; } } });
      return () => {};
    },
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
  return { service, waits, commands };
}

const emptyFailure = () => Object.assign(new Error('The model returned no usable commit message.'), { code: 'git-control/empty-message' });

/** Material `completeCommitMessage` reads; it never touches git itself. */
const context = { files: 'M a.js', scope: 'staged', diff: '', truncated: false, recent: '', branch: 'main', name: 'demo' };

/**
 * A fake `llm` service. `efforts` is the route's reasoning metadata, or null
 * for a route that does not reason; each prepared call's controls and stream
 * request are recorded. `reply` is one text, or a list returned in turn.
 */
function fakeLlm(reply, efforts = ['off', 'low', 'high']) {
  const calls = [];
  const requests = [];
  const replies = Array.isArray(reply) ? reply.slice() : null;
  return {
    calls,
    requests,
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
        stream: (request) => {
          requests.push(request);
          const text = replies === null ? reply : replies.shift() ?? '';
          return (async function* replyText() {
            yield { type: 'text-delta', text };
            yield { type: 'finish', reason: { kind: 'stop' } };
          })();
        },
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

test('a reply that narrates a tool call is not used as the message', async () => {
  const llm = fakeLlm("I'll examine the staged changes more closely.\n<tool_call>bash<arg_key>command</arg_key><arg_value>git diff --cached</arg_value></tool_call>");
  const { service } = mount({ provider: 'p', model: 'm' }, llm);

  await assert.rejects(
    service.completeCommitMessage({ provider: 'p', model: 'm' }, context),
    (error) => error.code === 'git-control/empty-message',
  );
});

test('a message that precedes a tool call keeps its text', async () => {
  const llm = fakeLlm('fix: keep the staged config\n\n<tool_call>bash<arg_key>command</arg_key>');
  const { service } = mount({ provider: 'p', model: 'm' }, llm);

  const result = await service.completeCommitMessage({ provider: 'p', model: 'm' }, context);

  assert.equal(result.message, 'fix: keep the staged config');
});

test('a narrated preamble above the message is dropped', async () => {
  const llm = fakeLlm('Here is the commit message:\n\nfix: keep the staged config');
  const { service } = mount({ provider: 'p', model: 'm' }, llm);

  const result = await service.completeCommitMessage({ provider: 'p', model: 'm' }, context);

  assert.equal(result.message, 'fix: keep the staged config');
});

test('the call rules out tools, and a retry says why the last reply failed', async () => {
  const llm = fakeLlm('chore: drop dead code');
  const { service } = mount({ provider: 'p', model: 'm' }, llm);

  await service.completeCommitMessage({ provider: 'p', model: 'm' }, context, undefined, 1);

  assert.match(llm.requests[0].system, /no tools/u);
  assert.match(llm.requests[0].system, /previous reply was not a commit message/u);
});

test('a tool-call reply is retried until the model writes the message', async () => {
  const llm = fakeLlm([
    "I'll inspect the staged files first.\n<tool_call>bash<arg_key>command</arg_key><arg_value>git diff --cached --stat</arg_value></tool_call>",
    'feat: add the git panel',
  ]);
  const { service, waits } = mount({ provider: 'p', model: 'm' }, llm);

  const result = await service.generateCommitMessage({ path: '/repo' });

  assert.equal(result.message, 'feat: add the git panel');
  assert.deepEqual(waits, [30_000]);
  assert.equal(llm.requests.length, 2);
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

/* The `/ship` workflow: one request turn, then the review gesture as its own turn. */

/** Invoke the registered command against an Agent that records its inbox. */
function ship(rawInput, attachments = []) {
  const { commands } = mount({ provider: 'p', model: 'm' });
  assert.equal(commands.length, 1, 'one command registered');
  const messages = [];
  const agent = { followup: (message) => { messages.push(message); } };
  const outcome = commands[0].handler({ agent, rawInput, attachments, signal: new AbortController().signal });
  return { definition: commands[0], outcome, messages };
}

test('the command advertises its request hint and attachment support', () => {
  const { definition } = ship('anything');
  assert.equal(definition.name, 'ship');
  assert.match(definition.description, /review/u);
  assert.deepEqual(definition.input, { hint: '[request]', attachments: true });
  assert.equal(definition.recordInput, false, 'the queued message already carries the request');
});

test('the request runs first and the review gesture queues behind it', () => {
  const { outcome, messages } = ship('  add a README badge  ');

  assert.equal(outcome.kind, 'success');
  assert.equal(messages.length, 2, 'one turn per message');
  assert.deepEqual(messages[0].content, [{ type: 'text', text: 'add a README badge' }]);
  assert.deepEqual(messages[1].content, [{ type: 'text', text: '/code-review-and-quality review and fix' }]);
  for (const message of messages) {
    assert.equal(message.role, 'user');
    // The skill gesture is only scanned in direct user input.
    assert.deepEqual(message.source, { kind: 'user' });
    assert.equal(typeof message.id, 'string');
    assert.ok(message.id.length > 0);
  }
  assert.notEqual(messages[0].id, messages[1].id, 'each turn carries its own identity');
});

test('attachments ride the request turn, ahead of its text', () => {
  const attachment = { type: 'file', receiptId: 'receipt-1' };
  const { messages } = ship('rename the field', [attachment]);

  assert.deepEqual(messages[0].content, [attachment, { type: 'text', text: 'rename the field' }]);
  assert.equal(messages.length, 2);
});

test('an empty request is refused without queueing a turn', () => {
  const { outcome, messages } = ship('   ');

  assert.equal(outcome.kind, 'error');
  assert.match(outcome.text, /Usage: \/ship/u);
  assert.deepEqual(messages, []);
});

test('attachments alone are a request', () => {
  const attachment = { type: 'image', mediaType: 'image/png', data: 'AA==', name: 'shot.png' };
  const { outcome, messages } = ship('  ', [attachment]);

  assert.equal(outcome.kind, 'success');
  assert.deepEqual(messages[0].content, [attachment]);
  assert.equal(messages.length, 2);
});

test('a profile without a command registry still mounts the service', () => {
  let service = null;
  const ctx = {
    provide: (_name, value) => { service = value; },
    get: () => undefined,
    effect: () => {},
    inject: () => () => {},
    connection: { fetch: { register: () => () => {} } },
    logger: { warn() {}, info() {} },
  };

  apply(ctx, {});

  assert.ok(service !== null, 'the git service still mounts');
});
