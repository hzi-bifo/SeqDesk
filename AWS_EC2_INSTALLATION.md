# Install SeqDesk on AWS EC2 (beginner guide)

This guide creates a small SeqDesk test system on one Amazon EC2 instance. It
assumes you have an AWS account but have not used EC2 before. The result is:

- SeqDesk and PostgreSQL on one Ubuntu server
- the SeqDesk user interface open in your browser
- automatic application restarts through PM2
- Conda and Nextflow for small pipeline tests
- optionally, a one-node Slurm setup for testing SeqDesk's SLURM integration

The one-node Slurm setup is an integration smoke test; it does not add compute
capacity. A real multi-node cluster has additional shared-filesystem and network
requirements described later.

> **Security:** SeqDesk is designed for a trusted internal network. The direct
> browser access below is only for a temporary test and is restricted to your
> current public IP. Never choose `Anywhere` or `0.0.0.0/0` for the SeqDesk or
> SSH ports. Do not use real credentials or sequencing data in this HTTP-only
> setup. A permanent installation should use private/VPN access and HTTPS.

> **Test coverage:** Public CI tests packaged application installs on Ubuntu
> 24.04/x64 with Node.js 24 and PostgreSQL 16, and on Ubuntu 22.04/x64 with
> Node.js 22.13.0 and PostgreSQL 14. Those jobs use prepared PostgreSQL services
> and explicit database URLs. An extended Linux job runs only the packaged
> `fastq-checksum` workflow on tiny synthetic reads. The exact EC2 console,
> `apt`/`systemd`, PM2 reboot, and one-node Slurm procedure below is a documented
> operator recipe, not a public CI environment. Real Slurm execution is tested
> separately in private self-hosted CI. See
> [Installation compatibility and reproducibility](INSTALLATION_COMPATIBILITY.md).

AWS changes its console occasionally. These labels match the console as checked
in July 2026.

## Before you start

You need an AWS account with permission to create and terminate EC2 instances,
security groups, key pairs, and EBS volumes. Allow 45–90 minutes; the Conda
environment is usually the slowest part.

AWS charges for running instances, EBS storage, data transfer, public IPv4
addresses, and sometimes surplus T3 CPU credits. Review the estimate on the EC2
launch screen and terminate test resources when finished.

| Goal | Instance | Root disk | Installer option |
| --- | --- | --- | --- |
| UI only | `t3.medium` (2 vCPU, 4 GiB) | 40 GiB `gp3` | `--without-pipelines` |
| UI plus small pipeline/Slurm tests | `t3.large` (2 vCPU, 8 GiB) | 100 GiB `gp3` | `--with-pipelines` |

This guide uses the second row and an x86_64 instance. It is not large enough
for production MAG, MetaxPath, or other substantial analyses.

## 1. Launch an EC2 instance

