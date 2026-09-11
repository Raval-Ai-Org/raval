#!/usr/bin/env bash
# One-time hardening + Docker install for a fresh Ubuntu 22.04/24.04 server
# (proposal workstream A). Run as root:  sudo bash deploy/provision.sh <deploy-user>
#
# What it does:
#   - creates a non-root deploy user in the docker group (SSH key required)
#   - SSH: key-only, no root password login
#   - firewall: only 22, 80, 443 (ufw)
#   - fail2ban for sshd, unattended security upgrades
#   - Docker Engine + compose plugin from Docker's apt repository
#
# It does NOT copy secrets. Put .env on the server yourself (chmod 600).
set -euo pipefail

DEPLOY_USER="${1:-deploy}"

if [[ $EUID -ne 0 ]]; then
  echo "Run as root (sudo)." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y ca-certificates curl gnupg ufw fail2ban unattended-upgrades git

# --- Deploy user -------------------------------------------------------------
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
fi
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
if [[ -f /root/.ssh/authorized_keys && ! -s "/home/$DEPLOY_USER/.ssh/authorized_keys" ]]; then
  install -m 600 -o "$DEPLOY_USER" -g "$DEPLOY_USER" /root/.ssh/authorized_keys "/home/$DEPLOY_USER/.ssh/authorized_keys"
fi
if [[ ! -s "/home/$DEPLOY_USER/.ssh/authorized_keys" ]]; then
  echo "No SSH key for $DEPLOY_USER — add one to /home/$DEPLOY_USER/.ssh/authorized_keys before disabling passwords." >&2
  exit 1
fi

# --- SSH: keys only ----------------------------------------------------------
install -d /etc/ssh/sshd_config.d
cat >/etc/ssh/sshd_config.d/60-mellox-hardening.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
PubkeyAuthentication yes
MaxAuthTries 3
EOF
sshd -t
systemctl reload ssh || systemctl reload sshd

# --- Firewall ----------------------------------------------------------------
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

# --- fail2ban + automatic security updates -----------------------------------
cat >/etc/fail2ban/jail.d/sshd.local <<'EOF'
[sshd]
enabled = true
maxretry = 5
bantime = 1h
EOF
systemctl enable --now fail2ban
dpkg-reconfigure -f noninteractive unattended-upgrades

# --- Docker Engine (official apt repository) ---------------------------------
install -m 0755 -d /etc/apt/keyrings
if [[ ! -f /etc/apt/keyrings/docker.gpg ]]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
fi
. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
  >/etc/apt/sources.list.d/docker.list
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
usermod -aG docker "$DEPLOY_USER"

# Docker publishes ports around ufw; only Caddy publishes any (80/443), and
# redis/app stay on the internal compose network.
systemctl enable --now docker

echo "Provisioned. Next: log in as $DEPLOY_USER, clone the repo, create .env (chmod 600), run deploy/deploy.sh."
