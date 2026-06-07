/**
 * @module planning/PddlServiceBridge
 * @description Bridges JavaScript state representations to PDDL domains and problems.
 * Submits compiled problems to the remote/local solver and translates PDDL action steps.
 */

import { onlineSolver } from '@unitn-asa/pddl-client';
import fs from 'fs';


/**
 * Service bridge to translate grid states to PDDL and solve corridor clearing.
 */
export class PddlServiceBridge {
    /**
     * Creates a PddlServiceBridge.
     */
    constructor() {
        /**
         * PDDL Domain string defining rules for movement and crate pushing.
         * @type {string}
         */
        this.domainPddl = `
(define (domain deliveroo-crates)
    (:requirements :strips)
    (:predicates
        (me ?a)
        (at ?obj ?t)
        (crate-move-capable ?t)
        (clear ?t)
        (right ?t1 ?t2)
        (left ?t1 ?t2)
        (up ?t1 ?t2)
        (down ?t1 ?t2)
    )

    (:action move-right
        :parameters (?me ?from ?to)
        :precondition (and (me ?me) (at ?me ?from) (right ?from ?to) (clear ?to))
        :effect (and (at ?me ?to) (not (at ?me ?from)))
    )

    (:action move-left
        :parameters (?me ?from ?to)
        :precondition (and (me ?me) (at ?me ?from) (left ?from ?to) (clear ?to))
        :effect (and (at ?me ?to) (not (at ?me ?from)))
    )

    (:action move-up
        :parameters (?me ?from ?to)
        :precondition (and (me ?me) (at ?me ?from) (up ?from ?to) (clear ?to))
        :effect (and (at ?me ?to) (not (at ?me ?from)))
    )

    (:action move-down
        :parameters (?me ?from ?to)
        :precondition (and (me ?me) (at ?me ?from) (down ?from ?to) (clear ?to))
        :effect (and (at ?me ?to) (not (at ?me ?from)))
    )

    (:action push-right
        :parameters (?me ?crate ?myPos ?cratePos ?destPos)
        :precondition (and
            (me ?me)
            (at ?me ?myPos) (at ?crate ?cratePos)
            (crate-move-capable ?destPos)
            (clear ?destPos)
            (right ?myPos ?cratePos) (right ?cratePos ?destPos)
        )
        :effect (and
            (at ?me ?cratePos) (not (at ?me ?myPos))
            (at ?crate ?destPos) (not (at ?crate ?cratePos))
            (clear ?cratePos) (not (clear ?destPos))
        )
    )

    (:action push-left
        :parameters (?me ?crate ?myPos ?cratePos ?destPos)
        :precondition (and
            (me ?me)
            (at ?me ?myPos) (at ?crate ?cratePos)
            (crate-move-capable ?destPos)
            (clear ?destPos)
            (left ?myPos ?cratePos) (left ?cratePos ?destPos)
        )
        :effect (and
            (at ?me ?cratePos) (not (at ?me ?myPos))
            (at ?crate ?destPos) (not (at ?crate ?cratePos))
            (clear ?cratePos) (not (clear ?destPos))
        )
    )

    (:action push-up
        :parameters (?me ?crate ?myPos ?cratePos ?destPos)
        :precondition (and
            (me ?me)
            (at ?me ?myPos) (at ?crate ?cratePos)
            (crate-move-capable ?destPos)
            (clear ?destPos)
            (up ?myPos ?cratePos) (up ?cratePos ?destPos)
        )
        :effect (and
            (at ?me ?cratePos) (not (at ?me ?myPos))
            (at ?crate ?destPos) (not (at ?crate ?cratePos))
            (clear ?cratePos) (not (clear ?destPos))
        )
    )

    (:action push-down
        :parameters (?me ?crate ?myPos ?cratePos ?destPos)
        :precondition (and
            (me ?me)
            (at ?me ?myPos) (at ?crate ?cratePos)
            (crate-move-capable ?destPos)
            (clear ?destPos)
            (down ?myPos ?cratePos) (down ?cratePos ?destPos)
        )
        :effect (and
            (at ?me ?cratePos) (not (at ?me ?myPos))
            (at ?crate ?destPos) (not (at ?crate ?cratePos))
            (clear ?cratePos) (not (clear ?destPos))
        )
    )
)
`.trim();
    }

    /**
     * Solves a corridor-clearing push task using the online PDDL solver.
     * @param {import('../mapping/MapRepresentation.js').MapRepresentation} map - Map configuration.
     * @param {import('../agent/BeliefBase.js').BeliefBase} beliefs - Agent belief base containing dynamic obstacles.
     * @param {{x: number, y: number}} targetCratePos - Coordinate of the crate we want to push.
     * @param {{x: number, y: number}} targetGoalPos - Destination coordinate for the crate.
     * @returns {Promise<Array<{action: string, args: Array<string>}>>} List of resolved action steps.
     */
    async solveObstaclePush(map, beliefs, targetCratePos, targetGoalPos) {
        const problem = this.compileProblemPddl(map, beliefs, targetCratePos, targetGoalPos);

        try {
            fs.writeFileSync('domain_debug.pddl', this.domainPddl, 'utf-8');
            fs.writeFileSync('problem_debug.pddl', problem, 'utf-8');
            console.log('[PDDL] Submitting problem to PDDL solver...');
            const rawPlan = await onlineSolver(this.domainPddl, problem);

            if (!rawPlan) {
                console.warn('[PDDL] Solver returned empty plan.');
                return [];
            }

            return this.parsePddlPlan(rawPlan);
        } catch (e) {
            console.error('[PDDL] Solver invocation failed:', e.message);
            return [];
        }
    }

