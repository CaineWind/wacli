FROM docker/sandbox-templates:claude-code

USER root
COPY shared/install-cloudcli.sh /tmp/install-cloudcli.sh
RUN chmod +x /tmp/install-cloudcli.sh && /tmp/install-cloudcli.sh

USER agent
RUN --mount=type=cache,target=/tmp/npm-cache,sharing=locked,mode=0777 \
    npm install -g wind-agent-cli \
      --cache=/tmp/npm-cache \
      --fetch-retries=5 \
      --fetch-retry-mintimeout=20000 \
      --fetch-retry-maxtimeout=120000 \
      --fetch-timeout=600000 \
      --no-audit \
      --no-fund && \
    wacli --version

COPY --chown=agent:agent shared/start-cloudcli.sh /home/agent/.cloudcli-start.sh
RUN echo '. ~/.cloudcli-start.sh' >> /home/agent/.bashrc
