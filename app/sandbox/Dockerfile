FROM python:3.12-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends nodejs npm git \
 && rm -rf /var/lib/apt/lists/*
# Example stdio MCP server, preinstalled because sandbox containers have no network by default.
RUN npm install -g @modelcontextprotocol/server-everything@2.0.0
WORKDIR /work
