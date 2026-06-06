/**
 * @module planning/PddlServiceBridge
 * @description Bridges JavaScript state representations to PDDL domains and problems.
 * Submits compiled problems to the remote/local solver and translates PDDL action steps.
 */

import { onlineSolver } from '@unitn-asa/pddl-client';

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
        (tile ?t)
        (agent ?a)
        (crate ?c)
        (me ?a)
        (at ?obj ?t)
        (crate-move-capable ?t)
        (right ?t1 ?t2)
        (left ?t1 ?t2)
        (up ?t1 ?t2)
        (down ?t1 ?t2)
    )

    (:action move-right
        :parameters (?me ?from ?to)
        :precondition (and (me ?me) (at ?me ?from) (right ?from ?to))
        :effect (and (at ?me ?to) (not (at ?me ?from)))
    )

    (:action move-left
        :parameters (?me ?from ?to)
        :precondition (and (me ?me) (at ?me ?from) (left ?from ?to))
        :effect (and (at ?me ?to) (not (at ?me ?from)))
    )

    (:action move-up
        :parameters (?me ?from ?to)
        :precondition (and (me ?me) (at ?me ?from) (up ?from ?to))
        :effect (and (at ?me ?to) (not (at ?me ?from)))
    )

    (:action move-down
        :parameters (?me ?from ?to)
        :precondition (and (me ?me) (at ?me ?from) (down ?from ?to))
        :effect (and (at ?me ?to) (not (at ?me ?from)))
    )

    (:action push-right
        :parameters (?me ?crate ?myPos ?cratePos ?destPos)
        :precondition (and
            (me ?me) (crate ?crate)
            (at ?me ?myPos) (at ?crate ?cratePos)
            (crate-move-capable ?destPos)
            (right ?myPos ?cratePos) (right ?cratePos ?destPos)
        )
        :effect (and
            (at ?me ?cratePos) (not (at ?me ?myPos))
            (at ?crate ?destPos) (not (at ?crate ?cratePos))
        )
    )

    (:action push-left
        :parameters (?me ?crate ?myPos ?cratePos ?destPos)
        :precondition (and
            (me ?me) (crate ?crate)
            (at ?me ?myPos) (at ?crate ?cratePos)
            (crate-move-capable ?destPos)
            (left ?myPos ?cratePos) (left ?cratePos ?destPos)
        )
        :effect (and
            (at ?me ?cratePos) (not (at ?me ?myPos))
            (at ?crate ?destPos) (not (at ?crate ?cratePos))
        )
    )

    (:action push-up
        :parameters (?me ?crate ?myPos ?cratePos ?destPos)
        :precondition (and
            (me ?me) (crate ?crate)
            (at ?me ?myPos) (at ?crate ?cratePos)
            (crate-move-capable ?destPos)
            (up ?myPos ?cratePos) (up ?cratePos ?destPos)
        )
        :effect (and
            (at ?me ?cratePos) (not (at ?me ?myPos))
            (at ?crate ?destPos) (not (at ?crate ?cratePos))
        )
    )

    (:action push-down
        :parameters (?me ?crate ?myPos ?cratePos ?destPos)
        :precondition (and
            (me ?me) (crate ?crate)
            (at ?me ?myPos) (at ?crate ?cratePos)
            (crate-move-capable ?destPos)
            (down ?myPos ?cratePos) (down ?cratePos ?destPos)
        )
        :effect (and
            (at ?me ?cratePos) (not (at ?me ?myPos))
            (at ?crate ?destPos) (not (at ?crate ?cratePos))
        )
    )
)
`.trim();
    }

    /**
     * Solves a corridor-clearing push task using the online PDDL solver.
     * @param {import('../mapping/MapRepresentation.js').MapRepresentation} map - Map configuration.
     * @param {{x: number, y: number}} agentPos - Current agent coordinate.
     * @param {Map<string, {id: string, x: number, y: number}>} crates - Dynamic crates in spatial memory.
     * @param {{x: number, y: number}} targetCratePos - Coordinate of the crate we want to push.
     * @param {{x: number, y: number}} targetGoalPos - Destination coordinate for the crate.
     * @returns {Promise<Array<{action: string, args: Array<string>}>>} List of resolved action steps.
     */
    async solveObstaclePush(map, agentPos, crates, targetCratePos, targetGoalPos) {
        const problem = this.compileProblemPddl(map, agentPos, crates, targetCratePos, targetGoalPos);

        try {
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
     * @param {{x: number, y: number}} agent - Agent coordinates.
     * @param {Map<string, {id: string, x: number, y: number}>} crates - Dynamic crates in spatial memory.
     * @param {{x: number, y: number}} targetCrate - Target crate coordinates.
     * @param {{x: number, y: number}} goalCoord - Target destination coordinates.
     * @returns {string} Compiled PDDL problem description.
     */
    compileProblemPddl(map, agent, crates, targetCrate, goalCoord) {
        const tilesList = [];
        const initFacts = [];

        // 1. Declare tiles and adjacency relationships
        for (let x = 0; x < map.width; x++) {
            for (let y = 0; y < map.height; y++) {
                if (!map.isWalkableTile(x, y)) continue;

                const tileName = `t_${x}_${y}`;
                tilesList.push(tileName);
                initFacts.push(`(tile ${tileName})`);

                // Mark crate move capable tiles (pavements=3, spawn=1, delivery=2, crate_spawn=4)
                const code = map.getTileCode(x, y);
                if (code === 3 || code === 1 || code === 2 || code === 4) {
                    initFacts.push(`(crate-move-capable ${tileName})`);
                }

                // Compile adjacency facts
                const current = { x, y };
                const rightNeighbor = { x: x + 1, y };
                const upNeighbor = { x, y: y + 1 };

                if (map.isAdjacent(current, rightNeighbor)) {
                    initFacts.push(`(right t_${x}_${y} t_${x + 1}_${y})`);
                    initFacts.push(`(left t_${x + 1}_${y} t_${x}_${y})`);
                }
                if (map.isAdjacent(current, upNeighbor)) {
                    initFacts.push(`(up t_${x}_${y} t_${x}_${y + 1})`);
                    initFacts.push(`(down t_${x}_${y + 1} t_${x}_${y})`);
                }
            }
        }

        // 2. Declare objects and initial positions
        initFacts.push('(agent ag)');
        initFacts.push('(me ag)');
        initFacts.push(`(at ag t_${agent.x}_${agent.y})`);

        let targetCrateId = 'crate_target';
        initFacts.push(`(crate ${targetCrateId})`);
        initFacts.push(`(at ${targetCrateId} t_${targetCrate.x}_${targetCrate.y})`);

        let idx = 1;
        for (const c of crates.values()) {
            if (c.x === targetCrate.x && c.y === targetCrate.y) continue;
            const otherCrateId = `crate_other_${idx++}`;
            initFacts.push(`(crate ${otherCrateId})`);
            initFacts.push(`(at ${otherCrateId} t_${c.x}_${c.y})`);
        }

        return `
(define (problem crate-push-problem)
    (:domain deliveroo-crates)
    (:objects
        ag - agent
        ${targetCrateId} - crate
        ${tilesList.join(' ')} - tile
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
