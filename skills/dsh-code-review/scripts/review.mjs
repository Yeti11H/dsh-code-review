#!/usr/bin/env node
import { main } from '../runtime/codex/cli.js';
process.exitCode = await main();
