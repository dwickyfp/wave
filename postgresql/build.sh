#!/usr/bin/env bash

set -euo pipefail

IMAGE_NAME="pg-ai-bot:16"

echo "============================================================="
echo " Building image → ${IMAGE_NAME}"
echo "============================================================="

docker build --no-cache \
  -t "${IMAGE_NAME}" \
  -f Dockerfile .

echo ""
echo "Build finished."
echo ""
echo "To start:"
echo "  docker compose up -d"
echo ""
echo "To rebuild later:"
echo "  ./build.sh"
echo ""
echo "Optional: push to registry (after tagging)"
echo "  docker tag ${IMAGE_NAME} yourusername/${IMAGE_NAME}"
echo "  docker push yourusername/${IMAGE_NAME}"