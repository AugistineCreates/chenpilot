# Sandbox Execution Security

## Scope

This document describes the guarantees provided by `src/Agents/sandbox`.

The sandbox is a testing and plan-execution harness built around
`MockToolRegistry`. It is not a general-purpose security boundary for running
untrusted tools.

## What "sandboxed" means here

Sandboxed tool calls are redirected to mock behaviours registered with an
in-memory `MockToolRegistry` rather than to the application's global
`ToolRegistry` or the production tool implementations.

A mock registry:

- Keeps its mocks and call history in instance-local memory.
- Can be passed mock `ToolDefinition` objects for use by an agent planner or
  plan executor.
- Returns configured success, error, delayed, sequential, or callback-driven
  results.
- Uses a configurable sandbox user ID, which defaults to `sandbox-user`.
- Rejects unmocked tool names by default.
- Can enforce a maximum number of recorded tool calls.
- Can add a deterministic global delay and record calls for assertions.
- Does not modify the global `ToolRegistry` singleton when mocks are
  registered, reset, or cleared.

The `allowUnmocked` option does **not** execute the real tool. When enabled, an
unmocked call receives a synthetic successful passthrough result with empty
data and the message `Unmocked tool – passthrough`.

## Isolation guarantees

The sandbox provides the following isolation:

1. **Registry isolation**: registering or clearing a mock does not register,
   unregister, enable, disable, or otherwise mutate a production registry
   entry.
2. **Implementation substitution**: calls routed through a mock tool execute
   the configured mock behaviour instead of the original tool implementation.
3. **State isolation within the registry**: mock definitions, call counters, and
   recorded calls belong to the `MockToolRegistry` instance.
4. **Execution-budget controls**: the call limit, delays, and mock errors can
   constrain test plans and make undesirable test behaviour observable.
5. **Observability for tests**: recorded calls include the tool name, payload,
   user ID, result, timestamp, and duration, allowing tests to verify ordering
   and invocation counts.

These guarantees apply only to calls that are actually routed through the mock
registry and to state owned by that registry.

## Isolation that is **not** provided

This implementation does not provide process, container, operating-system,
filesystem, network, privilege, credential, or virtual-machine isolation. In
particular:

- Mock handlers are ordinary JavaScript/TypeScript functions and run in the
  same Node.js process, event loop, and address space as the test and
  application code.
- A mock handler can access any globals, imports, environment variables,
  files, network services, database connections, or credentials available to
  the hosting process.
- A callback-style mock (`type: "fn"`) is trusted code; it is not inspected,
  restricted, or terminated independently.
- A custom `ToolDefinition` whose `execute` function is supplied directly to a
  planner or executor is also ordinary in-process code unless the caller
  explicitly replaces it with a mock implementation.
- The sandbox user ID is a test label, not an authentication or authorization
  boundary. It does not create a user, limit permissions, or change operating
  system privileges.
- Recorded payloads and results remain in process memory and may contain
  sensitive data. Call recording is not a secure audit log or a redaction
  mechanism.
- A configured delay is not a timeout, CPU limit, memory limit, or cancellation
  boundary. The call limit controls recorded calls and does not contain an
  already-running handler.

A compromised or misbehaving in-process handler therefore has the same blast
radius as code executing in the host process.

## Intended threat model

The sandbox is designed to mitigate accidental side effects and test
interference from normal tool execution, including:

- Tests unintentionally calling wallet, swap, database, network, or other
  production integrations.
- Tests mutating the global tool registry or affecting other tests through
  shared registry state.
- Nondeterministic external responses making plan tests unreliable.
- Plans that loop or invoke tools unexpectedly, when the configured call limit
  is enabled.
- Missing mocks going unnoticed, when `allowUnmocked` remains disabled.
- Incorrect plan ordering, arguments, results, and error handling that can be
  detected from the recorded call history.

It is not designed to mitigate a malicious tool author, a compromised
JavaScript dependency, hostile input that reaches an in-process handler, or an
attacker who already has code execution in the application process.

## Safe usage requirements

For tests that must not perform real side effects:

1. Use a fresh `MockToolRegistry` for each test or isolated test scenario.
2. Register every expected tool explicitly.
3. Leave `allowUnmocked` disabled (the default).
4. Prefer finite `maxToolCalls` values for plans expected to be bounded.
5. Treat mock handlers and custom executors as trusted test code.
6. Do not place production credentials or sensitive payloads in recorded calls
   unless the test specifically requires them.
7. Do not describe this sandbox as suitable for running third-party or
   adversarial tools.

## Security follow-up issue

**Follow-up security issue: provide a real hostile-tool execution boundary.**

If the platform needs to execute untrusted, third-party, or potentially
compromised tool code, add a separate execution design using an independently
managed process or container with an explicit policy for filesystem, network,
credentials, CPU, memory, duration, and IPC. The current sandbox must not be
reused as that boundary without those controls and security testing.

Until that follow-up is implemented, callers must treat `src/Agents/sandbox`
as a deterministic in-process test harness only. There is no claim of VM,
container, process, privilege, or permission isolation.
