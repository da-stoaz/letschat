# Archive credential recovery regression

Requires Docker, Python 3 and SpacetimeDB CLI 2.10.1. Build candidate images from
this checkout, then run the test:

```console
spacetime build --module-path server
docker build -f server/Dockerfile.module -t ghcr.io/da-stoaz/letschat-module:archive-recovery server
docker build -f core-api/Dockerfile -t ghcr.io/da-stoaz/letschat-core-api:archive-recovery core-api
docker build -f archive-worker/Dockerfile -t ghcr.io/da-stoaz/letschat-archive-worker:archive-recovery .
python3 tests/upgrade/archive-recovery.py
```

The test uses the published 1.2.5 images as its baseline. It creates a randomly
named Compose project with private volumes and random loopback ports, and removes
only that project on exit. Existing development and production stacks are not
used. It deliberately invalidates a worker credential in the disposable stack.

Checks: baseline message replication, persistent `401 InvalidSignature` with the
released worker, recovery by updating images on the same volumes, existing chat
retention, new message replication, a second identity change without restarting
core-api, and token validity after recreating SpacetimeDB. Finally it exercises
failed PostgreSQL writes without reconnecting the subscription, a confirmed
1,100-message restore spanning multiple batches, an idempotent rerun, and a
rejected restore reducer producing a nonzero process exit code. It also exercises
the real ten-minute restore quiet period: new messages replicate while archive
pruning is blocked, then core-api automatically completes the reference rebuild
and the worker reconciles. Neither service is restarted, and the restore fence
is neither edited nor deleted. Allow about 13 minutes for the full test.

This is a developer regression test, not a production upgrade command. Production
uses the normal release image update; managed credentials recover automatically.
