/**
 * @file run_benchmark.js
 * @description Benchmark orchestration script that spawns multiple concurrent BDI Executor processes,
 * tracks their movement metrics, and reports aggregated performance results.
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../..');

const NUM_AGENTS = 3;
const RUN_DURATION_MS = 15000; // Run for 15 seconds

console.log('================================================================================');
console.log(` ASA Autobots - Multi-Agent Benchmark Runner`);
console.log(` Spawning ${NUM_AGENTS} Agent Processes...`);
console.log(`️ Duration: ${RUN_DURATION_MS / 1000} seconds`);
console.log('================================================================================');

const processes = [];
const stats = {};

for (let i = 0; i < NUM_AGENTS; i++) {
    const name = `Benchmark_Agent_${i}`;
    stats[name] = {
        moves: 0,
        pickups: 0,
        putdowns: 0,
        collisions: 0,
        errors: 0
    };

    console.log(`[Harness] Launching process for ${name}...`);

    // Spawn agent process pointing to run_bdi.js in the root
    const child = spawn('node', ['run_bdi.js'], {
        cwd: PROJECT_ROOT,
        env: {
            ...process.env,
            NAME: name,
            TOKEN: '' // Clear token to let it connect anonymously/generate new
        }
    });

    child.stdout.on('data', (data) => {
        const line = data.toString();
        // Parse logs to record metrics
        if (line.includes('move')) stats[name].moves++;
        if (line.includes('Pickup successful')) stats[name].pickups++;
        if (line.includes('Cargo successfully dropped')) stats[name].putdowns++;
        if (line.includes('Collision detected') || line.includes('Move failed')) stats[name].collisions++;
    });

    child.stderr.on('data', (data) => {
        stats[name].errors++;
    });

    child.on('close', (code) => {
        console.log(`[Harness] Process for ${name} exited with code ${code}`);
    });

    processes.push({ name, child });
}

// Set duration timer to stop processes and report results
setTimeout(() => {
    console.log('\n================================================================================');
    console.log('⏱️ Benchmark completed. Terminating agent processes...');
    console.log('================================================================================');

    processes.forEach(p => {
        p.child.kill();
    });

    console.log('\n📊 Aggregated Benchmark Performance Report:\n');
    console.table(stats);

    const totalMoves = Object.values(stats).reduce((sum, s) => sum + s.moves, 0);
    const totalPickups = Object.values(stats).reduce((sum, s) => sum + s.pickups, 0);
    const totalPutdowns = Object.values(stats).reduce((sum, s) => sum + s.putdowns, 0);
    const totalCollisions = Object.values(stats).reduce((sum, s) => sum + s.collisions, 0);

    console.log('================================================================================');
    console.log(`Total Moves Executed: ${totalMoves}`);
    console.log(`Total Pickups Succeeded: ${totalPickups}`);
    console.log(`Total Deliveries Succeeded: ${totalPutdowns}`);
    console.log(`Total Collision Incidents: ${totalCollisions}`);
    console.log('================================================================================');

    process.exit(0);
}, RUN_DURATION_MS);
