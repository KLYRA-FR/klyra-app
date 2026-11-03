#!/bin/bash
# Claude Code tel quel, avec une copie de sa sortie stream-json dans $BENCH_LOG pour le banc.
exec "$BENCH_CLAUDE" "$@" > >(tee -a "$BENCH_LOG")