1. Sign in to the [AWS console](https://console.aws.amazon.com/).
2. Search for `EC2`, then choose **EC2**.
3. Select a nearby Region in the upper-right corner, for example
   **Europe (Frankfurt) eu-central-1**. Keep using that Region.
4. Choose **Launch instance**.
5. Under **Name and tags**, enter `seqdesk-test`.
6. Under **Application and OS Images** choose:
   - **Quick Start → Ubuntu**
   - **Ubuntu Server 24.04 LTS**
   - **64-bit (x86)** architecture
7. Under **Instance type**, choose `t3.large`.
8. Under **Key pair (login)** choose **Create new key pair**:
   - Name: `seqdesk-test-key`
   - Type: `RSA`
   - Format: `.pem`
   - choose **Create key pair**

   Save `seqdesk-test-key.pem` securely. AWS cannot display the private key
   again.

9. Under **Network settings**, choose **Edit**:
   - VPC: the default VPC is sufficient for this test
   - Subnet: **No preference**
   - Auto-assign public IP: **Enable**
   - Firewall: **Create security group**
   - Name: `seqdesk-test-sg`
10. Add only these inbound rules:

    | Type | Port | Source | Purpose |
    | --- | --- | --- | --- |
    | SSH | 22 | **My IP** | Terminal access |
    | Custom TCP | 8000 | **My IP** | SeqDesk UI |

    Do not add PostgreSQL port `5432`. Do not use **Anywhere-IPv4** or
    **Anywhere-IPv6**. AWS recommends authorizing only the specific source ranges
    that need access; see [security group rules](https://docs.aws.amazon.com/vpc/latest/userguide/working-with-security-group-rules.html).

11. Under **Configure storage**, set a `100 GiB` `gp3` root volume. Leave
    **Delete on termination** enabled for this disposable test.
12. Review **Summary**, choose **Launch instance**, then **View all instances**.
13. Wait for **Running** and **2/2 checks passed**.

See AWS's [launch-instance guide](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-launch-instance-wizard.html)
for the current wizard fields.

## 2. Note the URL and connect

On **EC2 → Instances**, select `seqdesk-test` and copy **Public IPv4 address**.
This guide calls it `PUBLIC_IP`. An automatically assigned address normally
changes after the instance is stopped and started.

### Connect with SSH

Open Terminal on macOS/Linux or PowerShell on Windows. Change to the directory
containing the key and run:

```bash
cd ~/Downloads
chmod 400 seqdesk-test-key.pem
ssh -i seqdesk-test-key.pem ubuntu@PUBLIC_IP
```

Replace `PUBLIC_IP` with the copied address. Confirm the expected host by
entering `yes`. The EC2 prompt looks similar to:

```text
ubuntu@ip-172-31-12-34:~$
```

### Or use the AWS browser terminal

1. Select the instance and choose **Connect**.
2. Choose **EC2 Instance Connect → Connect using a Public IP**.
3. Confirm username `ubuntu`, then choose **Connect**.

If unavailable, use SSH. EC2 Instance Connect can require an AWS-managed prefix
list for port 22; do not solve that by opening SSH to `Anywhere`. See the
[AWS connection guide](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-connect-methods.html).

All remaining terminal commands run on EC2, not on your own computer.

## 3. Install prerequisites

```bash
sudo apt-get update
sudo apt-get upgrade -y
sudo apt-get install -y curl ca-certificates postgresql postgresql-contrib
sudo systemctl enable --now postgresql
```

Install Node.js 22, SeqDesk, and PM2:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g seqdesk pm2
```

Verify them:

```bash
node --version
npm --version
psql --version
seqdesk --help
```

Expect Node.js `v22.13.0` or newer on the 22.x line, a PostgreSQL version, and
SeqDesk help. Stop if a command reports `command not found`.

## 4. Install SeqDesk

Replace the example with the EC2 public address:

```bash
export SEQDESK_PUBLIC_IP="203.0.113.10"
printf 'SeqDesk URL will be http://%s:8000\n' "$SEQDESK_PUBLIC_IP"
```

Run the guided install with pipeline support:

```bash
seqdesk \
  --interactive \
  --dir /home/ubuntu/seqdesk \
  --port 8000 \
  --nextauth-url "http://${SEQDESK_PUBLIC_IP}:8000" \
  --with-pipelines \
  --use-pm2 \
  --run-doctor
```

For UI only, replace `--with-pipelines` with `--without-pipelines`; the Slurm
sections will then not apply.

Answer the prompts as follows:

1. For **Database — where should SeqDesk store its data?**, enter `1` for local
   PostgreSQL. PostgreSQL stays private on this instance.
2. Enter an administrator email and a strong test password. If the installer
   generates a password, save it immediately because it is shown once.
3. Create a researcher account if you want to test both roles.
4. Accept app port `8000`.
5. At the review screen confirm:
   - `/home/ubuntu/seqdesk`
   - port `8000`
   - `http://PUBLIC_IP:8000`
   - pipelines enabled
6. Continue only if those values are correct.

The installer downloads SeqDesk, creates the database, installs Conda/Nextflow,
starts PM2, and runs health checks. Do not close the terminal. At the end note
the printed **Browser URL**, **Install directory**, and **Log**.

## 5. Enable startup after reboot

```bash
pm2 status
pm2 startup
```

The `seqdesk` row should be `online`. PM2 prints a command beginning with
`sudo env ... pm2 startup`. Copy and run that complete command on this EC2
instance, then save the process list:

```bash
pm2 save
```

## 6. Verify the application

```bash
seqdesk doctor --dir /home/ubuntu/seqdesk --url http://127.0.0.1:8000
curl -fsS http://127.0.0.1:8000/api/setup/status
```

The doctor should confirm the files, configuration, PostgreSQL, authentication,
and HTTP endpoint. Fix failures before proceeding.

Useful commands:

```bash
pm2 status
pm2 logs seqdesk --lines 100
pm2 restart seqdesk
```

Press `Ctrl+C` to leave live logs without stopping SeqDesk.

## 7. Open and navigate the UI

1. On your own computer, open the printed URL, for example:

   ```text
   http://203.0.113.10:8000
   ```

2. Sign in with the administrator account.
3. A browser may label this HTTP page not secure. This is why access is limited
   to your IP and this setup is only for testing.
4. Choose **Settings → Infrastructure → Open Data Storage** and test that the
   sequencing directory is writable.
5. Return to **Settings → Infrastructure → Open Pipeline Runtime**. Conda and
   run-directory checks should pass. Leave **Use SLURM** off for now.
6. Choose **Settings → Info**. Under **Demo data**, turn **Load dummy data** on
   if you want small synthetic orders and FASTQ files for testing.

The application is now usable. Continue only if you also want the Slurm smoke
test.

## 8. Optional one-node Slurm smoke test

This installs controller, submit client, and compute daemon on the same EC2
instance. It tests SeqDesk's scheduler integration but does not add capacity.
[SchedMD's quick start](https://slurm.schedmd.com/quickstart_admin.html) likewise
describes a one-node controller/compute arrangement as a test.

Continue only with `t3.large` and `--with-pipelines`.

### Install and configure Slurm

```bash
sudo apt-get update
sudo apt-get install -y slurm-wlm munge
sudo systemctl enable --now munge
```

Generate the node line from the EC2 hardware and write a minimal configuration:

```bash
SLURM_NODE="$(hostname -s)"
SLURM_NODE_CONFIG="$(slurmd -C | sed -n '1p')"

{
  printf 'ClusterName=seqdesk\n'
  printf 'SlurmctldHost=%s\n' "$SLURM_NODE"
  printf 'SlurmUser=slurm\n'
  printf 'AuthType=auth/munge\n'
  printf 'MpiDefault=none\n'
  printf 'ProctrackType=proctrack/linuxproc\n'
  printf 'ReturnToService=2\n'
  printf 'SchedulerType=sched/backfill\n'
  printf 'SelectType=select/cons_tres\n'
  printf 'SelectTypeParameters=CR_Core_Memory\n'
  printf 'StateSaveLocation=/var/spool/slurmctld\n'
  printf 'SlurmdSpoolDir=/var/spool/slurmd\n'
  printf 'SlurmctldPidFile=/run/slurmctld.pid\n'
  printf 'SlurmdPidFile=/run/slurmd.pid\n'
  printf '%s State=UNKNOWN\n' "$SLURM_NODE_CONFIG"
  printf 'PartitionName=cpu Nodes=%s Default=YES MaxTime=INFINITE State=UP\n' "$SLURM_NODE"
} | sudo tee /etc/slurm/slurm.conf >/dev/null
```

Start the services:

```bash
sudo install -d -o slurm -g slurm /var/spool/slurmctld
sudo install -d -o root -g root /var/spool/slurmd
sudo systemctl enable --now slurmctld slurmd
sudo systemctl restart slurmctld slurmd
```

Verify one idle node and submit a short job:

```bash
sinfo
scontrol show node "$(hostname -s)"
SLURM_TEST_JOB="$(sbatch --parsable --partition=cpu --cpus-per-task=1 --mem=256M --wrap='hostname; sleep 10')"
printf 'Submitted Slurm job %s\n' "$SLURM_TEST_JOB"
squeue -j "$SLURM_TEST_JOB"
```

`sinfo` should show partition `cpu` with one `idle` node. The test job briefly
appears as pending/running and then disappears.

### Prevent nested-job deadlock on one node

On a real cluster Nextflow submits Slurm jobs per process. On one node, the outer
SeqDesk job can reserve resources while nested jobs wait for them. Use one
allocation for this smoke test and persist it in PM2:

```bash
export SEQDESK_SLURM_INLINE_EXECUTOR=1
pm2 restart seqdesk --update-env
pm2 save
```

Do not use this setting on a real multi-node cluster.

### Enable Slurm in the UI

1. Choose **Settings → Infrastructure → Open Pipeline Runtime**.
2. Turn **Use SLURM** on and choose **Test**. It should report available.
3. Set **Queue/Partition** to `cpu`.
4. Choose **Show** beside **Advanced Configuration** and enter:
   - CPU Cores: `2`
   - Memory: `6GB`
   - Time Limit: `2` hours
   - Additional SLURM Options: blank
   - Nextflow Profile Override: blank
5. Choose **Save Runtime Settings** and wait for **Saved!**.

Do not save Slurm as the default if **Test** fails.

### Run FASTQ Checksum through Slurm

1. Choose **Settings → Pipelines → Installed** and confirm **FASTQ Checksum** is
   installed and **Enabled**. If under **Available**, choose **Install**, then
   **Enable**.
2. Under **Settings → Info**, turn **Load dummy data** on if needed.
3. Choose **Sequencing Orders** and open the seeded submitted order with reads.
4. Choose **FASTQ Checksum** in the order pipeline navigation.
5. Under **Execution Target**, choose **SLURM**.
6. Choose **Run All Ready** and confirm any raw-read warning.
7. Watch queued → running → completed. R1/R2 checksum prefixes should appear.

In the EC2 terminal you can also run:

```bash
squeue
pm2 logs seqdesk --lines 100
```

The checksum test may finish before `squeue` refreshes. SeqDesk's run details
and logs are the final verification.

## Moving to a real AWS Slurm cluster

Use an established deployment such as
[AWS ParallelCluster](https://docs.aws.amazon.com/parallelcluster/latest/ug/tutorials-running-your-first-job-on-version-3.html)
instead of manually adding nodes to the smoke-test configuration.

SeqDesk requires all of the following:

1. Run SeqDesk on the submit/head node, or where `sbatch`, `squeue`, `sacct`, and
   `scancel` work.
2. Mount sequencing data and the pipeline run directory at identical absolute
   paths on every compute node (for example through EFS or FSx).
3. Make installed pipeline workflow paths visible at the same absolute paths on
   compute nodes. Installing SeqDesk under `/shared/seqdesk` is the simplest
   first arrangement; sharing only the run directory is insufficient.
4. Share the Conda installation and Nextflow cache at identical paths, or give
   compute nodes outbound access. A pre-populated shared cache is more reliable.
5. Use the same Unix identity and permissions across submit and compute nodes.
6. If weblog callbacks are enabled, compute nodes must reach the configured
   SeqDesk `/api/pipelines/weblog` URL; it cannot be `localhost` remotely.
7. Enter real queues, resources, shared paths, and optional weblog settings under
   **Settings → Infrastructure → Open Pipeline Runtime**.
8. Disable the one-node mode, restart, and save PM2:

   ```bash
   export SEQDESK_SLURM_INLINE_EXECUTOR=0
   pm2 restart seqdesk --update-env
   pm2 save
   ```

9. Use **Test** and a checksum run before a large analysis.

ParallelCluster can scale compute nodes down, but head-node and shared-storage
resources still cost money.

## Routine operations

### Status and restart

```bash
pm2 status
pm2 logs seqdesk --lines 200
seqdesk doctor --dir /home/ubuntu/seqdesk --url http://127.0.0.1:8000
pm2 restart seqdesk
```

### After stopping and starting

Copy the new EC2 public address, then run:

```bash
export SEQDESK_PUBLIC_IP="NEW_PUBLIC_IP"
seqdesk -y \
  --reconfigure \
  --dir /home/ubuntu/seqdesk \
  --nextauth-url "http://${SEQDESK_PUBLIC_IP}:8000"
pm2 restart seqdesk
```

Update both security-group rules with **My IP** if your own IP changed. A static
[Elastic IP](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/elastic-ip-addresses-eip.html)
avoids server-address changes but is charged.

Before using real data, implement and test PostgreSQL backups plus EBS/file
backups. Do not rely on one EBS volume as the only copy.

## Troubleshooting

### Browser cannot open port 8000

```bash
pm2 status
curl -v http://127.0.0.1:8000/api/setup/status
sudo ss -ltnp | grep ':8000'
```

If local `curl` works, open **EC2 → Security Groups → seqdesk-test-sg → Edit
inbound rules**. Port `8000` must use your current **My IP**. Save the rule; do
not change it to `Anywhere`. Use the public address, not an address beginning
with `10.`, `172.16`–`172.31`, or `192.168`.

### Installer fails

```bash
ls -1t /tmp/seqdesk-install-*.log | head -n 1
tail -n 100 /tmp/seqdesk-install-*.log
df -h
free -h
```

Remove credentials and tokens before sharing logs.

### PostgreSQL setup or sudo fails

Check the EC2 login identity, passwordless sudo, and local service before
re-running the installer:

```bash
whoami
sudo -n true
sudo systemctl status postgresql --no-pager
sudo pg_isready
sudo -u postgres psql -c 'select version();'
```

`whoami` should print `ubuntu`, `sudo -n true` should return without prompting,
and `pg_isready` should report that PostgreSQL accepts connections. If the
service is inactive, run:

```bash
sudo systemctl enable --now postgresql
```

Do not run the complete SeqDesk installer as `root`; files and PM2 processes
should belong to `ubuntu`. The installer needs sudo when it prepares the local
PostgreSQL role and database. If your organization removes passwordless sudo,
have an administrator prepare PostgreSQL first or use a managed PostgreSQL
database and provide its database URLs through the guided installer.

### Conda or pipeline setup fails

Pipeline setup needs more disk, memory, and network access than the UI-only
install. Check the failed install log plus the host and environment:

```bash
df -h
free -h
/home/ubuntu/miniconda3/bin/conda env list
/home/ubuntu/miniconda3/bin/conda run -n seqdesk-pipelines java -version
/home/ubuntu/miniconda3/bin/conda run -n seqdesk-pipelines nextflow -version
```

Use at least the `t3.large` and 100 GiB configuration from this guide. If Conda
package downloads timed out, confirm the instance has outbound HTTPS access and
retry the idempotent pipeline configuration:

```bash
seqdesk -y \
  --reconfigure \
  --dir /home/ubuntu/seqdesk \
  --with-pipelines \
  --run-doctor
```

If the application is all you need, reconfigure with `--without-pipelines` and
leave the Slurm sections disabled.

### Slurm fails or jobs stay pending

```bash
sudo systemctl status munge slurmctld slurmd --no-pager
sudo journalctl -u munge -u slurmctld -u slurmd -n 100 --no-pager
squeue -o '%.18i %.9P %.20j %.2t %.10M %R'
sinfo -N -l
scontrol show job JOB_ID
```

Compare `hostname -s` with `SlurmctldHost`, `NodeName`, and `PartitionName` in
`/etc/slurm/slurm.conf`. If a job reports `Resources`, reduce CPU/memory in
**Pipeline Runtime**. This test uses `2` cores and `6GB`.

If a one-node pipeline queues but internal work never starts:

```bash
export SEQDESK_SLURM_INLINE_EXECUTOR=1
pm2 restart seqdesk --update-env
pm2 save
```

## Stop or delete the test

To keep it, select the instance and choose **Instance state → Stop instance**.
Compute billing stops, but EBS still costs money, as does an Elastic IP attached
to a stopped instance. The automatic public address is released and normally
changes when restarted.

To delete it permanently:

1. Export or snapshot anything needed; termination is destructive.
2. Choose **Instance state → Terminate (delete) instance** and confirm.
3. Check **EC2 → Volumes** for volumes configured to survive termination.
4. Disassociate and release any Elastic IP.
5. Remove `seqdesk-test-sg` and the `seqdesk-test-key` AWS record if unused.

See AWS's [stop/start behavior](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/how-ec2-instance-stop-start-works.html)
for details.

## Related SeqDesk documentation

- [SeqDesk user and operator guide](https://seqdesk.org/docs)
- [General installation guide](https://seqdesk.org/docs/installation)
- [Manual install checklist](https://github.com/hzi-bifo/SeqDesk/blob/main/npm/seqdesk/MANUAL_INSTALL.md)