    /**
     * Compiles grid coordinates, agent, and crates into a standard PDDL problem string.
     * @param {import('../mapping/MapRepresentation.js').MapRepresentation} map - Map configuration.
     * @param {import('../agent/BeliefBase.js').BeliefBase} beliefs - Agent belief base containing dynamic obstacles.
     * @param {{x: number, y: number}} targetCrate - Target crate coordinates.
     * @param {{x: number, y: number}} goalCoord - Target destination coordinates.
     * @returns {string} Compiled PDDL problem description.
     */
    compileProblemPddl(map, beliefs, targetCrate, goalCoord) {
        const tilesList = [];
        const initFacts = [];
        const agent = beliefs.me;
        const crates = beliefs.crates;

        // Build occupied tiles list to determine clear space
        const occupiedTiles = new Set();
        occupiedTiles.add(`${targetCrate.x},${targetCrate.y}`);
        for (const c of crates.values()) {
            occupiedTiles.add(`${c.x},${c.y}`);
        }
        if (beliefs.peers) {
            for (const peer of beliefs.peers.values()) {
                const px = Math.round(peer.x);
                const py = Math.round(peer.y);
                if (px !== agent.x || py !== agent.y) {
                    occupiedTiles.add(`${px},${py}`);
                }
            }
        }
        // NOTE: blockedTargets are NOT included here. They represent temporarily
        // blocked goal coordinates (delivery/spawn zones), not physical obstacles.
        // Including them would poison the PDDL problem by marking reachable tiles
        // as non-clear, causing the solver to declare the problem unsolvable.

        // 1. Declare tiles and adjacency relationships
        for (let x = 0; x < map.width; x++) {
            for (let y = 0; y < map.height; y++) {
                if (!map.isWalkableTile(x, y)) continue;

                const tileName = `t_${x}_${y}`;
                tilesList.push(tileName);

                // Mark crate move capable tiles (CRATE_SPAWN=4, CRATE=5)
                const code = map.getTileCode(x, y);
                if (code === 4 || code === 5) {
                    initFacts.push(`(crate-move-capable ${tileName})`);
                }

                // Initial clear facts: must not contain crates or peer agents
                if (!occupiedTiles.has(`${x},${y}`)) {
                    initFacts.push(`(clear ${tileName})`);
                }

                // Compile adjacency facts
                const current = { x, y };
                const rightNeighbor = { x: x + 1, y };
                const upNeighbor = { x, y: y + 1 };

                if (map.isWalkableTile(rightNeighbor.x, rightNeighbor.y)) {
                    if (map.isAdjacent(current, rightNeighbor)) {
                        initFacts.push(`(right t_${x}_${y} t_${x + 1}_${y})`);
                    }
                    if (map.isAdjacent(rightNeighbor, current)) {
                        initFacts.push(`(left t_${x + 1}_${y} t_${x}_${y})`);
                    }
                }
                if (map.isWalkableTile(upNeighbor.x, upNeighbor.y)) {
                    if (map.isAdjacent(current, upNeighbor)) {
                        initFacts.push(`(up t_${x}_${y} t_${x}_${y + 1})`);
                    }
                    if (map.isAdjacent(upNeighbor, current)) {
                        initFacts.push(`(down t_${x}_${y + 1} t_${x}_${y})`);
                    }
                }
            }
        }

        // 2. Declare objects and initial positions
        initFacts.push('(me ag)');
        initFacts.push(`(at ag t_${agent.x}_${agent.y})`);

        let targetCrateId = 'crate_target';
        initFacts.push(`(at ${targetCrateId} t_${targetCrate.x}_${targetCrate.y})`);

        const otherCrateIds = [];
        let idx = 1;
        for (const c of crates.values()) {
            if (c.x === targetCrate.x && c.y === targetCrate.y) continue;
            const otherCrateId = `crate_other_${idx++}`;
            otherCrateIds.push(otherCrateId);
            initFacts.push(`(at ${otherCrateId} t_${c.x}_${c.y})`);
        }

        const allObjects = ['ag', targetCrateId, ...otherCrateIds, ...tilesList].join(' ');

        return `
(define (problem crate-push-problem)
    (:domain deliveroo-crates)
    (:objects
        ${allObjects}
    )
    (:init
        ${initFacts.join('\n        ')}
    )
    (:goal (at ${targetCrateId} t_${goalCoord.x}_${goalCoord.y}))
)
`.trim();
    }

    /**
     * Parses the planner's action output back into simple JS objects.
     * @param {Array<{action: string, args: Array<string>}>} rawPlan - Raw action list from the solver.
     * @returns {Array<{action: string, args: Array<string>}>} Structured action steps.
     */
    parsePddlPlan(rawPlan) {
        // onlineSolver returns parsed array from pddl-client.
        return rawPlan.map(step => {
            return {
                action: step.action,
                args: step.args || []
            };
        });
    }
}
