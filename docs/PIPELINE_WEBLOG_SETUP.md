# Pipeline Weblog Setup (Nextflow)

This app can receive real-time pipeline progress from Nextflow via the weblog feature.
When enabled, Nextflow posts events to the app, which updates the run status and DAG
step statuses in the UI.

## Where the weblog runs

The weblog endpoint is served by this app (the same server that hosts the UI/API).
Nextflow runs on your SLURM compute nodes and sends HTTP POST requests to the app.

That means the compute nodes must be able to reach the app URL.

## Find your weblog URL

The weblog URL is simply your public app URL plus this path:

```
/api/pipelines/weblog
```

Examples:

```
https://your-domain.example.org/api/pipelines/weblog
http://your-internal-host:3002/api/pipelines/weblog
```

If your app is only reachable at `http://localhost:3002`, that will NOT work from
SLURM nodes. In that case you must expose the app on a hostname or tunnel.

### Local development

For local testing, use a public tunnel so compute nodes can reach you. Example:

```
ngrok http 3002
```

Then use the HTTPS forwarding URL from ngrok as your weblog URL.

## Configure the weblog in the UI

Go to:

```
/admin/settings/pipelines
```

Under **Compute Settings**, set:
- **Nextflow Weblog URL**: your public URL + `/api/pipelines/weblog`
- **Weblog Secret** (optional): a shared token

Save settings.

## Weblog secret

If you set a secret:
- The app will require the token on every weblog request.
- The pipeline runner will automatically append `?runId=...&token=...` to the weblog URL.

If you do not set a secret, the endpoint accepts requests without a token.

## What the pipeline runner does

When you start a run, the generated Nextflow command includes:
- `-with-weblog "<weblogUrl>?runId=<runId>&token=<secret>"`
- `-name <runNumber>`

So you only need to configure the base URL once in admin settings.

## Hybrid fallback watcher (optional)

If weblog is unreachable (e.g., SLURM nodes can’t call back), you can run a local
monitor process that reads Nextflow trace/log files and updates the database.

Run the watcher on the same host that can access run folders:

```bash
npm run pipeline:monitor
```

To run once (useful for cron):

```bash
npm run pipeline:monitor:once
```

The watcher:
- Reads `trace.txt` in each run folder
- Updates step statuses and progress
- Updates output/error tails
- Checks SLURM job state when `queueJobId` is set

## Verify it works

1. Start a MAG run from the study page.
2. Open the run detail page:

```
/dashboard/analysis/<runId>
```

3. The status and DAG nodes should update live (running/completed/failed).

If the DAG does not update:
- Confirm the weblog URL is reachable from compute nodes.
- Confirm the secret matches.
- Check that your network/firewall allows outbound HTTPS from compute nodes.
