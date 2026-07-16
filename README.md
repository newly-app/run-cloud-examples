# run.cloud examples

Runnable projects for trying run.cloud locally. Each example is self-contained
and includes its own requirements, commands, and cleanup behavior.

## Examples

### Parallel iOS simulators

Start two or three iOS simulator sessions concurrently, open a different page
in each, and automatically release every session when the demo finishes.

```bash
git clone https://github.com/newly-app/run-cloud-examples.git
cd run-cloud-examples/parallel-simulators
npm run demo -- --count 3 --duration 120 --open
```

See [parallel-simulators/README.md](parallel-simulators/README.md) for account
requirements and additional options.
