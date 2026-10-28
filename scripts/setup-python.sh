#!/bin/sh
# Creates a local virtualenv with pytest for the local runner.
set -e
cd "$(dirname "$0")/.."
python3 -m venv .venv
.venv/bin/python -m pip install --quiet --upgrade pip
.venv/bin/python -m pip install --quiet pytest
.venv/bin/python -m pytest --version
