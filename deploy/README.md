# Tattoo Drip on one server

The owner's runbook for the production server: set it up, start it, update it, back it up, restore it, and find out what is wrong when something breaks. Every step has the exact command and what you should see. It holds no secrets.

Read the rules this follows in [Deploying the platform](../apps/platform/docs/deploy.md). The design is in [the spec](../docs/superpowers/specs/2026-10-31-single-server-deploy-design.md).

## What runs where

```
visitor --https--> Cloudflare (DNS, TLS, Always Use HTTPS)
                      |  Cloudflare Tunnel (the server connects out; no web ports open)
                      v
              the server (Docker Compose, project tattoo-drip-prod)
              cloudflared --> nginx --+--> web        (the dashboard and API, :3333)
                                      +--> storefront (the studio pages, :3000)
              worker (alerts, quote expiry, queue)
              postgres 18 (not reachable from outside)
              backup (a job started by systemd every night)
web, worker --> R2 buckets tattoo-drip-public (media.tattoodrip.app) and tattoo-drip-private
backup      --> R2 bucket  tattoo-drip-backups
```

| Name | Goes to |
|---|---|
| `tattoodrip.app` | The dashboard and the API |
| `media.tattoodrip.app` | The public R2 bucket (public photos) |
| `tattoodrip.page`, `*.tattoodrip.page` | The studio pages |

| Where | What |
|---|---|
| `/srv/tattoo-drip/app` | The git clone of the repo (read-only deploy key). Never edit files in it. |
| `/srv/tattoo-drip/env` | The six settings files, `postgres.env` `platform.env` `migrate.env` `storefront.env` `backup.env` `tunnel.env`. Folder mode 700, files mode 600. |
| `/srv/tattoo-drip/restore` | Downloaded backups, only while you restore. They hold clients' data: delete them afterwards. |
| Docker volume `tattoo-drip-prod_postgres_data` | The database. |
| R2 `tattoo-drip-backups/db` | Last 30 nightly dumps. |

## How to use this page

