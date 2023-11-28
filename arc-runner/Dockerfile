FROM mcr.microsoft.com/dotnet/runtime-deps:6.0-jammy as build

# Replace value with the latest runner release version
# source: https://github.com/actions/runner/releases
# ex: 2.303.0
ARG RUNNER_VERSION="2.311.0"
ARG RUNNER_ARCH="arm64"
# Replace value with the latest runner-container-hooks release version
# source: https://github.com/actions/runner-container-hooks/releases
# ex: 0.3.1
ARG RUNNER_CONTAINER_HOOKS_VERSION="0.5.0"

ARG TARGETPLATFORM
ARG TARGETOS
ARG TARGETARCH
ARG RUNNER_VERSION

# Docker and Docker Compose arguments
ARG CHANNEL=stable
ARG DOCKER_VERSION=24.0.6
ARG BUILDX_VERSION=0.11.2
ARG DOCKER_COMPOSE_VERSION=v2.20.0
ARG DUMB_INIT_VERSION=1.2.5
ARG RUNNER_USER_UID=1001
ARG DOCKER_GROUP_GID=121

ENV DEBIAN_FRONTEND=noninteractive
ENV RUNNER_MANUALLY_TRAP_SIG=1
ENV ACTIONS_RUNNER_PRINT_LOG_TO_STDOUT=1
ENV ImageOS=ubuntu22

RUN apt-get update -y \
  && apt-get install -y software-properties-common gnupg libc6 \
  && apt-get update -y \
  && apt-get install -y --no-install-recommends \
  build-essential \
  gpg \
  gpg-agent \
  dirmngr \
  curl \
  ca-certificates \
  dnsutils \
  ftp \
  git \
  iproute2 \
  iputils-ping \
  jq \
  libunwind8 \
  locales \
  netcat \
  openssh-client \
  parallel \
  python3-pip \
  python3-venv \
  python-dev \
  rsync \
  shellcheck \
  sudo \
  telnet \
  docker \
  time \
  tzdata \
  unzip \
  upx \
  wget \
  zip \
  zstd \
  && ln -sf /usr/bin/python3 /usr/bin/python \
  && ln -sf /usr/bin/pip3 /usr/bin/pip \
  && rm -rf /var/lib/apt/lists/*

# Download latest git-lfs version
RUN curl -s https://packagecloud.io/install/repositories/github/git-lfs/script.deb.sh | bash && \
  apt-get install -y --no-install-recommends git-lfs

RUN adduser --disabled-password --gecos "" --uid 1001 runner \
  && groupadd docker --gid 123 \
  && usermod -aG sudo runner \
  && usermod -aG docker runner \
  && echo "%sudo   ALL=(ALL:ALL) NOPASSWD:ALL" > /etc/sudoers \
  && echo "Defaults env_keep += \"DEBIAN_FRONTEND\"" >> /etc/sudoers

WORKDIR /home/runner

RUN curl -f -L -o runner.tar.gz https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-${RUNNER_ARCH}-${RUNNER_VERSION}.tar.gz \
  && tar xzf ./runner.tar.gz \
  && rm runner.tar.gz

RUN curl -f -L -o runner-container-hooks.zip https://github.com/actions/runner-container-hooks/releases/download/v${RUNNER_CONTAINER_HOOKS_VERSION}/actions-runner-hooks-k8s-${RUNNER_CONTAINER_HOOKS_VERSION}.zip \
  && unzip ./runner-container-hooks.zip -d ./k8s \
  && rm runner-container-hooks.zip

# Install Docker
RUN set -vx; \
  export ARCH=$(echo ${TARGETPLATFORM} | cut -d / -f2) \
  && if [ "$ARCH" = "arm64" ]; then export ARCH=aarch64 ; fi \
  && if [ "$ARCH" = "amd64" ] || [ "$ARCH" = "i386" ]; then export ARCH=x86_64 ; fi \
  && curl -fLo docker.tgz https://download.docker.com/linux/static/${CHANNEL}/${ARCH}/docker-${DOCKER_VERSION}.tgz \
  && tar zxvf docker.tgz \
  && install -o root -g root -m 755 docker/* /usr/bin/ \
  && rm -rf docker docker.tgz \
  # Buildx
  && mkdir -p /usr/local/lib/docker/cli-plugins \
  && curl -fLo /usr/local/lib/docker/cli-plugins/docker-buildx \
  "https://github.com/docker/buildx/releases/download/v${BUILDX_VERSION}/buildx-v${BUILDX_VERSION}.linux-${TARGETARCH}" \
  && chmod +x /usr/local/lib/docker/cli-plugins/docker-buildx \
  # Compose
  && curl -fLo /usr/local/lib/docker/cli-plugins/docker-compose \
  "https://github.com/docker/compose/releases/download/${DOCKER_COMPOSE_VERSION}/docker-compose-linux-${ARCH}" \
  && chmod +x /usr/local/lib/docker/cli-plugins/docker-compose


USER runner

# install pipx
RUN bash -c 'python -m pip install --user pipx && python -m pipx ensurepath'
