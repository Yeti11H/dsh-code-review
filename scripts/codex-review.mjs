#!/usr/bin/env node
import { main } from '../dist/codex/cli.js';
process.exitCode = await main();