- Commands run on the server, logged in as `haru`, unless a step says "on your computer". If you chose another user name, use it instead of `haru` everywhere.
- `<server-ip>`, `<slug>` and similar in angle brackets are for you to replace. Nothing else needs editing.
- Every `docker compose` command spells out the compose file's path, so it works from any folder.
- A step ends with **You should see** when there is something to compare. If you see something else, stop and look at [When something is wrong](#8-when-something-is-wrong).
- Never paste the contents of a settings file into a chat, an issue or a commit. When this page says "put it in `platform.env`", you open the file on the server and paste the value there.
- Section 4 has the checks for deploy day.
- The server deploys only what is merged to `main`. Merge first, then run the deploy command.

If you followed the setup in chat on 2026-11-01, these are done: sections 1.1 to 1.11 (server, SSH, firewall, updates, Docker, swap, folders, deploy key, clone) and 3.2 (the three R2 buckets and `media.tattoodrip.app`). Run the quick check in 1.12, then start at section 2. Its first step updates the clone: it was made before the `deploy/` folder was merged to `main`, so it does not have the settings templates yet.

---

## 1. Server

The server is a Hostinger VPS (KVM 2: 2 vCPU, 8 GB memory, 100 GB disk) with Ubuntu 26.04 LTS and no control panel. Any other provider with a plain Ubuntu LTS works the same; skip the hPanel parts.

### 1.1 Log in as root with an SSH key

On your computer, make a key (if you have none for this server) and print the public half:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/tattoo_drip_vps -C "tattoo drip vps"
cat ~/.ssh/tattoo_drip_vps.pub
```

In Hostinger's hPanel, open the VPS and add that one line under **SSH keys**. Note the server's IP address on the VPS page. Then log in:

```bash
ssh -i ~/.ssh/tattoo_drip_vps root@<server-ip>
```

**You should see:** a question about the host key the first time (answer `yes`), then a root prompt on the server.

### 1.2 Update the system

As root:

```bash
apt update && apt full-upgrade -y
[ -f /var/run/reboot-required ] && echo "restart needed" || echo "no restart needed"
```

If it says "restart needed", run `reboot`, wait a minute and log in again as in 1.1.

### 1.3 Your own user

As root:

```bash
adduser haru
usermod -aG sudo haru
rsync --archive --chown=haru:haru ~/.ssh /home/haru
```

`adduser` asks for a password (you need it for `sudo`) and some optional details (press Enter). The last line gives `haru` the same SSH key.

### 1.4 Test the new user before you lock anything

Keep the root session open. On your computer, in a second terminal:

```bash
ssh -i ~/.ssh/tattoo_drip_vps haru@<server-ip>
sudo whoami
```

**You should see:** `root` after you type haru's password. If this does not work, fix it now, while the root session is still open.

### 1.5 Allow SSH keys only

As `haru`:

```bash
sudo tee /etc/ssh/sshd_config.d/01-hardening.conf >/dev/null <<'EOF'
PasswordAuthentication no
PermitRootLogin no
EOF
sudo sshd -t && sudo systemctl restart ssh
sudo sshd -T | grep -E '^(passwordauthentication|permitrootlogin)'
```

The file is called `01-` on purpose: sshd keeps the first value it reads, and Hostinger's image ships `50-cloud-init.conf` with `PasswordAuthentication yes`, which would win over a `99-` file.

**You should see:** these two lines, in either order:

```
passwordauthentication no
permitrootlogin no
```

Before you close anything, open a **new** terminal on your computer and log in as `haru` again, from scratch:

```bash
ssh -i ~/.ssh/tattoo_drip_vps haru@<server-ip>
```

**You should see:** a prompt on the server. A session that was already open survives the restart and proves nothing; only a new login shows that you can still get in. If it fails, fix it from a session you still have open (`sudo rm /etc/ssh/sshd_config.d/01-hardening.conf && sudo systemctl restart ssh` undoes this step).

Then check that a password login is refused, and close the root session:

```bash
ssh -o PubkeyAuthentication=no -o PreferredAuthentications=password haru@<server-ip>
```

**You should see:** `Permission denied (publickey).`

### 1.6 Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw enable
sudo ufw status
```

`sudo ufw enable` warns that it "may disrupt existing ssh connections" and asks to proceed: answer `y`. The rule you just added allows SSH, so your session stays up.

**You should see:** `Status: active` and `OpenSSH ALLOW` (port 22). Nothing else is allowed in. Again, before you go on, open a **new** terminal on your computer and log in with `ssh -i ~/.ssh/tattoo_drip_vps haru@<server-ip>`. If it fails, run `sudo ufw disable` in the session you still have, and look at `sudo ufw status` again. The site needs no open port: Cloudflare's tunnel connects out from the server. (Docker changes the firewall itself for ports it publishes, and ufw does not see them. This stack publishes none.) If hPanel has its own firewall switched on, it must allow SSH.

### 1.7 Automatic security updates

```bash
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
cat /etc/apt/apt.conf.d/20auto-upgrades
```

Answer **Yes**. **You should see:** both lines ending in `"1";`.

This installs security updates but does not restart the server. About once a month, and whenever `cat /var/run/reboot-required` prints something, restart at a quiet hour with `sudo reboot` (everything comes back by itself, see 4.10). Docker itself comes from Docker's own repository and is not updated automatically: `sudo apt update && sudo apt upgrade` once a month does it.

Leave the server's clock on UTC (`timedatectl` shows it). Logs are in UTC; the backup timer names Nepal time itself.

### 1.8 Docker

Docker Engine from Docker's own apt repository:

```bash
sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Signed-By: /etc/apt/keyrings/docker.asc
EOF
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker haru
```

Log out and back in (the group only applies to a new login), then:

```bash
docker run --rm hello-world
docker compose version
systemctl is-enabled docker
```

**You should see:** "Hello from Docker!", a Compose version line, and `enabled` (Docker starts at boot).

### 1.9 Swap

A safety net for the build, which is the heaviest thing the server does:

```bash
free -h
```

If the `Swap:` line shows `0B`, add 2 GB:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h
```

**You should see:** `Swap:` with `2.0Gi`.

### 1.10 Folders

```bash
sudo mkdir -p /srv/tattoo-drip/env
sudo chown -R haru:haru /srv/tattoo-drip
chmod 700 /srv/tattoo-drip/env
ls -ld /srv/tattoo-drip /srv/tattoo-drip/env
```

**You should see:** both owned by `haru`, the `env` folder as `drwx------`.

### 1.11 A read-only key for GitHub, and the clone

The server pulls the code with a key that can only read:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/github_deploy -N "" -C "tattoo-drip server"
cat ~/.ssh/github_deploy.pub
```

On GitHub open the repo `harublank0-0/tattoo-drip`, then Settings, Deploy keys, Add deploy key. Title it `tattoo-drip server`, paste the line, and leave "Allow write access" unticked.

Tell SSH to use that key for GitHub:

```bash
cat >> ~/.ssh/config <<'EOF'
Host github.com
    IdentityFile ~/.ssh/github_deploy
    IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config
git clone git@github.com:harublank0-0/tattoo-drip.git /srv/tattoo-drip/app
```

The first time, SSH asks whether to trust github.com and shows a fingerprint. It must be this one (GitHub publishes it in its documentation):

```
SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU
```

If it matches, type `yes`. If not, answer `no` and stop.

**You should see:** the clone finishing, and `git -C /srv/tattoo-drip/app log -1 --oneline` printing the latest commit.

### 1.12 Quick check of the whole server

Also a good thing to run after a long break:

```bash
sudo sshd -T | grep -E '^(passwordauthentication|permitrootlogin)'
sudo ufw status | head -1
docker --version && docker compose version
free -h | grep -i swap
ls -ld /srv/tattoo-drip/env
git -C /srv/tattoo-drip/app log -1 --oneline
```

**You should see:** `no` for both SSH settings, `Status: active`, the two Docker versions, a swap line of about 2 GB, the env folder as `drwx------ ... haru haru`, and a commit.

---

## 2. Settings files

Each part of the stack reads its own file from `/srv/tattoo-drip/env`. The templates are in `deploy/env/*.env.example`; they carry a comment for every setting. A value that still says `CHANGE_ME` is yours to fill in, and `deploy.sh` refuses to start while any is left.

### 2.1 Update the clone and make the six files

The clone on the server was made before the `deploy/` folder was merged, so bring it up to date first (only before the first deploy; after that `deploy.sh` does it):

```bash
git -C /srv/tattoo-drip/app pull --ff-only
ls /srv/tattoo-drip/app/deploy/env
```

**You should see:** the six `*.env.example` templates. If `ls` says there is no such folder, the work is not merged to `main` yet: stop and merge it first.

Then make the files. The loop never overwrites a file that exists, so running it again is safe:

```bash
for name in postgres platform migrate storefront backup tunnel; do
  if [ -e /srv/tattoo-drip/env/$name.env ]; then
    echo "$name.env exists, skipped"
  else
    install -m 600 /srv/tattoo-drip/app/deploy/env/$name.env.example /srv/tattoo-drip/env/$name.env
    echo "$name.env created"
  fi
done
ls -l /srv/tattoo-drip/env
```

`install -m 600` makes each file readable by you alone from the start.

**You should see:** `... created` six times (on a second run, `... exists, skipped`), then six files, each `-rw-------` and owned by `haru`.

### 2.2 Make the secrets you generate yourself

Some values must be the same in two or three files: the database owner's password (`postgres.env`, `migrate.env`, `backup.env`), the app role's password (`postgres.env`, `platform.env`) and the storefront's key (`platform.env`, `storefront.env`). This block makes each one once and writes it to every file, so you never type a secret and the copies cannot differ. Run it once, right after 2.1 made the files. It only replaces a `CHANGE_ME`, so a second run changes nothing in a file that is filled in; but never use it to repair one file (for example after deleting it): that file would get a password the other files and the existing database do not have.

```bash
cd /srv/tattoo-drip/env
owner_pw=$(openssl rand -hex 32)
app_pw=$(openssl rand -hex 32)
store_key=$(openssl rand -hex 32)
sed -i "s|^POSTGRES_PASSWORD=CHANGE_ME$|POSTGRES_PASSWORD=$owner_pw|; s|^APP_DB_PASSWORD=CHANGE_ME$|APP_DB_PASSWORD=$app_pw|" postgres.env
sed -i "s|^DB_MIGRATION_PASSWORD=CHANGE_ME$|DB_MIGRATION_PASSWORD=$owner_pw|" migrate.env
sed -i "s|^PGPASSWORD=CHANGE_ME$|PGPASSWORD=$owner_pw|" backup.env
sed -i "s|^APP_KEY=CHANGE_ME$|APP_KEY=$(openssl rand -hex 32)|; s|^DB_PASSWORD=CHANGE_ME$|DB_PASSWORD=$app_pw|; s|^STOREFRONT_SERVER_KEYS=CHANGE_ME$|STOREFRONT_SERVER_KEYS=$store_key|" platform.env
sed -i "s|^STOREFRONT_SERVER_KEY=CHANGE_ME$|STOREFRONT_SERVER_KEY=$store_key|" storefront.env
unset owner_pw app_pw store_key
```

Nothing is printed. Check that the generated lines are no longer placeholders. This lists the names of what is left, which at this point is only what Cloudflare gives you (the `cut` keeps values out of the output):

```bash
grep -n 'CHANGE_ME' /srv/tattoo-drip/env/*.env | grep -v ':[0-9]*:[[:space:]]*#' | cut -d= -f1
```

**You should see:** exactly these nine names, each as `<file>:<line number>:<name>` (the numbers can differ): `TURNSTILE_SECRET_KEY`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` in `platform.env`; `TUNNEL_TOKEN` in `tunnel.env`; `TURNSTILE_SITE_KEY` in `storefront.env`; and `RCLONE_CONFIG_R2_ACCESS_KEY_ID`, `RCLONE_CONFIG_R2_SECRET_ACCESS_KEY` and `RCLONE_CONFIG_R2_ENDPOINT` in `backup.env`. No `APP_KEY`, no password, no `STOREFRONT_SERVER_KEY` line.

About the keys this made:

- Passwords and the storefront's key are `openssl rand -hex 32`: 64 hex characters, so no quoting problems in a settings file.
- `APP_KEY` signs the dashboard's cookies and the deposit links. It is the same `openssl rand -hex 32` form. The platform accepts any string of 16 or more characters (the encryption library checks the length when the key is first used), and `node ace generate:key --show` itself prints a random 32-character string of letters, digits, `-` and `_`. The `ace` command needs the platform image, and that image is built only by the first deploy, which refuses to run before the settings exist. So this page uses `openssl`.
- Changing `APP_KEY` later signs everyone out and breaks every deposit link already handed out. Keep it (see 2.4).

### 2.3 What the templates already have right

You change nothing else for production. For reference: `NODE_ENV=production`, `TZ=UTC`, `HOST=0.0.0.0`, `PORT=3333`, `APP_URL=https://tattoodrip.app`, `STOREFRONT_URL=https://{tenant}.tattoodrip.page` (keep `{tenant}` as it is), `TRUST_PROXY=172.30.42.10` (nginx's address inside the Docker network), `SESSION_DRIVER=cookie`, the database host `postgres` and the names `tattoo_drip` and `tattoo_drip_app`, the bucket names and `R2_PUBLIC_URL=https://media.tattoodrip.app`, `ALERT_EMAILS=false`, and placeholder `MAIL_*` / `SMTP_*` values until email exists (TAT-20). The storefront's `API_URL` is `https://tattoodrip.app`.

### 2.4 Editing a value with nano

```bash
nano /srv/tattoo-drip/env/platform.env
```

Press Ctrl+W, type `CHANGE_ME`, Enter, to jump to the next placeholder. Delete `CHANGE_ME` and paste the value in its place (right-click in most terminals). Paste only the value: no quotes, no spaces, nothing after it. Ctrl+O then Enter saves; Ctrl+X leaves.

Keep a copy of all six files in your password manager once they are complete (section 4.12 asks for it). They are not in git and not in the backups, and a rebuilt server needs them, `APP_KEY` above all. On your computer:

```bash
mkdir -m 700 ~/tattoo-drip-env
scp -i ~/.ssh/tattoo_drip_vps 'haru@<server-ip>:/srv/tattoo-drip/env/*.env' ~/tattoo-drip-env/
```

Attach the six files in the manager (or paste each file's text into a secure note), then delete the copies on your computer: `rm -r ~/tattoo-drip-env`.

---

## 3. Cloudflare

Both domains were bought on Cloudflare Registrar, so their DNS is already on Cloudflare. The dashboard (dash.cloudflare.com) changes its labels now and then; each step says what you are looking for and where the result goes. Do these in order. Each secret goes straight into its settings file (2.4); if you lose one before pasting it, delete that token and make a new one.

### 3.1 Your account ID

In the dashboard, open **R2 Object Storage**. The overview shows the **Account ID**: 32 lowercase letters and digits. You need it twice:

- Put it in `platform.env` as `R2_ACCOUNT_ID`.
- Put it in `backup.env` in place of `CHANGE_ME` in `RCLONE_CONFIG_R2_ENDPOINT=https://CHANGE_ME.r2.cloudflarestorage.com`. The line must stay a full URL.

### 3.2 The three buckets and the media domain

Done if you followed the chat setup. In **R2 Object Storage**, the buckets:

| Bucket | Public access | Location hint |
|---|---|---|
| `tattoo-drip-public` | custom domain `media.tattoodrip.app` | Asia-Pacific |
| `tattoo-drip-private` | none | Asia-Pacific |
| `tattoo-drip-backups` | none | Asia-Pacific |

On `tattoo-drip-public`, under its settings, connect the custom domain `media.tattoodrip.app` and wait for its status to say active. Leave the `r2.dev` public address off, and give the other two buckets no public access and no custom domain.

### 3.3 The token for the photos

In **R2 Object Storage**, open **Manage API tokens** (under the account details or API menu) and create a token:

- Name: `tattoo-drip-images`.
- Permission: **Object Read & Write**.
- Apply to specific buckets only: `tattoo-drip-public` and `tattoo-drip-private`.

The page that follows shows an **Access Key ID** and a **Secret Access Key** once. (It also shows a "token value"; you do not need that.) Put them in `platform.env`:

- Access Key ID as `R2_ACCESS_KEY_ID`
- Secret Access Key as `R2_SECRET_ACCESS_KEY`

### 3.4 The token for the backups

Create a second token the same way:

- Name: `tattoo-drip-backups`.
- Permission: **Object Read & Write** (the nightly job also deletes dumps older than 30 days).
- Apply to specific buckets only: `tattoo-drip-backups`.

Put its two values in `backup.env`:

- Access Key ID as `RCLONE_CONFIG_R2_ACCESS_KEY_ID`
- Secret Access Key as `RCLONE_CONFIG_R2_SECRET_ACCESS_KEY`

Two tokens on purpose: a leaked photos token cannot touch the backups.

### 3.5 Turnstile (the bot check on the request form)

In the dashboard open **Turnstile** and add a widget:

- Name: for example `tattoo-drip studio pages`.
- Hostname: `tattoodrip.page`. Cloudflare lets a widget work on the subdomains of a listed hostname, which covers every `<slug>.tattoodrip.page`.
- Widget mode: **Managed**.

Cloudflare then shows a **Site Key** and a **Secret Key**:

- Site Key (public, sent to every visitor) as `TURNSTILE_SITE_KEY` in `storefront.env`
- Secret Key as `TURNSTILE_SECRET_KEY` in `platform.env`

### 3.6 The tunnel

In the dashboard open **Zero Trust** (Cloudflare One). The first time it asks you to pick a team name and the Free plan; it may ask for a payment method, and the Free plan costs nothing. Then open **Networks**, **Tunnels**, create a tunnel of the **Cloudflared** type and name it `tattoo-drip`.

The next page shows install commands for several systems. You install nothing there. Copy the **token**: the long string after `--token` (or after `service install`) in the command shown, usually starting with `eyJ`. Put it in `tunnel.env` as `TUNNEL_TOKEN`.

Then add three public hostnames to the tunnel (the list is called Public Hostnames, or Published application routes in newer dashboards). All three use service type **HTTP** and the URL `172.30.42.10:80` (nginx's fixed address inside the Docker network):

| Subdomain | Domain |
|---|---|
| (empty) | `tattoodrip.app` |
| (empty) | `tattoodrip.page` |
| `*` | `tattoodrip.page` |

Do not add `media.tattoodrip.app` here: R2 serves that one.

Cloudflare adds the DNS records for these itself. If it says a record already exists, open that domain's **DNS** page and delete only the A, AAAA or CNAME record that has exactly that name (for example a parking page's), then add the hostname again. Never touch the `media` record of `tattoodrip.app`: R2 manages it. If it does not add the wildcard record, add it by hand under that domain's **DNS**: type CNAME, name `*`, target `<tunnel id>.cfargotunnel.com` (the tunnel's ID is on its page), proxied (orange cloud).

The tunnel shows as inactive until the server runs `cloudflared` (4.3).

### 3.7 Always Use HTTPS

For each of the two domains, open the domain, then **SSL/TLS**, **Edge Certificates**, and switch **Always Use HTTPS** on. Cloudflare's free certificate covers each domain and its first-level wildcard (`*.tattoodrip.page`), and `.app` and `.page` are HTTPS-only in browsers anyway.

### 3.8 Optional: one rate-limiting rule

The free plan allows one. The app already limits requests per address by itself (see deploy.md, "What the app does itself"), so this is an outer layer, not a need. If you add one, aim it at the sign-in pages only: host `tattoodrip.app`, path starting with `/login`, `/signup` or `/forgot-password`, counted per address, with the longest period and block time the free plan offers. Do not aim it at `/api/`: the studio pages call the API from the server's own address, and Cloudflare would count all their visitors as one.

### 3.9 Everything from Cloudflare is in

```bash
grep -n 'CHANGE_ME' /srv/tattoo-drip/env/*.env | grep -v ':[0-9]*:[[:space:]]*#' | cut -d= -f1
```

**You should see:** nothing. (A commented-out `HEARTBEAT_URL` line in `backup.env` is fine: 6.2 deals with it.)

---

## 4. First start

### 4.1 On your computer: the storefront page check

From your copy of the repo, with Node 24.3.0 (`.nvmrc`) and pnpm, on an up-to-date `main` (the merged commit that you are about to deploy):

```bash
git switch main && git pull --ff-only
cd apps/storefront
pnpm build
pnpm check:page
```

**You should see:** it ends without an error (about ten seconds). It starts the built storefront against a stand-in API and checks what a page sends and leaks.

### 4.2 On the server: no placeholder left

Run the `grep` of 3.9 again. **You should see:** nothing.

### 4.3 Deploy

```bash
/srv/tattoo-drip/app/deploy/deploy.sh
```

This is the same command for every later update. It refuses to start while the checkout has local changes or a settings file is missing, unreadable or unfinished, and says which file and variable, before it changes anything. Then it fetches `origin/main`, builds the images, starts Postgres (which creates the database and the restricted app role on its first start), runs the migrations, starts the services, waits for web and storefront to be healthy and reloads nginx.

The first build downloads every dependency and can take 5 to 15 minutes; later ones are faster. Lines that begin with `deploy:` say which step it is on.

**You should see:** it ends with the list of containers and the line `deployed <short commit>`. If it stops with a failure, it says what state that leaves and names the commit to go back to; see section 8.

### 4.4 Look at what is running

```bash
docker compose -f /srv/tattoo-drip/app/deploy/compose.yml ps
```

**You should see** six lines. `postgres`, `web` and `storefront` say `Up ... (healthy)`; `worker`, `nginx` and `cloudflared` say `Up`. Anything saying `Restarting` is crashing: `docker compose -f /srv/tattoo-drip/app/deploy/compose.yml logs --tail 50 <name>` says why.

### 4.5 The tunnel and the site

```bash
docker compose -f /srv/tattoo-drip/app/deploy/compose.yml logs --tail 20 cloudflared
```

**You should see:** `Registered tunnel connection` lines, and in the Cloudflare dashboard the tunnel as Healthy.

Then, from your computer:

```bash
curl -sI http://tattoodrip.app/login | grep -i -E '^(HTTP|location)'
curl -sI https://tattoodrip.app/login | head -1
curl -s -o /dev/null -w '%{http_code}\n' https://tattoodrip.page/
curl -s -o /dev/null -w '%{http_code}\n' https://nosuch.tattoodrip.page/
```

**You should see:** the first, a redirect (`301`) with `location: https://tattoodrip.app/login`; the second, `HTTP/2 200`; the third, `200` (the landing page for a host with no studio); the fourth, `404` (a studio that does not exist).

### 4.6 The pilot's account

1. Open `https://tattoodrip.app/signup` and sign up with the pilot owner's email address. Email is off, so no confirmation mail arrives. (The worker logs "Sending email failed." for it; that is expected until TAT-20.)
2. Check who is asking, in person or by phone. This command skips the proof the emailed link would give.
3. On the server:

```bash
docker compose -f /srv/tattoo-drip/app/deploy/compose.yml --profile tools run --rm migrate node ace.js account:verify <email>
```

**You should see:** `Confirmed. The account can now set up a studio.` (`That address is already confirmed.` if it was done before; `No account uses that address.` for a typo.)

Then the pilot signs in and creates the studio.

### 4.7 The checks from deploy.md, and the photos

With a studio created (its address is `https://<slug>.tattoodrip.page`):

1. **Sign-in cookie.** Sign in at `https://tattoodrip.app`. In the browser's DevTools, Application, Cookies, `__Host-td-session` shows Secure, HttpOnly, SameSite Lax and an empty Domain.
2. **Studio page.** Open `https://<slug>.tattoodrip.page`. Then:

   ```bash
   docker compose -f /srv/tattoo-drip/app/deploy/compose.yml logs web | grep -E 'server key this API does not accept|no usable X-Visitor-IP'
   ```

   **You should see:** nothing. A line here means the storefront's key or the visitor's address is not reaching the API.
3. **The API's answers.**

   ```bash
   curl -sI https://tattoodrip.app/api/v1/tenants/<slug> | grep -i -E '^(HTTP|cache-control|x-ratelimit|cf-cache-status|age)'
   curl -sI -H 'Cache-Control: no-cache' https://tattoodrip.app/api/v1/tenants/<slug> | grep -i -E '^(HTTP|cf-cache-status|age)'
   ```

   **You should see:** `200`, `cache-control: public...`, no `x-ratelimit` header, and in both answers no `age` header and a `cf-cache-status` of `DYNAMIC` or `BYPASS`, never `HIT`. (Cloudflare does not store JSON unless told to; if you ever see `HIT`, add the cache rule deploy.md describes.)
4. **A public photo.** In the dashboard add a work photo to an artist. On the studio page right-click it and copy the image address; it starts with `https://media.tattoodrip.app/tenants/`.

   ```bash
   curl -sI '<photo address>' | grep -i -E '^(HTTP|cache-control|content-type)'
   ```

   **You should see:** `200`, `cache-control: no-cache` and an `image/` content type. Now remove the photo in the dashboard and repeat the same command: **you should see** `404` at once.
5. **A private photo.** On the studio page send a request that includes a reference photo (the request form passes Turnstile on the way). Open it in the dashboard, right-click the reference image and copy the image address. It is a long signed address on `r2.cloudflarestorage.com`. Keep the quotes, it holds `&` signs:

   ```bash
   curl -s -o /dev/null -D - '<signed address>' | grep -i -E '^(HTTP|cache-control)'
   ```

   **You should see:** `200` and `cache-control: private, no-store`. Run it again after 6 minutes: it is no longer `200` (the link lasts 5 minutes). Use `-D -` and not `-I`: a signed address works for the GET it was made for, not for HEAD.
6. **The deposit link.** Open a project's deposit link ("Copy link") on a phone, sent through WhatsApp or Viber. Then:

   ```bash
   docker compose -f /srv/tattoo-drip/app/deploy/compose.yml logs nginx | grep -c '/deposits/'
   ```

   **You should see:** `0`. The deposit links carry a token, so nginx keeps them out of its log.

### 4.8 The visitor's address cannot be faked

From your computer, send a made-up address to both apps, and look up your own:

```bash
curl -4 -s -o /dev/null -H 'X-Forwarded-For: 203.0.113.9' https://tattoodrip.app/login
curl -4 -s -o /dev/null -H 'X-Forwarded-For: 203.0.113.9' https://<slug>.tattoodrip.page/
curl -4 -s https://ifconfig.me; echo
```

On the server:

```bash
docker compose -f /srv/tattoo-drip/app/deploy/compose.yml logs --tail 200 nginx | grep -E '"GET /(login)? HTTP' | tail -n 6
```

**You should see:** the two requests you just made (`GET /login` and `GET /`) show your own address, the one `ifconfig.me` printed, right after the `|`, and `203.0.113.9` is nowhere. (In the unfiltered log you will also see `GET /api/v1/...` lines that show the server's own public address: that is the storefront's server asking the API while it renders your page. They are not visitors.) nginx hands both apps exactly the address it logs here, as the only value of `X-Forwarded-For`. `deploy/test/nginx/run.sh` checks that part against stand-in apps.

### 4.9 Backups and a practice restore

Do sections 6 and 7.1 to 7.4 now. A backup that has never been restored is a hope, not a backup.

### 4.10 Reboot

```bash
sudo reboot
```

Wait two minutes, log in again, and run:

```bash
docker compose -f /srv/tattoo-drip/app/deploy/compose.yml ps
systemctl list-timers tattoo-drip-backup.timer
```

**You should see:** the same six containers up (the three with checks `healthy` after a minute), the timer listed with a next run, and the site answering again. Nothing was started by hand.

### 4.11 Nothing else answers

From your computer:

```bash
for port in 22 80 443 3333 3000 5432; do nc -z -w 5 <server-ip> $port && echo "port $port: OPEN" || echo "port $port: closed"; done
```

**You should see:** `OPEN` for port 22 only.

### 4.12 Deploy day is done when

- 4.3 to 4.8 gave what they should.
- A backup is in R2 and the heartbeat registered (6.4).
- A practice restore matched (7.3).
- The reboot test passed (4.10) and only port 22 answers (4.11).
- You have a copy of the six settings files in your password manager (2.4).

---

## 5. Updates

Merge the change to `main` on GitHub (the server pulls `origin/main`), then, at a quiet hour:

```bash
/srv/tattoo-drip/app/deploy/deploy.sh
```

It is the command of 4.3: build, migrate, restart. Pages can be slow while it builds and are down for a few seconds while the services restart. Pick a time when no studio is using the site, not around 02:00 Nepal time (the backup runs), and not while a restore is going.

**You should see:** `deployed <short commit>` at the end, and `docker compose ... ps` as in 4.4. Open the site to check.

If a step fails, `deploy.sh` says which one, what state that leaves (a failed build or migration leaves the old services running) and the command to go back.

**Going back:** the failure message names the previous commit; any earlier commit works the same way:

```bash
/srv/tattoo-drip/app/deploy/deploy.sh <previous commit>
```

This is safe because migrations are written to only add things (a rule of the project, not something the server checks): older code runs on the newer database. (`deploy.sh <ref>` also takes a tag or `origin/<branch>`.) A deploy runs the copy of `deploy.sh` it started with, so a change to the script itself takes effect from the next deploy.

**If a deploy changes `deploy/systemd`:** copy the two unit files again and reload (6.3).

**Never edit files in `/srv/tattoo-drip/app`.** `deploy.sh` refuses to run while the checkout has local changes. Make changes in the repo and deploy them.

### Changing a setting

Edit the file (2.4), then recreate the services that read it. The settings of `web` and `worker` are in `platform.env`:

```bash
docker compose -f /srv/tattoo-drip/app/deploy/compose.yml up -d --force-recreate web worker
docker compose -f /srv/tattoo-drip/app/deploy/compose.yml exec -T nginx nginx -c /etc/nginx/td/nginx.conf -s reload
```

The second command matters: nginx looks the apps up only when it starts or reloads, and a recreated container can have a new address. For the storefront use `storefront` in place of `web worker`. For the tunnel (`tunnel.env`) use `cloudflared`, and no reload. `postgres.env` only counts when the database is first created; changing it later changes nothing.

---

## 6. Backups

Every night at 02:00 Nepal time a job dumps the database (`pg_dump --format=custom`, as the owner role), reads the dump back to check it, copies it to `tattoo-drip-backups/db` in R2 as `tattoo_drip-<UTC time>.dump`, deletes dumps older than 30 days, and pings a heartbeat so you hear when a night is missed. A night the server was off runs at the next boot. Not backed up: the photos in R2 (R2 itself is durable; a bug that deletes files cannot be undone) and the settings files (keep your own copy, 2.4).

### 6.1 The heartbeat on healthchecks.io

Make a free account on healthchecks.io and add a check:

- Name: `tattoo-drip nightly backup`.
- Schedule: choose the **cron** option, expression `0 2 * * *`, time zone `Asia/Kathmandu`.
- Grace time: 2 hours (the job starts up to 5 minutes late and can take minutes).
- Make sure an email integration is on, so a missed or failed night reaches you.

The check page shows its **ping URL**, like `https://hc-ping.com/<long id>`. Copy it.

### 6.2 Put the URL in backup.env

```bash
nano /srv/tattoo-drip/env/backup.env
```

Find the line `# HEARTBEAT_URL=https://hc-ping.com/CHANGE_ME`. Remove the `# ` at its start and replace `https://hc-ping.com/CHANGE_ME` with your ping URL. Save. Without the line the job simply skips the ping. On a failure the job calls the same address with `/fail` added, which makes healthchecks.io email you at once.

### 6.3 Install the timer

```bash
sudo cp /srv/tattoo-drip/app/deploy/systemd/tattoo-drip-backup.service /srv/tattoo-drip/app/deploy/systemd/tattoo-drip-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now tattoo-drip-backup.timer
systemctl list-timers tattoo-drip-backup.timer
```

**You should see:** the timer in the list with a `NEXT` time of about 20:15 to 20:20 UTC. That is 02:00 in Nepal (UTC+5:45); the list shows UTC because the server's clock is UTC.

If you ever move the settings folder (`TD_ENV_DIR`), add an `Environment=TD_ENV_DIR=<folder>` line to the service unit as well.

### 6.4 Run one by hand

The images were built by the first deploy. Start the job as systemd would:

```bash
sudo systemctl start tattoo-drip-backup.service
sudo journalctl -u tattoo-drip-backup.service -n 30 --no-pager
```

**You should see:** `systemctl start` returns after a few seconds without an error, and the journal ends with these lines (sizes differ):

```
dump: ok 145KiB
verify: ok
upload: ok
retention: removed 0 older than 30d
heartbeat: ok
backup: ok tattoo_drip-20261101T201512Z.dump 145KiB
```

Then check both ends: the file is in R2 (7.1 lists it, or open the bucket in the dashboard), and the healthchecks.io check turned green with a ping just now.

### 6.5 When the "failed" email comes

The job prints one line naming the step it failed at (`dump`, `verify`, `upload`, `retention` or `heartbeat`). Read it, run the job again by hand as in 6.4, and look at the journal:

```bash
sudo journalctl -u tattoo-drip-backup.service -n 50 --no-pager
```

The usual causes: the backups token was deleted or lost its bucket (3.4), the database is down (8), or R2 is unreachable. A night that failed is not retried by itself: fix the cause and run 6.4.

---

## 7. Restore

What a restore does: it puts the database back as it was at the time of a dump, which is up to a day old. Everything after the dump is lost. The dump has the tables, rows, policies and the grants to the app role, but not the roles themselves (`pg_dump` leaves roles out). So restore into a Postgres that was started by this runbook: its first start created the roles `postgres` and `tattoo_drip_app`, and their passwords come from your current settings files.

Do not add `--no-acl` to `pg_restore`: it skips the `GRANT` lines of the dump, and the app role would lose its access to every table. (`--no-owner` would be harmless here, since the owner is `postgres` either way, but it is not needed.)

### 7.1 List the backups

```bash
docker compose -f /srv/tattoo-drip/app/deploy/compose.yml --profile tools run --rm --no-deps -T \
  --entrypoint rclone backup -q lsf r2:tattoo-drip-backups/db | sort
```

**You should see:** one file per night, oldest first; the file names hold the UTC time: `tattoo_drip-20261101T201512Z.dump`. The last line is the newest. (This runs `rclone` inside the backup image, which already has the R2 settings from `backup.env`. Add `lsl` in place of `lsf` to see sizes and times.)

### 7.2 Download one

```bash
mkdir -p -m 700 /srv/tattoo-drip/restore
dump=$(docker compose -f /srv/tattoo-drip/app/deploy/compose.yml --profile tools run --rm --no-deps -T \
  --entrypoint rclone backup -q lsf r2:tattoo-drip-backups/db | sort | tail -n 1)
echo "$dump"
```

That picks the newest. For an older one, set it yourself instead: `dump=tattoo_drip-20261031T201512Z.dump`. Then download it and read it back:

```bash
docker compose -f /srv/tattoo-drip/app/deploy/compose.yml --profile tools run --rm --no-deps -T \
  --entrypoint rclone backup -q cat "r2:tattoo-drip-backups/db/$dump" > "/srv/tattoo-drip/restore/$dump"
ls -l /srv/tattoo-drip/restore
docker compose -f /srv/tattoo-drip/app/deploy/compose.yml exec -T postgres pg_restore --list < "/srv/tattoo-drip/restore/$dump" | head -12
```

**You should see:** the file with a size of more than zero, and a header of lines starting with `;` that includes `dbname: tattoo_drip`, `Format: CUSTOM` and a TOC entry count. If you log out in the middle, set `dump=` again.

### 7.3 Restore into a scratch database and compare

This is the practice restore, and the first half of a real one. It does not touch the live database. The scratch database is `tattoo_drip_restore`:

```bash
docker compose -f /srv/tattoo-drip/app/deploy/compose.yml exec -T postgres dropdb -U postgres --if-exists tattoo_drip_restore
docker compose -f /srv/tattoo-drip/app/deploy/compose.yml exec -T postgres createdb -U postgres tattoo_drip_restore
docker compose -f /srv/tattoo-drip/app/deploy/compose.yml exec -T postgres pg_restore -U postgres -d tattoo_drip_restore --single-transaction --exit-on-error < "/srv/tattoo-drip/restore/$dump"
```

(The first command says the database "does not exist, skipping" the first time; that is fine.) **You should see:** the last command prints nothing and returns. It runs as one transaction, so an error leaves the scratch database empty rather than half-filled.

Now the comparison. First write the three queries once:

```bash
cat > /srv/tattoo-drip/restore/checks.sql <<'SQL'
\echo == rows per table (queue_jobs and rate_limits change all the time and are left out)
SELECT table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text::int AS rows
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name NOT IN ('queue_jobs', 'rate_limits')
ORDER BY table_name;
\echo == who may do what to each table and sequence
SELECT relname, relacl FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r', 'S') ORDER BY relname;
\echo == default privileges
SELECT defaclrole::regrole, defaclobjtype, defaclacl FROM pg_default_acl ORDER BY 1, 2;
SQL
```

Run them on the live database and on the scratch one, and compare:

```bash
docker compose -f /srv/tattoo-drip/app/deploy/compose.yml exec -T postgres psql -U postgres -d tattoo_drip -At < /srv/tattoo-drip/restore/checks.sql > /srv/tattoo-drip/restore/checks-live.txt
docker compose -f /srv/tattoo-drip/app/deploy/compose.yml exec -T postgres psql -U postgres -d tattoo_drip_restore -At < /srv/tattoo-drip/restore/checks.sql > /srv/tattoo-drip/restore/checks-restored.txt
diff /srv/tattoo-drip/restore/checks-live.txt /srv/tattoo-drip/restore/checks-restored.txt && echo "same rows, same grants"
```

**You should see:** `same rows, same grants`. A difference in the row counts is expected only if someone used the dashboard between the dump and now (compare with a dump you took minutes ago, as on deploy day). A difference in the `tattoo_drip_app=...` lines means a grant was lost; do not rely on that restore.

If you restore a dump from another server and have nothing to compare, look at `checks-restored.txt` instead: the counts of `users`, `tenants` and `clients` should look right, and the table lines should hold `tattoo_drip_app=arwd/postgres` (the sequences `tattoo_drip_app=rU/postgres`).

### 7.4 After a practice restore

```bash
docker compose -f /srv/tattoo-drip/app/deploy/compose.yml exec -T postgres dropdb -U postgres tattoo_drip_restore
rm -f /srv/tattoo-drip/restore/*
```

That also deletes the downloaded dump, which holds clients' phone numbers. The practice is done.

### 7.5 A real restore: put a dump in place of the live database

Use this when the data is lost or wrong. It restores into the scratch database as in 7.3 and then swaps the names, so the live database is kept as `tattoo_drip_old` until you delete it. It is a swap and not `pg_restore --clean` into the live database on purpose: after a `--clean` restore, a table that exists now but not in the older dump stays, while the list of finished migrations goes back, and the next deploy then fails on "already exists". After the swap the database is exactly the dump, and `deploy.sh` brings it up to date.

1. If the live database still works and its newest data matters, take a backup of it first (6.4). It stays in R2 as a way back.
2. Download the dump you want (7.1, 7.2) and restore it into the scratch database (the three commands of 7.3; the first one drops a scratch database left from an earlier try).
3. **Check the restored database before you swap. This step is required.** A `pg_restore` that failed leaves an empty database, and swapping that in would replace your data with nothing:

   ```bash
   docker compose -f /srv/tattoo-drip/app/deploy/compose.yml exec -T postgres psql -U postgres -d tattoo_drip_restore -v ON_ERROR_STOP=1 -At \
     -c "select (select count(*) from users) as users, (select count(*) from tenants) as studios" \
     -c "DO \$\$ BEGIN IF (SELECT count(*) FROM users) = 0 OR (SELECT count(*) FROM tenants) = 0 THEN RAISE EXCEPTION 'the restored database has no users or no studios'; END IF; END \$\$"
   ```

   **You should see:** one line like `5|2` (users, then studios) and `DO`, with no error. Do the numbers look like your site: at least the pilot's account and one studio? If you see an error (`relation "users" does not exist` means the restore left nothing; `the restored database has no users or no studios` means empty tables), or numbers that are wrong, **stop**. The live database has not been touched; go back to step 2 or pick another dump.
4. Stop the web server and the worker, so nothing is connected:

   ```bash
   docker compose -f /srv/tattoo-drip/app/deploy/compose.yml stop web worker
   docker compose -f /srv/tattoo-drip/app/deploy/compose.yml exec -T postgres psql -U postgres -d postgres -Atc "select count(*) from pg_stat_activity where datname = 'tattoo_drip'"
   ```

   **You should see:** `0`. Do this away from 02:00 Nepal time; the backup job also connects.
5. List the databases:

   ```bash
   docker compose -f /srv/tattoo-drip/app/deploy/compose.yml exec -T postgres psql -U postgres -d postgres -Atc "select datname from pg_database where datname like 'tattoo_drip%' order by 1"
   ```

   **You should see:** `tattoo_drip` and `tattoo_drip_restore`. If `tattoo_drip_old` is also listed, it is left from an earlier restore and the swap would fail on that name (changing nothing). Drop it first if you no longer need it: `docker compose -f /srv/tattoo-drip/app/deploy/compose.yml exec -T postgres dropdb -U postgres tattoo_drip_old`.
6. Swap, in one transaction (`-1`), so either both renames happen or neither:

   ```bash
   docker compose -f /srv/tattoo-drip/app/deploy/compose.yml exec -T postgres psql -U postgres -d postgres -v ON_ERROR_STOP=1 -1 \
     -c "ALTER DATABASE tattoo_drip RENAME TO tattoo_drip_old" \
     -c "ALTER DATABASE tattoo_drip_restore RENAME TO tattoo_drip" \
     -c "GRANT CONNECT ON DATABASE tattoo_drip TO tattoo_drip_app"
   ```

   The command connects to the `postgres` database because a database cannot be renamed while you are connected to it.

   **You should see:** `ALTER DATABASE`, `ALTER DATABASE`, `GRANT`. If it prints `ERROR` instead, **nothing was renamed**: the live database is still `tattoo_drip`, with its old data. The usual errors: `database "tattoo_drip" is being accessed by other users` (something is still connected: look at who with the command below, stop it, repeat), and `database "tattoo_drip_old" already exists` (step 5). If you cannot fix it, do step 7 anyway: it starts the old site again.

   ```bash
   docker compose -f /srv/tattoo-drip/app/deploy/compose.yml exec -T postgres psql -U postgres -d postgres -c "select pid, usename, application_name from pg_stat_activity where datname = 'tattoo_drip'"
   ```
7. Start everything again on the commit that was running, not on whatever is newest on `main`. This also runs any migration the dump predates:

   ```bash
   /srv/tattoo-drip/app/deploy/deploy.sh "$(git -C /srv/tattoo-drip/app rev-parse HEAD)"
   ```

   **You should see:** `deployed <short commit>`. Sign in and look at the data.
8. When you are sure (give it a week), delete the old database and the downloaded dump:

   ```bash
   docker compose -f /srv/tattoo-drip/app/deploy/compose.yml exec -T postgres dropdb -U postgres tattoo_drip_old
   rm -f /srv/tattoo-drip/restore/*
   ```

**To undo the swap** before step 8: stop web and worker as in step 4, put the databases back in one transaction, and start again as in step 7:

```bash
docker compose -f /srv/tattoo-drip/app/deploy/compose.yml exec -T postgres psql -U postgres -d postgres -v ON_ERROR_STOP=1 -1 \
  -c "ALTER DATABASE tattoo_drip RENAME TO tattoo_drip_restore" \
  -c "ALTER DATABASE tattoo_drip_old RENAME TO tattoo_drip"
```

If `tattoo_drip_restore` exists again (you made a scratch database since), that fails and changes nothing: drop that scratch database, or use any other free name in place of `tattoo_drip_restore`.

### 7.6 A restore on a new server

If the server is gone:

1. Buy and set up a new one: section 1, and the clone update of 2.1 (the first command and the `ls`).
2. Do not run 2.2: it would make a new `APP_KEY` and new database passwords. Put the six settings files from your password manager into `/srv/tattoo-drip/env`, so that sessions and deposit links keep working and the passwords match. From your computer, with the saved copies in `~/tattoo-drip-env` (2.4):

   ```bash
   scp -i ~/.ssh/tattoo_drip_vps ~/tattoo-drip-env/*.env haru@<new-server-ip>:/srv/tattoo-drip/env/
   ssh -i ~/.ssh/tattoo_drip_vps haru@<new-server-ip> 'chmod 600 /srv/tattoo-drip/env/*.env'
   ```

   Reuse the same tunnel token (start the new server's `cloudflared` only once the old one is off), the R2 tokens and the Turnstile keys. If you have no saved copy, make the files with 2.1 and 2.2 and the values of section 3 again, with a new `APP_KEY`: everyone must sign in again and the deposit links already handed out stop working. If only the backups token is lost, make a new one (3.4).
3. Run the first deploy (4.3). It starts an empty, migrated database.
4. Restore the newest dump with 7.1, 7.2, 7.3 and then 7.5 from step 2 on (step 1 does not apply).
5. Repeat 6.3 to install the timer.

---

## 8. When something is wrong

### 8.1 First look

```bash
docker compose -f /srv/tattoo-drip/app/deploy/compose.yml ps
docker compose -f /srv/tattoo-drip/app/deploy/compose.yml logs --tail 100 web
```

Replace `web` with `worker`, `storefront`, `nginx`, `cloudflared` or `postgres`. Add `-f` after `logs` to follow a log live (Ctrl+C stops). The logs keep the last 30 MB per service.

| What you see | Likely cause |
|---|---|
| The site shows a Cloudflare error page (for example 1033 or 502) | The tunnel is not connected: `logs cloudflared`. A 502 with a connected tunnel means nginx cannot reach `web` or `storefront`: check `ps`. |
| `web`, `worker` or `storefront` keeps restarting, and the log names a variable | A setting is missing or malformed. The message names the variable, never its value; fix it in the file (2.4) and recreate the service (section 5, "Changing a setting"). |
| Studio pages show "try again" or a 500 | `logs storefront`; then `logs web` for "server key this API does not accept": `STOREFRONT_SERVER_KEY` and `STOREFRONT_SERVER_KEYS` must hold the same value. |
| Everyone is locked out of sign-in or the request form after a few tries | `TRUST_PROXY` is not nginx's address, so every visitor looks like one. It must be `172.30.42.10`. |
| Photos do not upload, or the log says R2 | The R2 token, the bucket names or `R2_ACCOUNT_ID` (3.1 to 3.3). |
| The request form always says the check failed | The Turnstile widget's hostname or keys (3.5). |
| `502` right after you recreated a service by hand | nginx has the old address: run the `nginx ... -s reload` command of section 5. |
| `deploy.sh` says the build failed | Often memory or disk: 8.3 and 8.4. |
| A "backup failed" email | 6.5. |

### 8.2 The site is down and `ps` shows nothing

```bash
docker compose -f /srv/tattoo-drip/app/deploy/compose.yml up -d
```

starts whatever should be running. If that fails, `sudo systemctl status docker` and `sudo journalctl -u docker -n 50 --no-pager` tell you about Docker itself.

### 8.3 Disk full

```bash
df -h /
docker system df
```

Clear build leftovers and unused images, which are safe to delete (the next deploy rebuilds what it needs):

```bash
docker builder prune -f
docker image prune -f
```

Never add `--volumes` or run `docker volume prune`: the database lives in a volume. Also delete anything left in `/srv/tattoo-drip/restore`, and, once a restore is confirmed good, the database it left behind (7.5, step 8): `docker compose -f /srv/tattoo-drip/app/deploy/compose.yml exec -T postgres dropdb -U postgres --if-exists tattoo_drip_old`. The logs rotate by themselves.

### 8.4 Out of memory during a build

```bash
free -h
sudo dmesg | grep -i -E 'out of memory|killed process' | tail -5
```

If swap is missing, add it (1.9). Run the deploy when the site is quiet, since the build competes with the running services.

### 8.5 The server rebooted

Everything starts by itself (checked in 4.10). Run `ps` as in 8.1 and give the three checked containers a minute. If something is down, 8.2.

### 8.6 Cannot log in over SSH

Do not lock yourself out: keep a session open when you change anything in 1.5 or 1.6. If you are locked out anyway, hPanel has a **Browser terminal** and a **Root password** setting for the VPS. Try the Browser terminal once now, while everything works, so you know whether it still works with root login over SSH switched off.

### 8.7 Another project on the same server

The Card Ledger stack, or anything else, must use a different Compose project name (`name:` at the top of its compose file, not `tattoo-drip-prod`) and must not use the subnet `172.30.42.0/24`, which this stack's fixed addresses live in. `docker network ls` and `docker network inspect <name>` show the subnets in use. Give it its own tunnel, or its own hostnames on this one, and no published ports.

### 8.8 Good to know

- Cloudflare's free plan waits at most 100 seconds for an answer. A dashboard upload slower than that shows Cloudflare's timeout page instead of the app's own message. Rare at 21 MB; accepted.
- One server is one point of failure. If it dies, the way back is 7.6: up to a day of data lost, an hour or two of work.
- Clients' phone numbers and reference photos are stored outside Nepal. The legal check (TAT-63) should cover that under the Individual Privacy Act 2075.
- To be told when the site is down, add a free uptime monitor (any that emails you) on `https://tattoodrip.app/login` and `https://tattoodrip.page/`.

## The commands you will use most

```bash
# update
/srv/tattoo-drip/app/deploy/deploy.sh
# what is running
docker compose -f /srv/tattoo-drip/app/deploy/compose.yml ps
# a log
docker compose -f /srv/tattoo-drip/app/deploy/compose.yml logs --tail 100 web
# a backup now
sudo systemctl start tattoo-drip-backup.service
# confirm a pilot's account (after checking who is asking)
docker compose -f /srv/tattoo-drip/app/deploy/compose.yml --profile tools run --rm migrate node ace.js account:verify <email>
```
